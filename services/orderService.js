/**
 * services/orderService.js
 * -----------------------------------------------------------------------
 * - ĐỌC đơn: trực tiếp từ Firestore (Firestore Rules chỉ cho chủ đơn / admin đọc).
 * - TẠO đơn, THANH TOÁN BẰNG VÍ F, HUỶ ĐƠN + HOÀN F: do Netlify Functions xử lý
 *   (netlify/functions/create-order, cancel-order) — trình duyệt KHÔNG được tự ghi các dữ liệu này.
 * - Admin đổi trạng thái đơn: cập nhật Firestore trực tiếp, được Rules kiểm soát chặt theo từng bước.
 *
 * Giá luôn do máy chủ tự tính lại từ config/constants.js; giá hiển thị ở giao diện chỉ để tham khảo.
 * -----------------------------------------------------------------------
 */
import { db } from '../config/firebaseClient.js';
import {
  collection, doc, getDoc, getDocs, query, where, orderBy, updateDoc, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js';
import {
  ORDER_STATUS, SENDER_MODE, LETTER_PACKAGES, PAYMENT_STATUS, REFUND_STATUS, PAYMENT_METHOD, API,
  LETTER_MIN_LENGTH, LETTER_MAX_LENGTH, SENDER_NAME_MAX_LENGTH,
} from '../config/constants.js';
import { parseTikTokId, validateLetterContent, normalizeLetterForCompare } from '../utils/validators.js';
import { callFunction } from './apiClient.js';

/** Các bước chuyển trạng thái hợp lệ do quản trị viên thực hiện (khớp với Firestore Rules) */
export const ADMIN_TRANSITIONS = {
  [ORDER_STATUS.PENDING_PAYMENT]: [ORDER_STATUS.PAID, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.PAID]: [ORDER_STATUS.PROCESSING, ORDER_STATUS.FAILED],
  [ORDER_STATUS.PROCESSING]: [ORDER_STATUS.SENT, ORDER_STATUS.FAILED],
  [ORDER_STATUS.SENT]: [],
  [ORDER_STATUS.FAILED]: [],
  [ORDER_STATUS.CANCELLED]: [],
};

export function getPackageById(packageId) {
  return LETTER_PACKAGES.find((p) => p.id === packageId) || null;
}

/** Chuyển dữ liệu Firestore (Timestamp) thành object thuần với các mốc thời gian dạng ISO */
const TIME_FIELDS = ['createdAt', 'updatedAt', 'paidAt', 'refundedAt', 'cancelledAt', 'expiresAt'];
function normalizeOrder(id, data) {
  const out = { id, ...data };
  for (const key of TIME_FIELDS) {
    const v = data[key];
    out[key] = v && typeof v.toDate === 'function' ? v.toDate().toISOString() : v || null;
  }
  return out;
}

function mapError(error) {
  if (error?.code === 'permission-denied') return 'Bạn không có quyền thực hiện thao tác này (hoặc Firestore Rules chưa được cập nhật).';
  if (error?.code === 'unavailable') return 'Không kết nối được máy chủ, vui lòng kiểm tra mạng và thử lại.';
  return `Đã có lỗi xảy ra (${error?.code || 'unknown'}), vui lòng thử lại.`;
}

/** Kiểm tra sớm ở trình duyệt để báo lỗi nhanh — máy chủ kiểm tra lại toàn bộ. */
export function validateOrderDraft({ packageId, senderMode, senderName = '', recipientTiktok, letters }) {
  const pkg = getPackageById(packageId);
  if (!pkg) return 'Vui lòng chọn gói thư.';
  if (![SENDER_MODE.ANONYMOUS, SENDER_MODE.NAMED].includes(senderMode)) return 'Hình thức gửi không hợp lệ.';
  if (senderMode === SENDER_MODE.NAMED && (!senderName.trim() || senderName.trim().length > SENDER_NAME_MAX_LENGTH)) {
    return `Tên người gửi cần từ 1 đến ${SENDER_NAME_MAX_LENGTH} ký tự.`;
  }
  const tiktok = parseTikTokId(recipientTiktok);
  if (!tiktok.valid) return tiktok.message;
  if (!Array.isArray(letters) || letters.length !== pkg.letterCount) return `${pkg.name} cần đúng ${pkg.letterCount} bức thư.`;
  for (let i = 0; i < letters.length; i += 1) {
    const check = validateLetterContent(letters[i], LETTER_MIN_LENGTH, LETTER_MAX_LENGTH, pkg.letterCount > 1 ? `Thư ${i + 1}` : 'Nội dung thư');
    if (!check.valid) return check.message;
  }
  if (pkg.letterCount > 1 && new Set(letters.map(normalizeLetterForCompare)).size !== letters.length) {
    return 'Mỗi bức thư cần có nội dung riêng, không dùng chung một nội dung.';
  }
  return '';
}

/**
 * Tạo đơn (+ thanh toán bằng ví F nếu paymentMethod = "wallet") qua Netlify Function.
 * @param {{packageId, senderMode, senderName?, recipientTiktok, letters:string[], tiktokCheck?:object, paymentMethod:string, requestId:string}} payload
 * @returns {Promise<{success:boolean, message:string, code?:string, order?:object, balance?:number, shortfall?:number}>}
 */
export async function createOrder(payload) {
  const problem = validateOrderDraft(payload);
  if (problem) return { success: false, code: 'INVALID_INPUT', message: problem };
  if (![PAYMENT_METHOD.BANK, PAYMENT_METHOD.WALLET].includes(payload.paymentMethod)) {
    return { success: false, code: 'INVALID_INPUT', message: 'Vui lòng chọn phương thức thanh toán.' };
  }

  const res = await callFunction(API.CREATE_ORDER, {
    packageId: payload.packageId,
    senderMode: payload.senderMode,
    senderName: payload.senderName || '',
    recipientTiktok: payload.recipientTiktok,
    letters: payload.letters,
    tiktokCheck: payload.tiktokCheck || null,
    paymentMethod: payload.paymentMethod,
    requestId: payload.requestId,
  });

  if (!res.ok) {
    return { success: false, code: res.code, message: res.message || 'Không tạo được đơn.', balance: res.balance, shortfall: res.shortfall };
  }
  return { success: true, message: 'Đã tạo đơn gửi thư!', order: res.order, balance: res.balance, reused: !!res.reused };
}

/** Lấy toàn bộ đơn của một khách hàng, mới nhất trước */
export async function getOrdersByCustomer(customerId) {
  try {
    const snap = await getDocs(query(collection(db, 'orders'), where('customerId', '==', customerId)));
    return snap.docs
      .map((d) => normalizeOrder(d.id, d.data()))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  } catch (error) {
    console.error('[orderService] getOrdersByCustomer lỗi:', error);
    throw new Error(mapError(error));
  }
}

/** Lấy một đơn theo id (null nếu không có hoặc không có quyền xem) */
export async function getOrderById(orderId) {
  try {
    const snap = await getDoc(doc(db, 'orders', orderId));
    return snap.exists() ? normalizeOrder(snap.id, snap.data()) : null;
  } catch (error) {
    if (error?.code === 'permission-denied') return null;
    console.error('[orderService] getOrderById lỗi:', error);
    throw new Error(mapError(error));
  }
}

/**
 * Khách huỷ đơn qua máy chủ. Đơn ví F: hoàn F nguyên tử (đúng 1 lần). Đơn chuyển khoản: chỉ huỷ,
 * không hoàn tự động (cần liên hệ để hoàn tiền thủ công).
 * @returns {Promise<{success:boolean, message:string, order?:object, refundedF?:number, bankRefundNeeded?:boolean, alreadyCancelled?:boolean}>}
 */
export async function cancelOrder(orderId) {
  const res = await callFunction(API.CANCEL_ORDER, { orderId });
  if (!res.ok) return { success: false, code: res.code, message: res.message || 'Không hủy được đơn.' };
  return {
    success: true, order: res.order, refundedF: res.refundedF || 0, balance: res.balance,
    bankRefundNeeded: !!res.bankRefundNeeded, alreadyCancelled: !!res.alreadyCancelled, message: 'Đã hủy đơn hàng.',
  };
}

/**
 * Đồng hồ thanh toán về 0 → nhờ máy chủ hủy đơn quá hạn. Máy chủ TỰ kiểm tra giờ (khách không thể hủy sớm):
 * nếu chưa tới hạn sẽ trả về số giây còn lại để trang đồng bộ lại đồng hồ.
 * @returns {Promise<{success:boolean, message?:string, expired?:boolean, secondsLeft?:number, order?:object}>}
 */
export async function expireOrder(orderId) {
  const res = await callFunction(API.EXPIRE_ORDER, { orderId });
  if (!res.ok) return { success: false, code: res.code, message: res.message };
  return { success: true, expired: !!res.expired, secondsLeft: res.secondsLeft, order: res.order };
}

/** Admin: lấy toàn bộ đơn trong hệ thống, mới nhất trước */
export async function getAllOrders() {
  try {
    const snap = await getDocs(query(collection(db, 'orders'), orderBy('createdAt', 'desc')));
    return snap.docs.map((d) => normalizeOrder(d.id, d.data()));
  } catch (error) {
    console.error('[orderService] getAllOrders lỗi:', error);
    throw new Error(mapError(error));
  }
}

/**
 * Admin: cập nhật trạng thái đơn (kèm ghi chú, vd. lý do "Không thể gửi").
 * Khi admin xác nhận ĐÃ NHẬN chuyển khoản (Chờ thanh toán → Đã thanh toán) thì đồng thời ghi paymentStatus = paid.
 * Firestore Rules kiểm tra lại từng bước chuyển dựa trên trạng thái hiện tại của đơn.
 */
export async function updateOrderStatus(orderId, nextStatus, note = '') {
  try {
    const ref = doc(db, 'orders', orderId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return { success: false, message: 'Không tìm thấy đơn hàng.' };

    const current = snap.data().status;
    if (!(ADMIN_TRANSITIONS[current] || []).includes(nextStatus)) {
      return { success: false, message: 'Không thể chuyển đơn sang trạng thái này.' };
    }

    const patch = { status: nextStatus, statusNote: String(note || '').trim().slice(0, 300), updatedAt: serverTimestamp() };
    if (current === ORDER_STATUS.PENDING_PAYMENT && nextStatus === ORDER_STATUS.PAID) {
      patch.paymentStatus = PAYMENT_STATUS.PAID;
      patch.paidAt = serverTimestamp();
    }
    await updateDoc(ref, patch);
    const updated = await getDoc(ref);
    return { success: true, order: normalizeOrder(updated.id, updated.data()) };
  } catch (error) {
    console.error('[orderService] updateOrderStatus lỗi:', error);
    return { success: false, message: error?.code === 'permission-denied' ? 'Không thể cập nhật: trạng thái đơn đã thay đổi (ví dụ khách vừa hủy). Hãy tải lại trang.' : mapError(error) };
  }
}

/** Admin: đơn tự hủy do quá hạn nhưng khách báo ĐÃ chuyển khoản → đánh dấu cần hoàn tiền thủ công */
export async function markBankRefundNeeded(orderId, note = '') {
  try {
    const ref = doc(db, 'orders', orderId);
    const snap = await getDoc(ref);
    const data = snap.exists() ? snap.data() : null;
    if (!data || data.status !== ORDER_STATUS.CANCELLED || data.cancelledBy !== 'system' || (data.refundStatus && data.refundStatus !== REFUND_STATUS.NONE)) {
      return { success: false, message: 'Chỉ áp dụng cho đơn tự hủy do quá hạn thanh toán và chưa đánh dấu hoàn tiền.' };
    }
    await updateDoc(ref, { refundStatus: REFUND_STATUS.BANK_MANUAL, refundNote: String(note || '').trim().slice(0, 300), updatedAt: serverTimestamp() });
    return { success: true };
  } catch (error) {
    console.error('[orderService] markBankRefundNeeded lỗi:', error);
    return { success: false, message: mapError(error) };
  }
}

/** Admin: đánh dấu đã hoàn tiền ngân hàng thủ công cho đơn chuyển khoản bị huỷ */
export async function markBankRefundDone(orderId, note = '') {
  try {
    const ref = doc(db, 'orders', orderId);
    const snap = await getDoc(ref);
    if (!snap.exists() || snap.data().refundStatus !== REFUND_STATUS.BANK_MANUAL) {
      return { success: false, message: 'Đơn này không ở trạng thái cần hoàn tiền thủ công.' };
    }
    await updateDoc(ref, { refundStatus: REFUND_STATUS.BANK_DONE, refundNote: String(note || '').trim().slice(0, 300), updatedAt: serverTimestamp() });
    return { success: true };
  } catch (error) {
    console.error('[orderService] markBankRefundDone lỗi:', error);
    return { success: false, message: mapError(error) };
  }
}
