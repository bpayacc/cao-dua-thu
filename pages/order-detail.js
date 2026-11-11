/**
 * pages/order-detail.js — điểm vào JS cho trang Chi tiết đơn (chi-tiet-don.html)
 * Đơn được xác định qua query string ?id=<orderId>. Chỉ chủ đơn mới xem được
 * (Firestore Rules + kiểm tra phía giao diện).
 */
import { renderHeader } from '../components/header.js';
import { renderFooter } from '../components/footer.js';
import { renderBackButton } from '../components/back-button.js';
import { renderPaymentBox } from '../components/payment-box.js';
import { confirmDialog } from '../components/confirm-dialog.js';
import { startPaymentWatch } from '../components/payment-watch.js';
import { showToast } from '../components/toast.js';
import { requireAuth } from '../utils/router-guard.js';
import { qs, escapeHtml } from '../utils/dom.js';
import { fHtml, formatF, formatDateTime } from '../utils/formatters.js';
import { getPaymentInfo, canCancelOrder, getSupportLink } from '../utils/payment-info.js';
import { initAuthData } from '../services/authService.js';
import { getOrderById, cancelOrder } from '../services/orderService.js';
import { ORDER_STATUS, ORDER_STATUS_LABEL, SENDER_MODE, ROUTES, REFUND_STATUS, ORDER_PAYMENT_TIMEOUT_MINUTES } from '../config/constants.js';

// Các bước của một đơn thành công (Không thể gửi / Đã hủy hiển thị riêng)
const FLOW_STEPS = [ORDER_STATUS.PENDING_PAYMENT, ORDER_STATUS.PAID, ORDER_STATUS.PROCESSING, ORDER_STATUS.SENT];

let currentUser = null;
let currentOrder = null;
let stopWatch = null;

async function init() {
  initAuthData();
  await renderHeader('#app-header');
  renderFooter('#app-footer');

  currentUser = await requireAuth();
  if (!currentUser) return;

  renderBackButton('#pageBack', { fallbackHref: ROUTES.MY_ORDERS });

  const orderId = new URLSearchParams(window.location.search).get('id');
  try {
    currentOrder = orderId ? await getOrderById(orderId) : null;
  } catch (error) {
    showToast(error.message, 'error');
  }

  if (!currentOrder || currentOrder.customerId !== currentUser.id) {
    qs('#orderDetailContent').classList.add('is-hidden');
    qs('#orderNotFound').classList.remove('is-hidden');
    return;
  }
  renderOrder();
}

function renderOrder() {
  const order = currentOrder;

  qs('#orderCode').textContent = order.code;
  qs('#orderCreatedAt').textContent = `Đặt lúc ${formatDateTime(order.createdAt)}`;
  const badge = qs('#orderStatusBadge');
  badge.textContent = ORDER_STATUS_LABEL[order.status] || order.status;
  badge.className = `badge badge--${order.status}`;

  qs('#orderPackage').textContent = order.packageName;
  qs('#orderSenderMode').textContent = order.senderMode === SENDER_MODE.NAMED ? 'Gửi có tên' : 'Gửi ẩn danh';
  qs('#orderSenderName').textContent = order.senderMode === SENDER_MODE.NAMED ? order.senderName : '— (ẩn danh)';
  qs('#orderRecipient').textContent = `@${order.recipientTiktok}`;
  qs('#orderTotal').innerHTML = fHtml(order.totalPrice);

  const pay = getPaymentInfo(order);
  qs('#orderPayMethod').textContent = pay.methodLabel;
  qs('#orderPayStatus').textContent = pay.paymentStatusLabel;
  qs('#orderRefundRow').classList.toggle('is-hidden', !pay.refundStatusLabel);
  qs('#orderRefund').textContent = pay.refundStatusLabel;

  qs('#orderLetters').innerHTML = (order.letters || []).map((text, i) => `
    <div class="letter-card">
      <strong>${order.letters.length > 1 ? `Thư ${i + 1}` : 'Thư của bạn'}</strong>
      <p>${escapeHtml(text)}</p>
    </div>
  `).join('');

  renderTimeline(order);
  renderPayment(order);
  renderTimer(order);
  renderCancelAction(order);
  renderCancelNotice(order);
}

