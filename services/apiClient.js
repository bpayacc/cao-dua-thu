/**
 * services/apiClient.js
 * Gọi các Netlify Function cần đăng nhập (tạo đơn, huỷ đơn, nạp F...). Gắn Firebase ID token của người dùng
 * vào header Authorization; máy chủ tự xác thực token và quyết định mọi thứ liên quan tiền.
 * Không bao giờ ném lỗi ra ngoài: luôn trả { ok, code, message, ...dữ liệu }.
 */
import { auth } from '../config/firebaseClient.js';

const TIMEOUT_MS = 20000;

export async function callFunction(url, body) {
  try {
    if (typeof auth.authStateReady === 'function') await auth.authStateReady();
  } catch (error) { /* bỏ qua, kiểm tra currentUser bên dưới */ }

  const user = auth.currentUser;
  if (!user) return { ok: false, status: 401, code: 'UNAUTHENTICATED', message: 'Bạn cần đăng nhập để thực hiện thao tác này.' };

  let token;
  try {
    token = await user.getIdToken();
  } catch (error) {
    return { ok: false, status: 401, code: 'UNAUTHENTICATED', message: 'Không lấy được phiên đăng nhập. Hãy đăng nhập lại.' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body || {}),
      signal: controller.signal,
    });

    let data = null;
    try { data = await response.json(); } catch (error) { data = null; }

    if (!data || typeof data !== 'object') {
      return response.status === 404
        ? { ok: false, status: 404, code: 'FUNCTION_UNAVAILABLE', message: 'Máy chủ xử lý chưa sẵn sàng (Netlify Function chưa được triển khai hoặc đang chạy bằng server tĩnh).' }
        : { ok: false, status: response.status, code: 'BAD_RESPONSE', message: 'Máy chủ trả về dữ liệu không hợp lệ. Vui lòng thử lại.' };
    }
    return { ...data, ok: data.ok === true && response.ok, status: response.status };
  } catch (error) {
    return {
      ok: false, status: 0, code: 'NETWORK',
      message: error?.name === 'AbortError' ? 'Máy chủ phản hồi quá lâu. Hãy kiểm tra lại đơn/ví của bạn trước khi thử lại.' : 'Không kết nối được tới máy chủ. Hãy kiểm tra mạng và thử lại.',
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Mã yêu cầu ngẫu nhiên dùng làm khoá chống xử lý trùng (idempotency key) */
export function newRequestId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  (globalThis.crypto || { getRandomValues: (b) => b.map(() => Math.floor(Math.random() * 256)) }).getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
