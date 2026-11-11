/**
 * dashboard/wallets.js — Dashboard > Ví người dùng
 * Tra cứu số dư + sổ cái của một tài khoản (email hoặc UID). Chỉ đọc.
 * Có đối chiếu: tổng các biến động trong sổ cái phải bằng số dư hiện tại.
 */
import { initDashboardLayout } from '../layouts/dashboard-layout.js';
import { requireAdmin } from '../utils/router-guard.js';
import { renderBackButton } from '../components/back-button.js';
import { qs, escapeHtml } from '../utils/dom.js';
import { formatDateTime, fHtml } from '../utils/formatters.js';
import { initAuthData } from '../services/authService.js';
import { getBalance, getLedger, findUserByEmail, getUserById } from '../services/walletService.js';
import { ROUTES, LEDGER_TYPE_LABEL } from '../config/constants.js';

async function init() {
  initAuthData();
  const admin = await requireAdmin();
  if (!admin) return;
  await initDashboardLayout({ activeKey: 'wallets', breadcrumb: [{ label: 'Dashboard', href: ROUTES.DASHBOARD }, { label: 'Ví người dùng' }] });
  renderBackButton('#pageBack', { fallbackHref: ROUTES.DASHBOARD });

  qs('#lookupForm').addEventListener('submit', (e) => { e.preventDefault(); lookup(qs('#lookupInput').value); });
  const uid = new URLSearchParams(window.location.search).get('uid');
  if (uid) { qs('#lookupInput').value = uid; lookup(uid); }
}

async function lookup(rawInput) {
  const input = String(rawInput || '').trim();
  const err = qs('#lookupError');
  const out = qs('#lookupResult');
  err.textContent = '';
  out.innerHTML = '';
  if (!input) { err.textContent = 'Vui lòng nhập email hoặc UID.'; return; }

  out.innerHTML = '<div class="inline-loading"><span class="spinner"></span> Đang tra cứu...</div>';
  try {
    let user = null;
    if (input.includes('@')) {
      const found = await findUserByEmail(input);
      user = found[0] || null;
    } else {
      user = await getUserById(input.replace(/\//g, ''));
    }
    if (!user) { out.innerHTML = ''; err.textContent = 'Không tìm thấy tài khoản này.'; return; }

    const [balance, ledger] = await Promise.all([getBalance(user.id), getLedger(user.id)]);
    const sum = ledger.reduce((s, e) => s + (Number(e.delta) || 0), 0);
    const consistent = sum === balance;

    out.innerHTML = `
      <section class="card wallet-item">
        <header class="wallet-item__head"><strong>${escapeHtml(user.fullName || '—')}</strong><span class="mono">${escapeHtml(user.email || '')}</span></header>
        <div class="wallet-row"><span>UID</span><strong class="mono">${escapeHtml(user.id)}</strong></div>
        <div class="wallet-row"><span>Số dư hiện tại</span><strong>${fHtml(balance)}</strong></div>
        <div class="wallet-row"><span>Tổng biến động trong sổ cái</span><strong>${fHtml(sum)}</strong></div>
        <p class="wallet-reason ${consistent ? '' : 'is-warning'}">${consistent ? '✓ Sổ cái khớp với số dư.' : '⚠ Sổ cái KHÔNG khớp số dư — hãy kiểm tra thủ công.'}</p>
      </section>
      <h3 class="wallet-section-title">Sổ cái (${ledger.length})</h3>
      <div class="admin-cards">${ledger.length ? ledger.map(renderEntry).join('') : '<div class="wallet-empty">Chưa có biến động nào.</div>'}</div>`;
  } catch (error) {
    console.error('[wallets] lỗi:', error);
    out.innerHTML = '';
    err.textContent = 'Không tải được dữ liệu (kiểm tra quyền admin và Firestore Rules).';
  }
}

function renderEntry(e) {
  return `
    <article class="card wallet-item">
      <header class="wallet-item__head">
        <strong>${escapeHtml(LEDGER_TYPE_LABEL[e.type] || e.type)}</strong>
        <span class="wallet-delta ${e.delta >= 0 ? 'is-plus' : 'is-minus'}">${e.delta >= 0 ? '+' : '−'}${fHtml(Math.abs(e.delta))}</span>
      </header>
      <p class="wallet-note">${escapeHtml(e.note || '')}</p>
      <div class="wallet-row"><span>Số dư sau</span><strong>${fHtml(e.balanceAfter)}</strong></div>
      <div class="wallet-row"><span>Tham chiếu</span><strong class="mono">${escapeHtml(e.refCode || e.refId || '')}</strong></div>
      <div class="wallet-row"><span>Thực hiện bởi</span><strong>${e.actorRole === 'admin' ? 'Admin' : 'Khách hàng'} <small class="mono">${escapeHtml(e.actor || '')}</small></strong></div>
      <div class="wallet-row"><span>Thời gian</span><strong>${escapeHtml(formatDateTime(e.createdAt))}</strong></div>
      <div class="wallet-row"><span>Mã bản ghi</span><strong class="mono"><small>${escapeHtml(e.id)}</small></strong></div>
    </article>`;
}

document.addEventListener('DOMContentLoaded', init);
