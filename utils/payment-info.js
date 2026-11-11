/**
 * utils/payment-info.js
 * Suy ra thông tin thanh toán của một đơn. Đơn tạo TRƯỚC khi có ví F chưa có các trường
 * paymentMethod / paymentStatus → mặc định là chuyển khoản và suy ra từ trạng thái đơn (không mất dữ liệu cũ).
 */
import {
  ORDER_STATUS, PAYMENT_METHOD, PAYMENT_METHOD_LABEL, PAYMENT_STATUS, PAYMENT_STATUS_LABEL,
  REFUND_STATUS, REFUND_STATUS_LABEL, CONTACT_CHANNELS, ROUTES,
} from '../config/constants.js';

export function getPaymentInfo(order) {
  const method = order.paymentMethod || PAYMENT_METHOD.BANK;
  let paymentStatus = order.paymentStatus;
  if (!paymentStatus) {
    paymentStatus = [ORDER_STATUS.PAID, ORDER_STATUS.PROCESSING, ORDER_STATUS.SENT, ORDER_STATUS.FAILED].includes(order.status)
      ? PAYMENT_STATUS.PAID : PAYMENT_STATUS.UNPAID;
  }
  const refundStatus = order.refundStatus || REFUND_STATUS.NONE;
  return {
    method,
    methodLabel: PAYMENT_METHOD_LABEL[method] || method,
    paymentStatus,
    paymentStatusLabel: PAYMENT_STATUS_LABEL[paymentStatus] || paymentStatus,
    refundStatus,
    refundStatusLabel: REFUND_STATUS_LABEL[refundStatus] || '',
    isWallet: method === PAYMENT_METHOD.WALLET,
  };
}

/** Đơn có thể huỷ không (khớp quy tắc của máy chủ — máy chủ vẫn kiểm tra lại) */
export function canCancelOrder(order) {
  const info = getPaymentInfo(order);
  return order.status === ORDER_STATUS.PENDING_PAYMENT || (order.status === ORDER_STATUS.PAID && info.isWallet);
}

const isSafeUrl = (url) => /^(https?:\/\/|mailto:)/i.test(url || '');

/** Liên kết "Liên hệ hỗ trợ": kênh đầu tiên đã được cấu hình, nếu chưa có thì dẫn tới trang Liên hệ */
export function getSupportLink() {
  const channel = CONTACT_CHANNELS.find((c) => c.url && isSafeUrl(c.url));
  return channel ? { href: channel.url, external: true, label: `Liên hệ qua ${channel.label}` } : { href: ROUTES.CONTACT, external: false, label: 'Liên hệ Cáo Đưa Thư' };
}
