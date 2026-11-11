/**
 * dashboard/topups.js — Dashboard > Nạp F
 * Admin kiểm tra TIỀN THỰC NHẬN rồi mới xác nhận (cộng F) hoặc từ chối (bắt buộc lý do).
 * Việc cộng F do Netlify Function admin-topup thực hiện trong transaction + ghi sổ cái; trang này chỉ gọi API.
 */
import { initDashboardLayout } from '../layouts/dashboard-layout.js';
import { requireAdmin } from '../utils/router-guard.js';
import { showToast } from '../components/toast.js';
import { confirmDialog } from '../components/confirm-dialog.js';
import { openModal } from '../components/modal.js';
import { renderBackButton } from '../components/back-button.js';
import { qs, qsa, createEl, escapeHtml } from '../utils/dom.js';
import { formatDateTime, formatNumber, formatF, fHtml } from '../utils/formatters.js';
import { initAuthData } from '../services/authService.js';
import { getAllTopups, decideTopup } from '../services/walletService.js';
import { topupTransferContent } from '../utils/topup.js';
import { ROUTES, TOPUP_STATUS, TOPUP_STATUS_LABEL } from '../config/constants.js';

const BADGE = { [TOPUP_STATUS.PENDING]: 'pending_payment', [TOPUP_STATUS.CONFIRMED]: 'sent', [TOPUP_STATUS.REJECTED]: 'failed' };
const TABS = [
  { key: TOPUP_STATUS.PENDING, label: TOPUP_STATUS_LABEL[TOPUP_STATUS.PENDING] },
  { key: TOPUP_STATUS.CONFIRMED, label: TOPUP_STATUS_LABEL[TOPUP_STATUS.CONFIRMED] },
  { key: TOPUP_STATUS.REJECTED, label: TOPUP_STATUS_LABEL[TOPUP_STATUS.REJECTED] },
  { key: 'all', label: 'Tất cả' },
];

let topups = [];
let activeTab = TOPUP_STATUS.PENDING;
let search = '';
let busy = false;

async function init() {
  initAuthData();
  const admin = await requireAdmin();
  if (!admin) return;
  await initDashboardLayout({ activeKey: 'topups', breadcrumb: [{ label: 'Dashboard', href: ROUTES.DASHBOARD }, { label: 'Nạp F' }] });
  renderBackButton('#pageBack', { fallbackHref: ROUTES.DASHBOARD });

  qs('#topupSearch').addEventListener('input', (e) => { search = e.target.value.trim().toLowerCase(); render(); });
  await load();
}

async function load() {
  qs('#topupsLoading').classList.remove('is-hidden');
  qs('#topupsContent').classList.add('is-hidden');
  try {
    topups = await getAllTopups();
  } catch (error) {
    showToast('Không tải được yêu cầu nạp (kiểm tra Firestore Rules).', 'error', 5000);
    topups = [];
  }
  qs('#topupsLoading').classList.add('is-hidden');
  qs('#topupsContent').classList.remove('is-hidden');
  render();
}