/** Đơn chuyển khoản còn "Chờ thanh toán": đếm ngược hạn thanh toán, tự cập nhật khi bị hủy do quá hạn / admin xác nhận */
function renderTimer(order) {
  stopWatch?.();
  stopWatch = null;
  const el = qs('#orderTimer');
  el.className = 'is-hidden';
  if (order.status !== ORDER_STATUS.PENDING_PAYMENT || getPaymentInfo(order).isWallet) return;
  stopWatch = startPaymentWatch(el, order, {
    onChange: (updated, reason) => {
      currentOrder = { ...currentOrder, ...updated };
      renderOrder();
      showToast(reason === 'expired' ? 'Đơn đã tự động hủy vì quá hạn thanh toán.' : 'Trạng thái đơn đã được cập nhật.', reason === 'expired' ? 'info' : 'success', 5000);
    },
  });
}

/** Thông báo sau khi huỷ: đơn chuyển khoản không được hoàn tự động; đơn ví F đã hoàn F */
function renderCancelNotice(order) {
  const box = qs('#orderCancelNotice');
  const pay = getPaymentInfo(order);
  box.replaceChildren();
  box.classList.add('is-hidden');
  if (order.status !== ORDER_STATUS.CANCELLED) return;

  if (!pay.isWallet && order.cancelledBy === 'system') {
    const support = getSupportLink();
    const extra = order.refundStatus === REFUND_STATUS.BANK_MANUAL ? ' Cáo đã ghi nhận yêu cầu hoàn tiền của bạn và sẽ liên hệ.' : order.refundStatus === REFUND_STATUS.BANK_DONE ? ' Cáo đã hoàn tiền chuyển khoản cho bạn.' : '';
    const link = document.createElement('a');
    link.className = 'btn btn--outline btn--block'; link.style.marginTop = '12px';
    link.href = support.href; link.textContent = support.label;
    if (support.external) { link.target = '_blank'; link.rel = 'noopener noreferrer'; }
    const again = document.createElement('a');
    again.className = 'btn btn--primary btn--block'; again.style.marginTop = '8px';
    again.href = ROUTES.SEND_LETTER; again.textContent = 'Gửi thư mới';
    box.append(document.createTextNode(`Đơn đã tự động hủy vì quá ${ORDER_PAYMENT_TIMEOUT_MINUTES} phút chưa thanh toán.${extra} Nếu bạn đã chuyển khoản trước khi đơn bị hủy, vui lòng liên hệ Cáo Đưa Thư để được hỗ trợ.`), link, again);
    box.classList.remove('is-hidden');
  } else if (pay.isWallet && order.refundStatus === REFUND_STATUS.REFUNDED_F) {
    box.textContent = `Đơn hàng của bạn đã được hủy và ${formatF(order.walletAmount || order.totalPrice)} đã được hoàn vào ví F của bạn.`;
    box.classList.remove('is-hidden');
  } else if (!pay.isWallet && order.refundStatus === REFUND_STATUS.BANK_DONE) {
    box.textContent = 'Đơn hàng đã được hủy và Cáo Đưa Thư đã hoàn tiền chuyển khoản cho bạn.';
    box.classList.remove('is-hidden');
  } else if (!pay.isWallet) {
    const support = getSupportLink();
    const link = document.createElement('a');
    link.className = 'btn btn--primary btn--block';
    link.style.marginTop = '12px';
    link.href = support.href;
    link.textContent = support.label;
    if (support.external) { link.target = '_blank'; link.rel = 'noopener noreferrer'; }
    box.append(
      document.createTextNode('Đơn hàng của bạn đã được hủy. Vì bạn thanh toán bằng chuyển khoản ngân hàng, vui lòng liên hệ Cáo Đưa Thư để được hỗ trợ hoàn tiền.'),
      link,
    );
    box.classList.remove('is-hidden');
  }
}

