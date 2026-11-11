/**
 * pages/my-orders.js — điểm vào JS cho trang Đơn của tôi (don-cua-toi.html)
 * Đọc đơn thật của người dùng đang đăng nhập từ Firestore.
 */
import { renderHeader } from '../components/header.js';
import { renderFooter } from '../components/footer.js';
import { renderBackButton } from '../components/back-button.js';
import { requireAuth } from '../utils/router-guard.js';
import { qs, qsa, escapeHtml } from '../utils/dom.js';
import { fHtml, formatDateTime } from '../utils/formatters.js';
import { getPaymentInfo } from '../utils/payment-info.js';
import { setupScrollReveal } from '../utils/scroll-reveal.js';
import { initAuthData } from '../services/authService.js';
import { getOrdersByCustomer } from '../services/orderService.js';
import { ORDER_STATUS, ORDER_STATUS_LABEL, ROUTES } from '../config/constants.js';

// Gom các trạng thái vào các tab để dễ theo dõi
const FILTER_TABS = [
  { key: 'all', label: 'Tất cả', match: () => true },
  { key: 'waiting', label: 'Chờ thanh toán', match: (s) => s === ORDER_STATUS.PENDING_PAYMENT },
  { key: 'processing', label: 'Đang xử lý', match: (s) => [ORDER_STATUS.PAID, ORDER_STATUS.PROCESSING].includes(s) },
  { key: 'sent', label: 'Đã gửi', match: (s) => s === ORDER_STATUS.SENT },
  { key: 'closed', label: 'Không thành công', match: (s) => [ORDER_STATUS.FAILED, ORDER_STATUS.CANCELLED].includes(s) },
];

let allOrders = [];
let activeFilter = 'all';

async function init() {
  initAuthData();
  await renderHeader('#app-header');
  renderFooter('#app-footer');

  const user = await requireAuth();
  if (!user) return;

  renderBackButton('#pageBack', { fallbackHref: ROUTES.HOME });

  qs('#ordersList').innerHTML = '<div class="inline-loading"><span class="spinner"></span> Đang tải đơn của bạn...</div>';
  try {
    allOrders = await getOrdersByCustomer(user.id);
  } catch (error) {
    qs('#ordersList').innerHTML = `<p class="form-error">${escapeHtml(error.message)}</p>`;
    return;
  }

  renderTabs();
  renderList();
  setupScrollReveal();
}

function renderTabs() {
  const container = qs('#filterTabs');
  container.innerHTML = FILTER_TABS.map((tab) => {
    const count = allOrders.filter((o) => tab.match(o.status)).length;
    return `<button type="button" class="filter-tab ${tab.key === activeFilter ? 'is-active' : ''}" data-tab="${tab.key}">${tab.label} <span>${count}</span></button>`;
  }).join('');

  qsa('.filter-tab', container).forEach((btn) => {
    btn.addEventListener('click', () => {
      activeFilter = btn.dataset.tab;
      renderTabs();
      renderList();
    });
  });
}

function renderList() {
  const listEl = qs('#ordersList');
  const emptyEl = qs('#ordersEmpty');
  const tab = FILTER_TABS.find((t) => t.key === activeFilter);
  const filtered = allOrders.filter((o) => tab.match(o.status));

  if (!filtered.length) {
    listEl.innerHTML = '';
    qs('#ordersEmptyText').textContent = allOrders.length ? 'Chưa có đơn nào trong mục này.' : 'Bạn chưa gửi bức thư nào. Viết bức thư đầu tiên nhé!';
    emptyEl.classList.remove('is-hidden');
    return;
  }
  emptyEl.classList.add('is-hidden');

  listEl.innerHTML = filtered.map((order) => `
    <a href="${ROUTES.ORDER_DETAIL}?id=${encodeURIComponent(order.id)}" class="order-card card card--hover">
      <div class="order-card__top">
        <span class="order-card__code">${escapeHtml(order.code)}</span>
        <span class="badge badge--${order.status}">${ORDER_STATUS_LABEL[order.status] || order.status}</span>
      </div>
      <h3>Thư gửi @${escapeHtml(order.recipientTiktok)}</h3>
      <div class="order-card__meta">
        <span>${escapeHtml(order.packageName)} · ${order.senderMode === 'named' ? 'Có tên' : 'Ẩn danh'} · ${escapeHtml(getPaymentInfo(order).methodLabel)}</span>
        <span>${formatDateTime(order.createdAt)}</span>
      </div>
      <div class="order-card__bottom">
        <strong>${fHtml(order.totalPrice)}</strong>
        <span class="order-card__link">${order.status === ORDER_STATUS.PENDING_PAYMENT ? 'Thanh toán →' : 'Xem chi tiết →'}</span>
      </div>
    </a>
  `).join('');
}

document.addEventListener('DOMContentLoaded', init);
