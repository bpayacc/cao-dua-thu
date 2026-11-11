/**
 * pages/wallet.js — điểm vào JS cho trang Ví của tôi (vi-cua-toi.html)
 * Hiển thị số dư F, nạp F (tạo yêu cầu → chuyển khoản → CHỜ admin xác nhận), lịch sử nạp,
 * lịch sử thanh toán đơn và biến động ví (sổ cái). Số dư chỉ được ĐỌC ở đây; mọi thay đổi do máy chủ làm.
 */
import { renderHeader } from '../components/header.js';
import { renderFooter } from '../components/footer.js';
import { renderBackButton } from '../components/back-button.js';
import { renderPaymentBox } from '../components/payment-box.js';
import { showToast } from '../components/toast.js';
import { requireAuth } from '../utils/router-guard.js';
import { qs, qsa, escapeHtml } from '../utils/dom.js';
import { formatDateTime, formatNumber, fHtml } from '../utils/formatters.js';
import { getPaymentInfo } from '../utils/payment-info.js';
import { initAuthData } from '../services/authService.js';
import { getBalance, getLedger, getTopupsByUser, createTopup, validateTopupAmount } from '../services/walletService.js';
import { getOrdersByCustomer } from '../services/orderService.js';
import { newRequestId } from '../services/apiClient.js';
import {
  ROUTES, TOPUP_STATUS, TOPUP_STATUS_LABEL, LEDGER_TYPE_LABEL, PAYMENT_STATUS, ORDER_STATUS, ORDER_STATUS_LABEL,
  WALLET_TOPUP_MIN, WALLET_TOPUP_MAX, WALLET_TOPUP_QUICK_AMOUNTS,
} from '../config/constants.js';

const TOPUP_BADGE = { [TOPUP_STATUS.PENDING]: 'pending_payment', [TOPUP_STATUS.CONFIRMED]: 'sent', [TOPUP_STATUS.REJECTED]: 'failed' };
const PAYMENT_BADGE = { [PAYMENT_STATUS.UNPAID]: 'pending_payment', [PAYMENT_STATUS.PAID]: 'sent', [PAYMENT_STATUS.REFUNDED]: 'refunded' };

let user = null;
let activeTab = 'topups';
let data = { topups: null, orders: null, ledger: null }; // null = chưa tải / lỗi
let errors = { topups: '', orders: '', ledger: '' };
let topupRequestId = null;
let isCreating = false;

async function init() {
  initAuthData();
  await renderHeader('#app-header');
  renderFooter('#app-footer');

  user = await requireAuth();
  if (!user) return;
  renderBackButton('#pageBack', { fallbackHref: ROUTES.HOME });

  setupTopupPanel();
  qsa('#walletTabs [data-tab]').forEach((btn) => btn.addEventListener('click', () => {
    activeTab = btn.dataset.tab;
    qsa('#walletTabs .filter-tab').forEach((b) => b.classList.toggle('is-active', b === btn));
    renderList();
  }));

  await loadAll();
  if (window.location.hash === '#nap') openTopup();
}

async function loadAll() {
  qs('#walletList').innerHTML = '<div class="inline-loading"><span class="spinner"></span> Đang tải ví của bạn...</div>';
  const settle = async (key, fn) => {
    try { data[key] = await fn(); errors[key] = ''; } catch (error) { data[key] = null; errors[key] = 'Không tải được dữ liệu. Vui lòng thử lại sau.'; console.error(`[wallet] ${key}:`, error); }
  };
  await Promise.all([
    refreshBalance(),
    settle('topups', () => getTopupsByUser(user.id)),
    settle('orders', () => getOrdersByCustomer(user.id)),
    settle('ledger', () => getLedger(user.id)),
  ]);
  renderList();
}

async function refreshBalance() {
  const el = qs('#balanceAmount');
  try {
    el.innerHTML = fHtml(await getBalance(user.id));
  } catch (error) {
    el.textContent = 'Không đọc được số dư';
  }
}

/* ===================== Nạp F ===================== */

