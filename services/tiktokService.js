/**
 * services/tiktokService.js
 * -----------------------------------------------------------------------
 * Gọi Netlify Function kiểm tra hồ sơ TikTok (/.netlify/functions/check-tiktok).
 * Frontend KHÔNG gọi TikTok trực tiếp.
 *
 * checkTikTokAccount() luôn trả về một object có status thuộc 3 giá trị:
 *   FOUND | NOT_VERIFIED | UNKNOWN
 * Mọi lỗi (mạng, timeout, hết giới hạn, function chưa deploy, phản hồi lạ...) đều thành UNKNOWN —
 * KHÔNG BAO GIỜ bị hiểu thành "tài khoản không tồn tại". Chỉ ném lỗi khi yêu cầu bị huỷ (AbortError).
 * Dữ liệu từ máy chủ được làm sạch lại: link hồ sơ luôn tự dựng từ username đã chuẩn hoá.
 * -----------------------------------------------------------------------
 */
import { parseTikTokId } from '../utils/validators.js';

export const TIKTOK_CHECK_ENDPOINT = '/.netlify/functions/check-tiktok';
export const TIKTOK_CHECK_STATUS = { FOUND: 'FOUND', NOT_VERIFIED: 'NOT_VERIFIED', UNKNOWN: 'UNKNOWN' };

const CLIENT_TIMEOUT_MS = 10000;

export function buildProfileUrl(username) {
  return `https://www.tiktok.com/@${username}`;
}

function unknown(username, reason, message) {
  return {
    status: TIKTOK_CHECK_STATUS.UNKNOWN,
    reason,
    username,
    profileUrl: buildProfileUrl(username),
    authorName: '',
    thumbnailUrl: '',
    checkedAt: new Date().toISOString(),
    message: message || 'Chưa kiểm tra được lúc này. Bạn có thể thử lại sau ít phút.',
    retryable: true,
  };
}

function safeHttpsUrl(value) {
  if (typeof value !== 'string' || value.length > 2000) return '';
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : '';
  } catch (error) {
    return '';
  }
}

/** Làm sạch phản hồi từ máy chủ; trả null nếu hình dạng không hợp lệ */
function sanitizeResponse(data, username) {
  if (!data || typeof data !== 'object') return null;
  if (!Object.values(TIKTOK_CHECK_STATUS).includes(data.status)) return null;
  if (data.username !== username) return null; // phản hồi không thuộc ID đang kiểm tra

  const checkedAt = new Date(data.checkedAt);
  return {
    status: data.status,
    reason: typeof data.reason === 'string' ? data.reason.slice(0, 60) : '',
    username,
    profileUrl: buildProfileUrl(username),
    authorName: data.status === TIKTOK_CHECK_STATUS.FOUND && typeof data.authorName === 'string' ? data.authorName.slice(0, 100) : '',
    thumbnailUrl: data.status === TIKTOK_CHECK_STATUS.FOUND ? safeHttpsUrl(data.thumbnailUrl) : '',
    checkedAt: Number.isNaN(checkedAt.getTime()) ? new Date().toISOString() : checkedAt.toISOString(),
    message: typeof data.message === 'string' ? data.message.slice(0, 300) : '',
    retryable: data.status === TIKTOK_CHECK_STATUS.UNKNOWN,
  };
}

/**
 * @param {string} input - ID/link người dùng nhập (sẽ được chuẩn hoá lại)
 * @param {{signal?: AbortSignal}} [options]
 * @returns {Promise<object>} kết quả đã làm sạch
 * @throws {DOMException} chỉ khi bị huỷ bởi signal truyền vào
 */
export async function checkTikTokAccount(input, { signal } = {}) {
  const parsed = parseTikTokId(input);
  if (!parsed.valid) {
    return unknown('', 'INVALID_USERNAME', parsed.message);
  }
  const username = parsed.id;

  // Gộp signal của người gọi với timeout phía client
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, CLIENT_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) { clearTimeout(timer); throw new DOMException('Aborted', 'AbortError'); }
    signal.addEventListener('abort', onAbort, { once: true });
  }

  try {
    const response = await fetch(TIKTOK_CHECK_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ username }),
      signal: controller.signal,
    });

    if (response.status === 404) {
      return unknown(username, 'FUNCTION_UNAVAILABLE', 'Chức năng kiểm tra chưa hoạt động trên máy chủ này. Bạn vẫn có thể tiếp tục và tự đối chiếu ID.');
    }

    let data = null;
    try { data = await response.json(); } catch (error) { data = null; }

    const clean = sanitizeResponse(data, username);
    if (!clean) return unknown(username, 'INVALID_RESPONSE');
    // HTTP lỗi mà máy chủ lại báo FOUND/NOT_VERIFIED là bất thường → coi là không chắc chắn
    if (!response.ok && clean.status !== TIKTOK_CHECK_STATUS.UNKNOWN) return unknown(username, 'INVALID_RESPONSE');
    return clean;
  } catch (error) {
    if (error?.name === 'AbortError' && !timedOut) throw error; // người gọi chủ động huỷ
    return unknown(username, timedOut ? 'TIMEOUT' : 'NETWORK_ERROR',
      timedOut ? 'Việc kiểm tra mất quá nhiều thời gian. Bạn có thể thử lại.' : 'Không kết nối được tới máy chủ kiểm tra. Hãy kiểm tra mạng và thử lại.');
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}
