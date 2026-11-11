/**
 * netlify/lib/handler.mjs — khung chung cho các Netlify Function xử lý tiền / đơn hàng.
 *
 * Mỗi request: kiểm tra phương thức → đọc JSON → xác thực Firebase ID token (Authorization: Bearer) →
 * (nếu là hàm admin) kiểm tra role "admin" trong Firestore users/{uid} → chạy nghiệp vụ → trả JSON thống nhất:
 *   thành công: { ok: true, ... }      lỗi: { ok: false, code, message, ... }
 * Lỗi không lường trước chỉ trả "INTERNAL" chung chung, không lộ chi tiết nội bộ.
 */
import { ApiError } from './errors.mjs';
import { getRealDeps } from './firebaseAdmin.mjs';

let testDeps = null;
/** Chỉ dùng trong test: thay Firestore/Auth thật bằng bản giả lập */
export function __setDepsForTest(deps) { testDeps = deps; }
const getDeps = () => testDeps || getRealDeps();

const MAX_BODY_BYTES = 100 * 1024;
const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 60_000;
const buckets = new Map(); // best-effort, theo instance

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

function limited(key, now = Date.now()) {
  if (buckets.size > 1000) buckets.clear();
  const b = buckets.get(key);
  if (!b || now - b.start > RATE_LIMIT_WINDOW_MS) { buckets.set(key, { start: now, count: 1 }); return false; }
  b.count += 1;
  return b.count > RATE_LIMIT_MAX;
}

/**
 * @param {{ admin?: boolean, run: (ctx:{db:any, user:{uid:string,email:string,name:string}, body:any}) => Promise<object> }} options
 */
export function createHandler({ admin = false, run }) {
  return async (req) => {
    try {
      if (req.method !== 'POST') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Chỉ hỗ trợ POST.');

      const raw = await req.text();
      if (raw.length > MAX_BODY_BYTES) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Dữ liệu gửi lên quá lớn.');
      let body;
      try { body = raw ? JSON.parse(raw) : {}; } catch (e) { throw new ApiError(400, 'INVALID_JSON', 'Dữ liệu gửi lên không hợp lệ.'); }

      const header = req.headers.get('authorization') || '';
      const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
      if (!token) throw new ApiError(401, 'UNAUTHENTICATED', 'Bạn cần đăng nhập.');

      const { db, verifyIdToken } = await getDeps();
      let decoded;
      try { decoded = await verifyIdToken(token); } catch (e) { throw new ApiError(401, 'UNAUTHENTICATED', 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn. Hãy đăng nhập lại.'); }
      if (!decoded || !decoded.uid) throw new ApiError(401, 'UNAUTHENTICATED', 'Bạn cần đăng nhập.');
      if (decoded.email_verified !== true) throw new ApiError(403, 'EMAIL_NOT_VERIFIED', 'Vui lòng xác minh email trước khi sử dụng tính năng này.');

      if (limited(`${decoded.uid}`)) throw new ApiError(429, 'RATE_LIMITED', 'Bạn thao tác quá nhanh, vui lòng đợi một chút.');

      const user = { uid: decoded.uid, email: decoded.email || '', name: decoded.name || '' };

      if (admin) {
        const profile = await db.collection('users').doc(user.uid).get();
        if (!profile.exists || profile.data().role !== 'admin') throw new ApiError(403, 'FORBIDDEN', 'Chỉ quản trị viên mới có quyền thực hiện thao tác này.');
      }

      const result = await run({ db, user, body });
      return json({ ok: true, ...result });
    } catch (error) {
      if (error instanceof ApiError) {
        return json({ ok: false, code: error.code, message: error.message, ...error.extra }, error.status);
      }
      console.error('[function] lỗi không lường trước:', error); // chỉ ghi log phía máy chủ
      return json({ ok: false, code: 'INTERNAL', message: 'Hệ thống đang gặp sự cố, vui lòng thử lại sau.' }, 500);
    }
  };
}
