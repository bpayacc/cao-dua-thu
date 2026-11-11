/**
 * components/dashboard-topbar.js
 * Thanh topbar của Dashboard: nút mở sidebar (mobile), breadcrumb, menu tài khoản admin.
 * Dùng chung cho mọi trang quản trị.
 */
import { qs, mount } from '../utils/dom.js';
import { getCurrentUser, logout } from '../services/authService.js';
import { getInitials } from '../utils/formatters.js';
import { ROUTES } from '../config/constants.js';

export async function renderDashboardTopbar(mountSelector = '#dashboardTopbar') {
  const user = await getCurrentUser();
  const initials = user ? getInitials(user.fullName) : '?';

  const html = `
    <button class="dtopbar__toggle" id="dashboardSidebarToggle" aria-label="Mở menu điều hướng">
      <span></span><span></span><span></span>
    </button>
    <nav class="breadcrumb" id="dashboardBreadcrumb" aria-label="Breadcrumb"></nav>
    <div class="user-menu" id="userMenu" style="margin-left:auto;">
      <button class="user-menu__trigger" id="userMenuTrigger" aria-expanded="false">
        <span class="avatar" style="background:${user?.avatarColor || '#E2631F'}">${initials}</span>
        <span class="user-menu__name">${user?.fullName || 'Quản trị viên'}</span>
      </button>
      <div class="user-menu__dropdown" id="userMenuDropdown">
        <div class="user-menu__header"><strong>${user?.fullName || ''}</strong><span>${user?.email || ''}</span></div>
        <a href="${ROUTES.HOME}" class="user-menu__item">Về trang khách hàng</a>
        <button class="user-menu__item user-menu__item--danger" id="logoutBtn">Đăng xuất</button>
      </div>
    </div>
  `;

  mount(mountSelector, html);
  wireUserMenu();
}

function wireUserMenu() {
  const trigger = qs('#userMenuTrigger');
  const dropdown = qs('#userMenuDropdown');
  if (!trigger || !dropdown) return;

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = dropdown.classList.toggle('is-open');
    trigger.setAttribute('aria-expanded', String(isOpen));
  });
  document.addEventListener('click', () => dropdown.classList.remove('is-open'));

  qs('#logoutBtn')?.addEventListener('click', async () => {
    await logout();
    window.location.href = ROUTES.HOME;
  });
}