function render() {
  const tabs = qs('#topupTabs');
  tabs.innerHTML = TABS.map((t) => {
    const count = t.key === 'all' ? topups.length : topups.filter((x) => x.status === t.key).length;
    return `<button type="button" class="filter-tab ${t.key === activeTab ? 'is-active' : ''}" data-tab="${t.key}">${t.label} <span>${count}</span></button>`;
  }).join('');
  qsa('.filter-tab', tabs).forEach((b) => b.addEventListener('click', () => { activeTab = b.dataset.tab; render(); }));

  const rows = topups.filter((t) => (activeTab === 'all' || t.status === activeTab)
    && (!search || [t.code, t.userName, t.userEmail, topupTransferContent(t.code)].join(' ').toLowerCase().includes(search)));

  const list = qs('#topupList');
  if (!rows.length) { list.innerHTML = '<div class="wallet-empty">Không có yêu cầu nạp nào.</div>'; return; }

  list.innerHTML = rows.map((t) => `
    <article class="card wallet-item">
      <header class="wallet-item__head">
        <span class="mono wallet-item__code">${escapeHtml(t.code)}</span>
        <span class="badge badge--${BADGE[t.status] || 'cancelled'}">${TOPUP_STATUS_LABEL[t.status] || escapeHtml(t.status)}</span>
      </header>
      <div class="wallet-row"><span>Người nạp</span><strong>${escapeHtml(t.userName)}<br><small>${escapeHtml(t.userEmail)}</small></strong></div>
      <div class="wallet-row"><span>Số tiền cần nhận</span><strong>${formatNumber(t.amount)} VNĐ</strong></div>
      <div class="wallet-row"><span>Sẽ cộng</span><strong>${fHtml(t.fAmount)}</strong></div>
      <div class="wallet-row"><span>Nội dung CK</span><strong class="mono">${escapeHtml(topupTransferContent(t.code))}</strong></div>
      <div class="wallet-row"><span>Thời gian</span><strong>${escapeHtml(formatDateTime(t.createdAt))}</strong></div>
      ${t.status === TOPUP_STATUS.CONFIRMED ? `<p class="wallet-reason">Đã xác nhận bởi <strong>${escapeHtml(t.confirmedByEmail || t.confirmedBy || '—')}</strong> lúc ${escapeHtml(formatDateTime(t.confirmedAt))}</p>` : ''}
      ${t.status === TOPUP_STATUS.REJECTED ? `<p class="wallet-reason"><strong>Lý do từ chối:</strong> ${escapeHtml(t.rejectReason || '—')}<br>Bởi ${escapeHtml(t.rejectedByEmail || '—')} lúc ${escapeHtml(formatDateTime(t.rejectedAt))}</p>` : ''}
      <div class="admin-actions">
        ${t.status === TOPUP_STATUS.PENDING ? `<button class="btn btn--primary btn--sm" data-act="confirm" data-id="${escapeHtml(t.id)}">Xác nhận đã nhận tiền</button><button class="btn btn--outline btn--sm" data-act="reject" data-id="${escapeHtml(t.id)}">Từ chối</button>` : ''}
        <a class="btn btn--ghost btn--sm" href="${ROUTES.DASHBOARD_WALLETS}?uid=${encodeURIComponent(t.userId)}">Xem ví</a>
      </div>
    </article>`).join('');

  qsa('[data-act]', list).forEach((btn) => btn.addEventListener('click', () => act(btn.dataset.act, btn.dataset.id)));
}

async function act(action, id) {
  if (busy) return;
  const topup = topups.find((t) => t.id === id);
  if (!topup) return;
  if (action === 'reject') { openRejectModal(topup); return; }

  const ok = await confirmDialog({
    title: 'Xác nhận đã nhận tiền',
    message: `Chỉ xác nhận khi tài khoản ngân hàng ĐÃ nhận ${formatNumber(topup.amount)} VNĐ với nội dung "${topupTransferContent(topup.code)}". Hệ thống sẽ cộng ${formatF(topup.fAmount)} vào ví của ${topup.userName}.`,
    confirmLabel: 'Xác nhận & cộng F',
  });
  if (ok) await send(topup, 'confirm', '');
}

function openRejectModal(topup) {
  const textarea = createEl('textarea', { class: 'form-control', rows: '3', maxlength: '300', placeholder: 'VD: Chưa thấy tiền về / sai số tiền / sai nội dung chuyển khoản...' });
  const error = createEl('p', { class: 'form-error' });
  const body = createEl('div', {}, [createEl('p', { class: 'text-muted' }, `Từ chối ${topup.code}. Lý do này hiển thị cho khách hàng.`), textarea, error]);
  const cancelBtn = createEl('button', { type: 'button', class: 'btn btn--ghost' }, 'Đóng');
  const okBtn = createEl('button', { type: 'button', class: 'btn btn--primary' }, 'Từ chối yêu cầu');
  const { close } = openModal({ title: 'Từ chối nạp F', bodyNode: body, footerNode: createEl('div', { style: 'display:flex; justify-content:flex-end; gap:8px;' }, [cancelBtn, okBtn]) });
  cancelBtn.addEventListener('click', close);
  okBtn.addEventListener('click', async () => {
    const reason = textarea.value.trim();
    if (reason.length < 3) { error.textContent = 'Vui lòng nhập lý do (tối thiểu 3 ký tự).'; return; }
    okBtn.disabled = true;
    close();
    await send(topup, 'reject', reason);
  });
}

async function send(topup, action, reason) {
  busy = true;
  const res = await decideTopup(topup.id, action, reason);
  busy = false;
  if (!res.success) { showToast(res.message || 'Không thực hiện được.', 'error', 5000); return; }
  showToast(res.alreadyDone ? 'Giao dịch này đã được xử lý trước đó (không cộng thêm).'
    : action === 'confirm' ? `Đã cộng ${formatF(topup.fAmount)} cho ${topup.userName}.` : 'Đã từ chối yêu cầu nạp.', 'success', 4000);
  await load();
}

document.addEventListener('DOMContentLoaded', init);
