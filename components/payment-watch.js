/**
 * components/payment-watch.js
 * Đồng hồ đếm ngược hạn thanh toán của đơn chuyển khoản + theo dõi trạng thái đơn.
 *
 *  - Hiển thị "còn mm:ss". Khi về 0, gọi máy chủ (expire-order) để hủy đơn; MÁY CHỦ là bên quyết định
 *    (giờ máy khách chỉ để hiển thị — nếu máy chủ nói chưa tới hạn, đồng hồ tự đồng bộ lại).
 *  - Cứ 15 giây đọc lại đơn: nếu admin đã xác nhận nhận tiền, hoặc đơn đã bị hủy (kể cả do hệ thống tự hủy lúc
 *    khách tắt/mở lại trang), trang tự cập nhật.
 * Đơn trả bằng ví F không có hạn nên không dùng component này.
 */
import { ORDER_PAYMENT_TIMEOUT_MINUTES, ORDER_STATUS } from '../config/constants.js';
import { expireOrder, getOrderById } from '../services/orderService.js';

const pad = (n) => String(n).padStart(2, '0');
const format = (seconds) => `${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`;

/**
 * @param {HTMLElement} el - vùng hiển thị đồng hồ
 * @param {object} order - đơn chuyển khoản đang "Chờ thanh toán"
 * @param {{onChange:(order:object, reason:'expired'|'changed')=>void}} options
 * @returns {() => void} hàm dừng
 */
export function startPaymentWatch(el, order, { onChange }) {
  const base = order.expiresAt ? new Date(order.expiresAt).getTime() : new Date(order.createdAt).getTime() + ORDER_PAYMENT_TIMEOUT_MINUTES * 60000;
  let deadline = Number.isFinite(base) ? base : Date.now() + ORDER_PAYMENT_TIMEOUT_MINUTES * 60000;
  let stopped = false;
  let busy = false;

  el.className = 'pay-timer';
  el.replaceChildren();
  const icon = document.createElement('span'); icon.className = 'pay-timer__icon'; icon.textContent = '⏳'; icon.setAttribute('aria-hidden', 'true');
  const text = document.createElement('span');
  const strong = document.createElement('strong'); strong.className = 'pay-timer__time';
  text.append('Còn ', strong, ` để thanh toán. Quá ${ORDER_PAYMENT_TIMEOUT_MINUTES} phút chưa thanh toán, đơn sẽ tự động hủy.`);
  el.append(icon, text);

  function stop() {
    stopped = true;
    clearInterval(tickTimer);
    clearInterval(pollTimer);
    el.className = 'is-hidden';
  }

  async function tick() {
    if (stopped) return;
    const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    strong.textContent = format(left);
    el.classList.toggle('is-urgent', left <= 60);
    if (left > 0 || busy) return;

    busy = true;
    const res = await expireOrder(order.id);
    busy = false;
    if (stopped) return;
    if (res.success && res.order && res.order.status !== ORDER_STATUS.PENDING_PAYMENT) {
      stop(); onChange(res.order, res.expired ? 'expired' : 'changed');
    } else if (res.success && res.secondsLeft > 0) {
      deadline = Date.now() + res.secondsLeft * 1000; // đồng hồ máy lệch → theo máy chủ
    } else {
      deadline = Date.now() + 5000; // lỗi mạng: thử lại sau 5 giây
    }
  }

  async function poll() {
    if (stopped || busy) return;
    try {
      const fresh = await getOrderById(order.id);
      if (!stopped && fresh && fresh.status !== ORDER_STATUS.PENDING_PAYMENT) {
        stop(); onChange(fresh, fresh.cancelledBy === 'system' ? 'expired' : 'changed');
      }
    } catch (error) { /* bỏ qua, lần sau đọc lại */ }
  }

  const tickTimer = setInterval(tick, 1000);
  const pollTimer = setInterval(poll, 15000);
  tick();
  return stop;
}
