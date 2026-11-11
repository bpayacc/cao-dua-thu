/**
 * dashboard/orders.js — Dashboard > Quản lý đơn (don-hang.html)
 * Quy trình admin: Chờ thanh toán → (đối soát tiền về) Đã thanh toán → Đang xử lý
 * → Đã gửi thư, hoặc Không thể gửi (kèm lý do). Mọi bước do admin bấm thủ công —
 * hệ thống KHÔNG tự đánh dấu thanh toán hay đã gửi.
 */
import { initDashboardLayout } from '../layouts/dashboard-layout.js';
import { requireAdmin } from '../utils/router-guard.js';
import { showToast } from '../components/toast.js';
import { confirmDialog } from '../components/confirm-dialog.js';
import { openModal } from '../components/modal.js';
import { renderPagination } from '../components/pagination.js';
import { renderBackButton } from '../components/back-button.js';
import { getTransferContent } from '../components/payment-box.js';
import { qs, qsa, createEl, escapeHtml } from '../utils/dom.js';
import { formatCurrency, formatDateTime, formatF, fHtml } from '../utils/formatters.js';
import { getPaymentInfo } from '../utils/payment-info.js';
import { composeLetterMessage } from '../utils/letter-format.js';
import { initAuthData } from '../services/authService.js';
import { getAllOrders, updateOrderStatus, markBankRefundDone, markBankRefundNeeded } from '../services/orderService.js';
import { ORDER_STATUS, ORDER_STATUS_LABEL, SENDER_MODE, ROUTES, REFUND_STATUS, PAYMENT_STATUS } from '../config/constants.js';

const PAGE_SIZE = 8;

// Bộ lọc: theo trạng thái đơn + hai bộ lọc hoàn tiền (đơn chuyển khoản cần hoàn thủ công / đơn đã hoàn F)
const STATUS_TABS = [
  { key: 'all', label: 'Tất cả', match: () => true },
  ...Object.values(ORDER_STATUS).map((key) => ({ key, label: ORDER_STATUS_LABEL[key], match: (o) => o.status === key })),
  { key: 'expired', label: 'Hết hạn thanh toán', match: (o) => o.status === ORDER_STATUS.CANCELLED && o.cancelledBy === 'system' },
  { key: 'bank_refund', label: 'Cần hoàn tiền NH', match: (o) => o.status === ORDER_STATUS.CANCELLED && o.refundStatus === REFUND_STATUS.BANK_MANUAL },
  { key: 'refunded_f', label: 'Đã hoàn F', match: (o) => o.refundStatus === REFUND_STATUS.REFUNDED_F },
];

let allOrders = [];
let activeTab = 'all';
let searchQuery = '';
let currentPage = 1;

async function init() {
  initAuthData();
  const admin = await requireAdmin();
  if (!admin) return;

  await initDashboardLayout({
    activeKey: 'orders',
    breadcrumb: [{ label: 'Dashboard', href: ROUTES.DASHBOARD }, { label: 'Quản lý đơn' }],
  });
  renderBackButton('#pageBack', { fallbackHref: ROUTES.DASHBOARD });

  qs('#orderSearchInput').addEventListener('input', (e) => {
    searchQuery = e.target.value.trim().toLowerCase();
    currentPage = 1;
    renderTable();
  });
  await loadOrders();
}

async function loadOrders() {
  showLoading(true);
  try {
    allOrders = await getAllOrders();
    renderStatCards();
    renderTabs();
    renderTable();
  } catch (error) {
    showToast(error.message, 'error', 5000);
  } finally {
    showLoading(false);
  }
}

function showLoading(isLoading) {
  qs('#ordersLoading').classList.toggle('is-hidden', !isLoading);
  qs('#ordersContent').classList.toggle('is-hidden', isLoading);
}

const countBy = (status) => allOrders.filter((o) => o.status === status).length;

function renderStatCards() {
  qs('#statCards').innerHTML = `
    <div class="card stat-card"><span class="stat-card__label">Tổng số đơn</span><strong>${allOrders.length}</strong></div>
    <div class="card stat-card"><span class="stat-card__label">Chờ thanh toán</span><strong class="stat-card__value--warning">${countBy(ORDER_STATUS.PENDING_PAYMENT)}</strong></div>
    <div class="card stat-card"><span class="stat-card__label">Cần xử lý (đã thanh toán)</span><strong class="stat-card__value--primary">${countBy(ORDER_STATUS.PAID)}</strong></div>
    <div class="card stat-card"><span class="stat-card__label">Đã gửi thư</span><strong class="stat-card__value--success">${countBy(ORDER_STATUS.SENT)}</strong></div>
    <div class="card stat-card"><span class="stat-card__label">Cần hoàn tiền ngân hàng</span><strong class="stat-card__value--warning">${allOrders.filter(STATUS_TABS.find((t) => t.key === 'bank_refund').match).length}</strong></div>
  `;
}