/** Timeline các bước, hoặc banner riêng nếu đơn "Không thể gửi" / "Đã hủy" */
function renderTimeline(order) {
  const container = qs('#orderTimeline');
  const noteEl = qs('#orderStatusNote');
  noteEl.classList.add('is-hidden');

  if (order.status === ORDER_STATUS.CANCELLED || order.status === ORDER_STATUS.FAILED) {
    const isFailed = order.status === ORDER_STATUS.FAILED;
    container.innerHTML = `
      <div class="timeline-cancelled">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>
        ${isFailed ? 'Rất tiếc, Cáo không thể gửi thư của đơn này.' : order.cancelledBy === 'system' ? 'Đơn đã tự động hủy do quá hạn thanh toán.' : 'Đơn hàng này đã được hủy.'}
      </div>`;
    if (isFailed) {
      noteEl.innerHTML = `${order.statusNote ? `<strong>Lý do:</strong> ${escapeHtml(order.statusNote)}<br />` : ''}Theo điều khoản, đơn không đủ điều kiện gửi do ID sai hoặc người nhận không nhận tin nhắn từ người lạ sẽ không được hoàn tiền. Nếu bạn nghĩ đã có nhầm lẫn, vui lòng <a href="${ROUTES.CONTACT}">liên hệ Cáo</a>.`;
      noteEl.classList.remove('is-hidden');
    }
    return;
  }

  const currentIndex = FLOW_STEPS.indexOf(order.status);
  container.innerHTML = `
    <ol class="timeline">
      ${FLOW_STEPS.map((step, index) => `
        <li class="timeline__step ${index <= currentIndex ? 'is-done' : ''} ${index === currentIndex ? 'is-current' : ''}">
          <span class="timeline__dot"></span>
          <span class="timeline__label">${ORDER_STATUS_LABEL[step]}</span>
        </li>`).join('')}
    </ol>`;
}

/** Chỉ hiện khối chuyển khoản khi đơn đang chờ thanh toán (đơn trả bằng ví F không có bước này) */
function renderPayment(order) {
  const card = qs('#orderPaymentCard');
  if (order.status !== ORDER_STATUS.PENDING_PAYMENT || getPaymentInfo(order).isWallet) {
    card.classList.add('is-hidden');
    return;
  }
  card.classList.remove('is-hidden');
  renderPaymentBox('#orderPayment', order);
}

/** Nút huỷ chỉ hiện khi đơn CHƯA được Cáo xác nhận (quy tắc này được máy chủ kiểm tra lại khi huỷ) */
function renderCancelAction(order) {
  const container = qs('#orderCancelAction');
  if (!canCancelOrder(order)) {
    const done = [ORDER_STATUS.CANCELLED].includes(order.status);
    container.innerHTML = done ? '' : '<p class="form-hint">Đơn đã được Cáo xác nhận hoặc xử lý nên không thể hủy.</p>';
    return;
  }
  const label = getPaymentInfo(order).isWallet ? 'Hủy đơn & hoàn F' : 'Hủy đơn này';
  container.innerHTML = `<button type="button" class="btn btn--outline btn--block" id="cancelOrderBtn">${label}</button>`;
  qs('#cancelOrderBtn').addEventListener('click', handleCancel);
}

async function handleCancel() {
  const isWallet = getPaymentInfo(currentOrder).isWallet;
  const confirmed = await confirmDialog({
    title: 'Hủy đơn',
    message: isWallet
      ? `Hủy đơn ${currentOrder.code}? Cáo sẽ hoàn ${formatF(currentOrder.walletAmount || currentOrder.totalPrice)} vào ví F của bạn.`
      : `Hủy đơn ${currentOrder.code}? Đơn thanh toán bằng chuyển khoản sẽ KHÔNG được hoàn tiền tự động — nếu bạn đã chuyển khoản, hãy liên hệ Cáo Đưa Thư để được hỗ trợ hoàn tiền.`,
    confirmLabel: 'Hủy đơn',
    cancelLabel: 'Giữ lại',
    danger: true,
  });
  if (!confirmed) return;

  const btn = qs('#cancelOrderBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Đang hủy...'; }
  const res = await cancelOrder(currentOrder.id);
  if (res.success) {
    currentOrder = { ...currentOrder, ...res.order };
    showToast(res.refundedF > 0 ? `Đã hủy đơn và hoàn ${formatF(res.refundedF)} vào ví.` : 'Đã hủy đơn hàng.', 'success', 4000);
    renderOrder();
  } else {
    showToast(res.message, 'error', 5000);
    // Đơn có thể đã đổi trạng thái (vd. Cáo vừa xác nhận): tải lại để hiển thị đúng
    const fresh = await getOrderById(currentOrder.id).catch(() => null);
    if (fresh) { currentOrder = fresh; renderOrder(); }
  }
}

document.addEventListener('DOMContentLoaded', init);
