/**
 * netlify/functions/check-tiktok.mjs
 * -----------------------------------------------------------------------
 * Endpoint: /.netlify/functions/check-tiktok   (GET ?username=...  hoặc  POST {"username":"..."})
 *
 * Kiểm tra hồ sơ TikTok qua oEmbed công khai của TikTok. Frontend KHÔNG gọi TikTok trực tiếp.
 *
 * Kết quả luôn là JSON cùng một hình dạng:
 *   { status, reason, username, profileUrl, authorName, thumbnailUrl, checkedAt, message, retryable }
 *   status: "FOUND" | "NOT_VERIFIED" | "UNKNOWN"   (đầu vào sai → "INVALID", HTTP 400)
 *
 * QUAN TRỌNG về ý nghĩa:
 *  - FOUND        : TikTok trả về dữ liệu hồ sơ khớp với username. KHÔNG có nghĩa tài khoản
 *                   cho phép nhận tin nhắn từ người lạ (oEmbed không cho biết điều đó).
 *  - NOT_VERIFIED : không lấy được dữ liệu hồ sơ (ID sai, hồ sơ riêng tư, bị hạn chế, hoặc TikTok
 *                   không cung cấp). KHÔNG kết luận "không tồn tại" hay "bị khoá".
 *  - UNKNOWN      : lỗi mạng / timeout / bị giới hạn truy vấn / CAPTCHA / lỗi máy chủ / dữ liệu
 *                   không đầy đủ hoặc không khớp. KHÔNG được hiểu là tài khoản không tồn tại.
 *
 * Bảo mật: chỉ gửi request tới đúng host www.tiktok.com với username đã chuẩn hoá ([a-z0-9_.]{2,24});
 * không nhận URL tuỳ ý. Không có API key/bí mật nào được dùng.
 * -----------------------------------------------------------------------
 */
import { parseTikTokId } from '../../utils/validators.js';

const OEMBED_ENDPOINT = 'https://www.tiktok.com/oembed';
const REQUEST_TIMEOUT_MS = 6000;

// Giới hạn tần suất "cố gắng tối đa" theo IP, nằm trong bộ nhớ của từng instance function.
// Netlify Functions không có bộ nhớ chung giữa các instance → KHÔNG phải rào chắn spam đáng tin cậy.
const RATE_LIMIT_MAX = 10;          // số lần / cửa sổ / IP
const RATE_LIMIT_WINDOW_MS = 60_000;
const CACHE_TTL_MS = 60_000;        // cache kết quả FOUND / NOT_VERIFIED để giảm số lần hỏi TikTok
const MAX_TRACKED = 500;            // chặn Map phình to

const rateBuckets = new Map();
const resultCache = new Map();

const MESSAGES = {
  FOUND: 'TikTok trả về dữ liệu hồ sơ này.',
  NOT_VERIFIED: 'Chưa xác minh được hồ sơ. Có thể ID chưa đúng, hồ sơ riêng tư, bị hạn chế truy cập hoặc TikTok không cung cấp dữ liệu.',
  UNKNOWN: 'Chưa kiểm tra được lúc này. Bạn có thể thử lại sau ít phút.',
  INVALID: 'ID TikTok không hợp lệ.',
};

function json(body, httpStatus = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status: httpStatus,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders },
  });
}

function result(status, reason, username, extra = {}) {
  return {
    status,
    reason,
    username: username || '',
    profileUrl: username ? `https://www.tiktok.com/@${username}` : '',
    authorName: '',
    thumbnailUrl: '',
    checkedAt: new Date().toISOString(),
    message: MESSAGES[status] || '',
    retryable: status === 'UNKNOWN',
    ...extra,
  };
}

/** Trả về true nếu IP này đã vượt giới hạn trong cửa sổ hiện tại */
function isRateLimited(ip, now = Date.now()) {
  if (rateBuckets.size > MAX_TRACKED) {
    for (const [key, bucket] of rateBuckets) if (now - bucket.start > RATE_LIMIT_WINDOW_MS) rateBuckets.delete(key);
    if (rateBuckets.size > MAX_TRACKED) rateBuckets.clear();
  }
  const bucket = rateBuckets.get(ip);
  if (!bucket || now - bucket.start > RATE_LIMIT_WINDOW_MS) {
    rateBuckets.set(ip, { start: now, count: 1 });
    return false;
  }
  bucket.count += 1;
  return bucket.count > RATE_LIMIT_MAX;
}

function getClientIp(req, context) {
  return context?.ip
    || req.headers.get('x-nf-client-connection-ip')
    || (req.headers.get('x-forwarded-for') || '').split(',')[0].trim()
    || 'unknown';
}

/** Chỉ giữ ảnh đại diện nếu là URL https hợp lệ */
function safeHttpsUrl(value) {
  if (typeof value !== 'string' || value.length > 2000) return '';
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : '';
  } catch (error) {
    return '';
  }
}