function renderTabs() {
  const container = qs('#statusTabs');
  container.innerHTML = STATUS_TABS.map((tab) => {
    const count = allOrders.filter(tab.match).length;
    return `<button type="button" class="filter-tab ${tab.key === activeTab ? 'is-active' : ''}" data-tab="${tab.key}">${tab.label} <span>${count}</span></button>`;
  }).join('');
  qsa('.filter-tab', container).forEach((btn) => btn.addEventListener('click', () => {
    activeTab = btn.dataset.tab;
    currentPage = 1;
    renderTabs();
    renderTable();
  }));
}

function getFilteredOrders() {
  return allOrders.filter((o) => {
    const matchesTab = STATUS_TABS.find((t) => t.key === activeTab).match(o);
    const haystack = [o.code, o.customerName, o.customerEmail, o.recipientTiktok, getTransferContent(o)].join(' ').toLowerCase();
    return matchesTab && (!searchQuery || haystack.includes(searchQuery));
  });
}

function renderTable() {
  const filtered = getFilteredOrders();
  const tbody = qs('#ordersTableBody');
  const emptyEl = qs('#ordersEmpty');
  const tableWrap = qs('#ordersTableWrap');

  if (!filtered.length) {
    tbody.innerHTML = '';
    tableWrap.classList.add('is-hidden');
    emptyEl.classList.remove('is-hidden');
    renderPagination('#ordersPagination', { totalItems: 0, pageSize: PAGE_SIZE, currentPage: 1, onPageChange: () => {} });
    return;
  }
  tableWrap.classList.remove('is-hidden');
  emptyEl.classList.add('is-hidden');

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  currentPage = Math.min(currentPage, totalPages);
  const pageItems = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  tbody.innerHTML = pageItems.map((order) => {
    const pay = getPaymentInfo(order);
    return `
    <tr>
      <td data-label="Mã đơn"><strong class="mono">${escapeHtml(order.code)}</strong><br><span class="order-meta">${formatDateTime(order.createdAt)}</span></td>
      <td data-label="Khách hàng">${escapeHtml(order.customerName)}<br><span class="order-meta">${escapeHtml(order.customerEmail)}</span></td>
      <td data-label="Gói / Người nhận">${escapeHtml(order.packageName)} · ${order.senderMode === SENDER_MODE.NAMED ? 'Có tên' : 'Ẩn danh'}<br><span class="mono">@${escapeHtml(order.recipientTiktok)}</span></td>
      <td data-label="Tổng tiền">${fHtml(order.totalPrice)}</td>
      <td data-label="Thanh toán">${escapeHtml(pay.methodLabel)}<br><span class="order-meta">${escapeHtml(pay.paymentStatusLabel)}${pay.refundStatusLabel ? ` · <strong>${escapeHtml(pay.refundStatusLabel)}</strong>` : ''}</span></td>
      <td data-label="Trạng thái"><span class="badge badge--${order.status}">${ORDER_STATUS_LABEL[order.status]}</span>${order.statusNote ? `<br><span class="order-meta">${escapeHtml(order.statusNote)}</span>` : ''}${order.refundNote ? `<br><span class="order-meta">Hoàn tiền: ${escapeHtml(order.refundNote)}</span>` : ''}</td>
      <td data-label="Hành động" class="orders-table__actions">${renderRowActions(order)}</td>
    </tr>`;
  }).join('');

  qsa('[data-action]', tbody).forEach((btn) => btn.addEventListener('click', () => handleAction(btn.dataset.action, btn.dataset.id)));
  renderPagination('#ordersPagination', {
    totalItems: filtered.length, pageSize: PAGE_SIZE, currentPage,
    onPageChange: (page) => { currentPage = page; renderTable(); },
  });
}

function renderRowActions(order) {
  const btn = (action, label, cls) => `<button class="btn ${cls} btn--sm" data-action="${action}" data-id="${order.id}">${label}</button>`;
  const view = btn('view', 'Xem thư', 'btn--outline');
  switch (order.status) {
    case ORDER_STATUS.PENDING_PAYMENT:
      return view + btn('mark_paid', 'Đã nhận tiền', 'btn--dark') + btn('cancel', 'Hủy đơn', 'btn--ghost');
    case ORDER_STATUS.PAID:
      return view + btn('start', 'Bắt đầu xử lý', 'btn--dark') + btn('fail', 'Không thể gửi', 'btn--ghost');
    case ORDER_STATUS.PROCESSING:
      return view + btn('sent', 'Đã gửi thư', 'btn--primary') + btn('fail', 'Không thể gửi', 'btn--ghost');
    case ORDER_STATUS.CANCELLED:
      if (order.cancelledBy === 'system' && (!order.refundStatus || order.refundStatus === REFUND_STATUS.NONE)) return view + btn('need_refund', 'Khách đã chuyển → cần hoàn', 'btn--ghost');
      return view + (order.refundStatus === REFUND_STATUS.BANK_MANUAL ? btn('bank_refunded', 'Đã hoàn tiền NH', 'btn--dark') : '');
    default:
      return view;
  }
}

