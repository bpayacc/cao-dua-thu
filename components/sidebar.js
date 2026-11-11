/**
 * components/sidebar.js
 * Sidebar điều hướng cho khu vực Dashboard Admin. Dùng chung cho mọi trang
 * quản trị — truyền activeKey để tô sáng mục đang chọn.
 */
import { mount, qs } from '../utils/dom.js';
import { ROUTES } from '../config/constants.js';

const NAV_ITEMS = [
  { key: 'overview', label: 'Tổng quan', href: ROUTES.DASHBOARD, icon: 'M4 13h6V4H4v9zM4 20h6v-5H4v5zM14 20h6V11h-6v9zM14 4v5h6V4h-6z' },
  { key: 'orders', label: 'Quản lý đơn', href: ROUTES.DASHBOARD_ORDERS, icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2M9 13h6M9 17h6' },
  { key: 'topups', label: 'Nạp F', href: ROUTES.DASHBOARD_TOPUPS, icon: 'M3 7h16a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7zm0 0l2-3h12M16 13h2' },
  { key: 'wallets', label: 'Ví người dùng', href: ROUTES.DASHBOARD_WALLETS, icon: 'M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 014-4h2a4 4 0 014 4v2zM12 7a3 3 0 11-6 0 3 3 0 016 0z' },
];

export function renderSidebar(mountSelector = '#dashboardSidebar', activeKey = '') {
  const navHtml = NAV_ITEMS.map((item) => `
    <a href="${item.href}" class="dsidebar__link ${item.key === activeKey ? 'is-active' : ''}">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="${item.icon}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <span>${item.label}</span>
    </a>
  `).join('');

  const html = `
    <a href="${ROUTES.DASHBOARD}" class="dsidebar__brand">
      <img src="/assets/img/logo-96.png" width="40" height="40" alt="Logo Cáo Đưa Thư" class="brand-logo" />
      <span>Cáo Đưa Thư<small>Quản trị</small></span>
    </a>
    <nav class="dsidebar__nav">${navHtml}</nav>
    <a href="${ROUTES.HOME}" class="dsidebar__back">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M15 18l-6-6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      Về trang khách hàng
    </a>
  `;

  mount(mountSelector, html);
}

/** Đóng/mở sidebar trên mobile — gọi sau khi renderSidebar + renderDashboardTopbar */
export function wireSidebarToggle() {
  const toggle = qs('#dashboardSidebarToggle');
  const sidebar = qs('#dashboardSidebar');
  const overlay = qs('#dashboardOverlay');
  if (!toggle || !sidebar) return;

  const close = () => { sidebar.classList.remove('is-open'); overlay?.classList.remove('is-open'); };
  toggle.addEventListener('click', () => { sidebar.classList.toggle('is-open'); overlay?.classList.toggle('is-open'); });
  overlay?.addEventListener('click', close);
}