function setupTopupPanel() {
  qs('#openTopupBtn').addEventListener('click', openTopup);
  qs('#closeTopupBtn').addEventListener('click', () => qs('#topupPanel').classList.add('is-hidden'));

  qs('#topupChips').innerHTML = WALLET_TOPUP_QUICK_AMOUNTS
    .map((n) => `<button type="button" class="chip" data-amount="${n}">${formatNumber(n)}</button>`).join('');
  qs('#topupHint').textContent = `Tối thiểu ${formatNumber(WALLET_TOPUP_MIN)} F, tối đa ${formatNumber(WALLET_TOPUP_MAX)} F mỗi lần.`;

  const input = qs('#topupAmount');
  input.addEventListener('input', () => {
    input.value = input.value.replace(/[^\d]/g, '').slice(0, 9);
    topupRequestId = null; // đổi số tiền → yêu cầu mới
    qs('#topupError').textContent = '';
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submitTopup(); } });
  qsa('#topupChips .chip').forEach((chip) => chip.addEventListener('click', () => {
    input.value = chip.dataset.amount;
    topupRequestId = null;
    qs('#topupError').textContent = '';
  }));
  qs('#createTopupBtn').addEventListener('click', submitTopup);
}

function openTopup() {
  const panel = qs('#topupPanel');
  panel.classList.remove('is-hidden');
  qs('#topupForm').classList.remove('is-hidden');
  qs('#topupResult').classList.add('is-hidden');
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function submitTopup() {
  if (isCreating) return;
  const amount = Number(qs('#topupAmount').value);
  const problem = validateTopupAmount(amount);
  if (problem) { qs('#topupError').textContent = problem; return; }

  isCreating = true;
  const btn = qs('#createTopupBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner spinner--light"></span> Đang tạo...';

  if (!topupRequestId) topupRequestId = newRequestId();
  const res = await createTopup(amount, topupRequestId);

  isCreating = false;
  btn.disabled = false;
  btn.textContent = 'Tạo yêu cầu nạp';

  if (!res.success) {
    if (!['NETWORK', 'BAD_RESPONSE', 'INTERNAL', 'FUNCTION_UNAVAILABLE'].includes(res.code)) topupRequestId = null;
    qs('#topupError').textContent = res.message;
    showToast(res.message, 'error', 5000);
    return;
  }

  topupRequestId = null;
  showTopupInstructions(res.topup);
  showToast('Đã tạo yêu cầu nạp. F chưa được cộng cho tới khi Cáo xác nhận.', 'success', 4000);
  try { data.topups = await getTopupsByUser(user.id); } catch (e) { /* giữ dữ liệu cũ */ }
  if (activeTab === 'topups') renderList();
}

function showTopupInstructions(topup) {
  qs('#topupForm').classList.add('is-hidden');
  const box = qs('#topupResult');
  box.classList.remove('is-hidden');
  box.innerHTML = `
    <div class="notice notice--info">
      <strong>Yêu cầu nạp ${escapeHtml(topup.code)}</strong> đang <strong>chờ xác nhận</strong>.
      Số dư <strong>chưa thay đổi</strong>: Cáo chỉ cộng ${fHtml(topup.fAmount)} sau khi kiểm tra tiền thực nhận.
    </div>
    <div id="topupPayment"></div>
    <button type="button" class="btn btn--outline btn--block" id="topupAnotherBtn">Nạp thêm / quay lại</button>
  `;
  renderPaymentBox('#topupPayment', { code: topup.code, totalPrice: topup.amount }, { kind: 'topup' });
  qs('#topupAnotherBtn').addEventListener('click', () => { qs('#topupAmount').value = ''; openTopup(); });
}

/* ===================== Danh sách lịch sử ===================== */

function renderList() {
  const list = qs('#walletList');
  const render = { topups: renderTopups, payments: renderPayments, ledger: renderLedger }[activeTab];
  const sourceKey = activeTab === 'payments' ? 'orders' : activeTab;
  if (errors[sourceKey]) { list.innerHTML = `<p class="form-error">${escapeHtml(errors[sourceKey])}</p>`; return; }
  list.innerHTML = render();
  qsa('[data-show-topup]', list).forEach((btn) => btn.addEventListener('click', () => {
    const topup = data.topups.find((t) => t.id === btn.dataset.showTopup);
    if (!topup) return;
    qs('#topupPanel').classList.remove('is-hidden');
    showTopupInstructions(topup);
    qs('#topupPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
}

const empty = (text) => `<div class="wallet-empty">${escapeHtml(text)}</div>`;
const row = (label, valueHtml) => `<div class="wallet-row"><span>${label}</span><strong>${valueHtml}</strong></div>`;

function renderTopups() {
  if (!data.topups.length) return empty('Bạn chưa có yêu cầu nạp nào.');
  return data.topups.map((t) => `
    <article class="card wallet-item">
      <header class="wallet-item__head">
        <span class="mono wallet-item__code">${escapeHtml(t.code)}</span>
        <span class="badge badge--${TOPUP_BADGE[t.status] || 'cancelled'}">${TOPUP_STATUS_LABEL[t.status] || escapeHtml(t.status)}</span>
      </header>
      ${row('Số tiền nạp', `${formatNumber(t.amount)} VNĐ`)}
      ${row('Số F nhận được', t.status === TOPUP_STATUS.CONFIRMED ? fHtml(t.fAmount) : `<span class="text-muted">Chưa cộng (sẽ nhận ${fHtml(t.fAmount)})</span>`)}
      ${row('Thời gian', escapeHtml(formatDateTime(t.createdAt)))}
      ${t.status === TOPUP_STATUS.REJECTED ? `<p class="wallet-reason"><strong>Lý do từ chối:</strong> ${escapeHtml(t.rejectReason || '—')}</p>` : ''}
      ${t.status === TOPUP_STATUS.PENDING ? `<button type="button" class="btn btn--outline btn--sm" data-show-topup="${escapeHtml(t.id)}">Xem thông tin chuyển khoản</button>` : ''}
    </article>`).join('');
}

function renderPayments() {
  if (!data.orders.length) return empty('Bạn chưa có đơn hàng nào.');
  return data.orders.map((o) => {
    const p = getPaymentInfo(o);
    const amount = p.isWallet ? (p.paymentStatus === PAYMENT_STATUS.REFUNDED ? `${fHtml(o.walletAmount || o.totalPrice)} <small>(đã dùng, đã hoàn)</small>` : `${fHtml(o.walletAmount || o.totalPrice)} <small>(đã dùng)</small>`)
      : `${fHtml(o.totalPrice)} <small>(chuyển khoản)</small>`;
    return `
    <a class="card card--hover wallet-item" href="${ROUTES.ORDER_DETAIL}?id=${encodeURIComponent(o.id)}">
      <header class="wallet-item__head">
        <span class="mono wallet-item__code">${escapeHtml(o.code)}</span>
        <span class="badge badge--${PAYMENT_BADGE[p.paymentStatus] || 'cancelled'}">${escapeHtml(p.paymentStatusLabel)}</span>
      </header>
      ${row('Gói thư', escapeHtml(o.packageName))}
      ${row(p.isWallet ? 'Số F đã dùng' : 'Số tiền', amount)}
      ${row('Phương thức', escapeHtml(p.methodLabel))}
      ${row('Thời gian', escapeHtml(formatDateTime(o.paidAt || o.createdAt)))}
      ${row('Trạng thái đơn', escapeHtml(ORDER_STATUS_LABEL[o.status] || o.status))}
      ${o.status === ORDER_STATUS.CANCELLED && p.refundStatusLabel ? `<p class="wallet-reason"><strong>Hoàn tiền:</strong> ${escapeHtml(p.refundStatusLabel)}</p>` : ''}
    </a>`;
  }).join('');
}

function renderLedger() {
  if (!data.ledger.length) return empty('Chưa có biến động số dư nào.');
  return data.ledger.map((e) => `
    <article class="card wallet-item">
      <header class="wallet-item__head">
        <strong>${escapeHtml(LEDGER_TYPE_LABEL[e.type] || e.type)}</strong>
        <span class="wallet-delta ${e.delta >= 0 ? 'is-plus' : 'is-minus'}">${e.delta >= 0 ? '+' : '−'}${fHtml(Math.abs(e.delta))}</span>
      </header>
      <p class="wallet-note">${escapeHtml(e.note || '')}</p>
      ${row('Số dư sau giao dịch', fHtml(e.balanceAfter))}
      ${row('Thời gian', escapeHtml(formatDateTime(e.createdAt)))}
    </article>`).join('');
}

document.addEventListener('DOMContentLoaded', init);