const ACTIONS = {
  mark_paid: {
    title: 'Xác nhận đã nhận tiền',
    message: (o) => `Chỉ xác nhận khi tiền ${formatCurrency(o.totalPrice)} với nội dung "${getTransferContent(o)}" ĐÃ VỀ tài khoản. Chuyển đơn ${o.code} sang "Đã thanh toán"?`,
    label: 'Đã nhận tiền', next: ORDER_STATUS.PAID, ok: 'Đã ghi nhận thanh toán.',
  },
  start: {
    title: 'Bắt đầu xử lý', message: (o) => `Chuyển đơn ${o.code} sang "Đang xử lý"? Sau bước này khách hàng không thể tự hủy đơn${getPaymentInfo(o).isWallet ? ' / hoàn F' : ''} nữa.`,
    label: 'Bắt đầu', next: ORDER_STATUS.PROCESSING, ok: 'Đơn đã chuyển sang Đang xử lý.',
    // sau bước này khách không còn tự hủy / hoàn F được nữa
  },
  sent: {
    title: 'Xác nhận đã gửi thư',
    message: (o) => `Chỉ xác nhận khi bạn ĐÃ gửi thư đến @${o.recipientTiktok} trên TikTok. Chuyển đơn ${o.code} sang "Đã gửi thư"?`,
    label: 'Đã gửi thư', next: ORDER_STATUS.SENT, ok: 'Đơn đã được đánh dấu đã gửi thư.',
  },
  cancel: {
    title: 'Hủy đơn', message: (o) => `Hủy đơn ${o.code}? Hành động này không thể hoàn tác.`,
    label: 'Hủy đơn', next: ORDER_STATUS.CANCELLED, ok: 'Đã hủy đơn.', danger: true,
  },
};

async function handleAction(action, orderId) {
  const order = allOrders.find((o) => o.id === orderId);
  if (!order) return;

  if (action === 'view') { openLetterModal(order); return; }
  if (action === 'bank_refunded') { await handleBankRefundDone(order); return; }
  if (action === 'need_refund') { await handleNeedRefund(order); return; }
  if (action === 'fail') { openFailModal(order); return; }

  const config = ACTIONS[action];
  if (!config) return;
  const confirmed = await confirmDialog({
    title: config.title, message: config.message(order), confirmLabel: config.label, danger: !!config.danger,
  });
  if (!confirmed) return;
  await applyStatus(order, config.next, '', config.ok);
}

async function handleNeedRefund(order) {
  const ok = await confirmDialog({
    title: 'Khách báo đã chuyển khoản',
    message: `Đơn ${order.code} đã tự hủy vì quá hạn thanh toán. Nếu bạn xác nhận TIỀN ĐÃ VỀ tài khoản, hãy đánh dấu "cần hoàn tiền" để theo dõi và hoàn lại cho khách. Tiếp tục?`,
    confirmLabel: 'Đánh dấu cần hoàn',
  });
  if (!ok) return;
  const res = await markBankRefundNeeded(order.id, 'Khách chuyển khoản sau khi đơn hết hạn — cần hoàn tiền thủ công');
  showToast(res.success ? 'Đã đánh dấu cần hoàn tiền.' : res.message, res.success ? 'success' : 'error', 4000);
  if (res.success) await loadOrders();
}

async function handleBankRefundDone(order) {
  const ok = await confirmDialog({
    title: 'Đã hoàn tiền ngân hàng',
    message: `Chỉ xác nhận khi bạn ĐÃ hoàn tiền chuyển khoản của đơn ${order.code} cho khách (hoặc đã kiểm tra khách chưa chuyển khoản). Đánh dấu đã xử lý?`,
    confirmLabel: 'Đã xử lý',
  });
  if (!ok) return;
  const res = await markBankRefundDone(order.id, 'Admin đã xử lý hoàn tiền ngân hàng thủ công');
  showToast(res.success ? 'Đã đánh dấu hoàn tiền ngân hàng.' : res.message, res.success ? 'success' : 'error', 4000);
  if (res.success) await loadOrders();
}

async function applyStatus(order, nextStatus, note, successMessage) {
  const res = await updateOrderStatus(order.id, nextStatus, note);
  showToast(res.success ? successMessage : res.message, res.success ? 'success' : 'error', 4000);
  if (res.success) await loadOrders();
}