/** Gọi oEmbed và phân loại kết quả. Không bao giờ ném lỗi ra ngoài. */
async function checkOnTikTok(username) {
  const target = `${OEMBED_ENDPOINT}?url=${encodeURIComponent(`https://www.tiktok.com/@${username}`)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response;
  let bodyText = '';
  try {
    response = await fetch(target, {
      method: 'GET',
      headers: { Accept: 'application/json', 'User-Agent': 'CaoDuaThu-ProfileCheck/1.0' },
      redirect: 'error', // không đi theo chuyển hướng sang host khác
      signal: controller.signal,
    });
    bodyText = await response.text();
  } catch (error) {
    return result('UNKNOWN', error?.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR', username);
  } finally {
    clearTimeout(timer);
  }

  const looksLikeHtml = /<html|<!doctype|captcha/i.test(bodyText.slice(0, 2000));

  if (response.status === 429) return result('UNKNOWN', 'UPSTREAM_RATE_LIMITED', username);
  if (response.status === 403 || response.status >= 500) return result('UNKNOWN', 'UPSTREAM_ERROR', username);

  if (response.status === 400 || response.status === 404) {
    // TikTok không cung cấp dữ liệu hồ sơ: chưa xác minh được, KHÔNG kết luận tài khoản không tồn tại
    return looksLikeHtml
      ? result('UNKNOWN', 'UPSTREAM_CHALLENGE', username)
      : result('NOT_VERIFIED', 'NO_PROFILE_DATA', username);
  }

  if (!response.ok) return result('UNKNOWN', 'UPSTREAM_UNEXPECTED_STATUS', username);
  if (looksLikeHtml) return result('UNKNOWN', 'UPSTREAM_CHALLENGE', username);

  let data;
  try {
    data = JSON.parse(bodyText);
  } catch (error) {
    return result('UNKNOWN', 'INVALID_RESPONSE', username);
  }
  if (!data || typeof data !== 'object') return result('UNKNOWN', 'INVALID_RESPONSE', username);

  const authorName = typeof data.author_name === 'string' ? data.author_name.trim().slice(0, 100) : '';
  if (!authorName) return result('UNKNOWN', 'INCOMPLETE_RESPONSE', username);

  // Nếu TikTok có trả author_url thì phải khớp đúng username đang kiểm tra
  if (typeof data.author_url === 'string' && data.author_url) {
    const match = data.author_url.match(/tiktok\.com\/@([^/?#]+)/i);
    if (!match || decodeURIComponent(match[1]).toLowerCase() !== username) {
      return result('UNKNOWN', 'MISMATCHED_RESPONSE', username);
    }
  }

  return result('FOUND', 'PROFILE_DATA_RETURNED', username, {
    authorName,
    thumbnailUrl: safeHttpsUrl(data.thumbnail_url),
  });
}

export default async (req, context) => {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return json(result('INVALID', 'METHOD_NOT_ALLOWED', ''), 405, { Allow: 'GET, POST' });
  }

  // 1) Lấy & chuẩn hoá đầu vào (cùng hàm parseTikTokId với frontend)
  let rawInput = '';
  try {
    if (req.method === 'POST') {
      const body = await req.json();
      rawInput = body && typeof body.username === 'string' ? body.username : '';
    } else {
      rawInput = new URL(req.url).searchParams.get('username') || '';
    }
  } catch (error) {
    return json(result('INVALID', 'BAD_REQUEST', ''), 400);
  }
  if (rawInput.length > 200) return json(result('INVALID', 'INPUT_TOO_LONG', ''), 400);

  const parsed = parseTikTokId(rawInput);
  if (!parsed.valid) {
    return json(result('INVALID', 'INVALID_USERNAME', '', { message: parsed.message }), 400);
  }
  const username = parsed.id;

  // 2) Cache ngắn hạn (chỉ kết quả chắc chắn) — không tính vào giới hạn tần suất
  const now = Date.now();
  const cached = resultCache.get(username);
  if (cached && now - cached.at < CACHE_TTL_MS) return json(cached.value);

  // 3) Giới hạn tần suất theo IP (best-effort)
  if (isRateLimited(getClientIp(req, context), now)) {
    return json(result('UNKNOWN', 'RATE_LIMITED', username, {
      message: 'Bạn kiểm tra hơi nhiều lần. Vui lòng đợi khoảng một phút rồi thử lại.',
    }), 429, { 'Retry-After': '60' });
  }

  // 4) Hỏi TikTok
  const outcome = await checkOnTikTok(username);
  if (outcome.status !== 'UNKNOWN') {
    if (resultCache.size > MAX_TRACKED) resultCache.clear();
    resultCache.set(username, { at: now, value: outcome });
  }
  return json(outcome);
};

// Xuất để kiểm thử offline (Netlify chỉ dùng export default)
export const __test = { isRateLimited, rateBuckets, resultCache, checkOnTikTok };