/** Hộp thoại nhập lý do "Không thể gửi" (bắt buộc) */
function openFailModal(order) {
  const textarea = createEl('textarea', {
    class: 'form-control', rows: '3', maxlength: '300',
    placeholder: 'VD: Tài khoản riêng tư / sai ID / không nhận tin nhắn từ người lạ...',
  });
  const error = createEl('p', { class: 'form-error' });
  const body = createEl('div', {}, [
    createEl('p', { class: 'text-muted' }, `Đơn ${order.code} (@${order.recipientTiktok}) sẽ chuyển sang "Không thể gửi". Lý do này hiển thị cho khách.`),
    textarea, error,
  ]);
  const cancelBtn = createEl('button', { type: 'button', class: 'btn btn--ghost' }, 'Đóng');
  const okBtn = createEl('button', { type: 'button', class: 'btn btn--primary' }, 'Xác nhận không thể gửi');
  const footer = createEl('div', { style: 'display:flex; justify-content:flex-end; gap:8px;' }, [cancelBtn, okBtn]);
  const { close } = openModal({ title: 'Không thể gửi thư', bodyNode: body, footerNode: footer });

  cancelBtn.addEventListener('click', close);
  okBtn.addEventListener('click', async () => {
    const reason = textarea.value.trim();
    if (!reason) { error.textContent = 'Vui lòng nhập lý do.'; return; }
    okBtn.disabled = true;
    close();
    await applyStatus(order, ORDER_STATUS.FAILED, reason, 'Đã đánh dấu không thể gửi.');
  });
}

function describeTikTokCheck(check) {
  if (!check) return 'không có (khách không chạy kiểm tra hoặc đơn tạo trước khi có tính năng này)';
  const label = { FOUND: `tìm thấy hồ sơ${check.authorName ? ` "${check.authorName}"` : ''}`, NOT_VERIFIED: 'chưa xác minh được hồ sơ', UNKNOWN: 'chưa kiểm tra được (lỗi kết nối)' }[check.status] || 'không rõ';
  return `${label} — lúc ${formatDateTime(check.checkedAt)}`;
}

/** Hộp thoại xem toàn bộ thư + nội dung đã định dạng để sao chép gửi TikTok */
function openLetterModal(order) {
  const body = createEl('div');
  const recipientUrl = `https://www.tiktok.com/@${encodeURIComponent(order.recipientTiktok)}`;
  body.innerHTML = `
    <div class="order-modal-section">
      <h4>Người nhận</h4>
      <div class="order-modal-row">
        <strong class="mono">@${escapeHtml(order.recipientTiktok)}</strong>
        <a class="btn btn--outline btn--sm" href="${recipientUrl}" target="_blank" rel="noopener noreferrer">Mở hồ sơ TikTok</a>
      </div>
      <p class="order-meta">Thanh toán: ${escapeHtml(getPaymentInfo(order).methodLabel)} — ${escapeHtml(getPaymentInfo(order).paymentStatusLabel)}${order.paymentMethod === 'wallet' ? ` (đã trừ ${escapeHtml(formatF(order.walletAmount || order.totalPrice))})` : ''}${getPaymentInfo(order).refundStatusLabel ? ` · ${escapeHtml(getPaymentInfo(order).refundStatusLabel)}` : ''}</p>
      <p class="order-meta">Kiểm tra TikTok (khách chạy, chưa xác thực): ${escapeHtml(describeTikTokCheck(order.tiktokCheck))}</p>
      <p class="order-meta">Hình thức: ${order.senderMode === SENDER_MODE.NAMED ? `Có tên (${escapeHtml(order.senderName)})` : 'Ẩn danh'} · Khách: ${escapeHtml(order.customerName)} (${escapeHtml(order.customerEmail)})</p>
    </div>
    <div class="order-modal-section">
      <h4>Nội dung gửi (${order.letters.length} thư)</h4>
      <div id="modalLetters"></div>
    </div>`;

  const holder = body.querySelector('#modalLetters');
  order.letters.forEach((content, i) => {
    const message = composeLetterMessage({ content, senderMode: order.senderMode, senderName: order.senderName });
    const copyBtn = createEl('button', { type: 'button', class: 'btn btn--dark btn--sm' }, 'Sao chép');
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(message);
        showToast(`Đã sao chép thư ${i + 1}.`, 'success', 1800);
      } catch (e) {
        showToast('Không sao chép được — hãy bôi đen và copy thủ công.', 'error');
      }
    });
    const pre = createEl('p', { class: 'order-modal-message' }, message);
    holder.append(createEl('strong', { class: 'order-meta' }, `Thư ${i + 1}`), pre, createEl('div', { style: 'margin-bottom:12px;' }, [copyBtn]));
  });

  const { el } = openModal({ title: `Đơn ${order.code}`, bodyNode: body });
  el.classList.add('modal--wide');
}

document.addEventListener('DOMContentLoaded', init);
