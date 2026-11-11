/**
 * components/header.js
 * Render header cho các trang phía khách hàng (không phải Dashboard).
 * Tự động hiển thị nút Đăng nhập/Đăng ký hoặc menu tài khoản tuỳ trạng thái.
 */
import { qs, qsa, mount, escapeHtml } from '../utils/dom.js';
import { getCurrentUser, logout } from '../services/authService.js';
import { ROUTES, ROLES, APP_NAME } from '../config/constants.js';
import { getInitials } from '../utils/formatters.js';

const NAV_LINKS = [
  { label: 'Trang chủ', href: ROUTES.HOME },
  { label: 'Gửi thư', href: ROUTES.SEND_LETTER },
  { label: 'Giới thiệu', href: ROUTES.ABOUT },
  { label: 'Liên hệ', href: ROUTES.CONTACT },
  { label: 'Điều khoản', href: ROUTES.TERMS },
];

/**
 * @param {string} mountSelector - selector của <header id="app-header">
 */
export async function renderHeader(mountSelector = '#app-header') {
  const user = await getCurrentUser();
  const currentPath = window.location.pathname;

  const navHtml = NAV_LINKS.map((link) => {
    const isActive = currentPath === link.href || (link.href === ROUTES.HOME && currentPath === '/');
    return `<li><a class="nav-link ${isActive ? 'is-active' : ''}" href="${link.href}">${link.label}</a></li>`;
  }).join('');

  const authAreaHtml = user ? renderUserMenu(user) : renderGuestButtons();

  const html = `
    <div class="header__inner container">
      <a href="${ROUTES.HOME}" class="header__logo" aria-label="${APP_NAME} - Trang chủ">
        ${logoMark()}
        <span>${APP_NAME}</span>
      </a>

      <nav class="header__nav" aria-label="Điều hướng chính">
        <ul class="nav-list">${navHtml}</ul>
      </nav>

      <div class="header__actions">
        <a href="${ROUTES.SEND_LETTER}" class="btn btn--primary btn--sm header__cta">Gửi một bức thư</a>
        ${authAreaHtml}
        <button class="header__menu-toggle" id="menuToggle" aria-label="Mở menu" aria-expanded="false">
          <span></span><span></span><span></span>
        </button>
      </div>
    </div>
    <nav class="header__mobile-nav" id="mobileNav" aria-label="Điều hướng di động">
      <ul class="nav-list nav-list--mobile">${navHtml}</ul>
      <a href="${ROUTES.SEND_LETTER}" class="btn btn--primary btn--block">Gửi một bức thư</a>
      <div class="mobile-account">${renderMobileAccountArea(user)}</div>
    </nav>
  `;

  const headerEl = mount(mountSelector, html);
  if (!headerEl) return;

  wireMobileMenu(headerEl);
  wireUserMenu(headerEl);
  wireScrollShadow(headerEl);
  wireMobileLogout(headerEl);
}

/** Khu vực tài khoản trong menu mobile — đảm bảo khách chưa đăng nhập vẫn thấy nút Đăng nhập/Đăng ký ngay trong menu */
function renderMobileAccountArea(user) {
  if (!user) {
    return `
      <a href="${ROUTES.LOGIN}" class="btn btn--outline btn--block">Đăng nhập</a>
      <a href="${ROUTES.REGISTER}" class="btn btn--ghost btn--block">Đăng ký tài khoản</a>
    `;
  }

  const dashboardItem = user.role === ROLES.ADMIN
    ? `<a href="${ROUTES.DASHBOARD}" class="nav-link">Trang quản trị</a>`
    : '';

  return `
    <p class="mobile-account__hint">Đang đăng nhập: <strong>${escapeHtml(user.fullName)}</strong></p>
    <ul class="nav-list nav-list--mobile">
      <li><a href="${ROUTES.WALLET}" class="nav-link">Ví của tôi</a></li>
      <li><a href="${ROUTES.MY_ORDERS}" class="nav-link">Đơn của tôi</a></li>
      <li><a href="${ROUTES.PROFILE}" class="nav-link">Hồ sơ</a></li>
      ${dashboardItem ? `<li>${dashboardItem}</li>` : ''}
    </ul>
    <button type="button" class="btn btn--ghost btn--block" id="mobileLogoutBtn">Đăng xuất</button>
  `;
}

function wireMobileLogout(headerEl) {
  const btn = qs('#mobileLogoutBtn', headerEl);
  btn?.addEventListener('click', async () => {
    await logout();
    window.location.href = ROUTES.HOME;
  });
}

function renderGuestButtons() {
  return `
    <div class="header__auth">
      <a href="${ROUTES.LOGIN}" class="btn btn--ghost btn--sm">Đăng nhập</a>
      <a href="${ROUTES.REGISTER}" class="btn btn--outline btn--sm">Đăng ký</a>
    </div>
  `;
}

function renderUserMenu(user) {
  const initials = getInitials(user.fullName);
  const dashboardItem = user.role === ROLES.ADMIN
    ? `<a href="${ROUTES.DASHBOARD}" class="user-menu__item">Trang quản trị</a>`
    : '';

  return `
    <div class="user-menu" id="userMenu">
      <button class="user-menu__trigger" id="userMenuTrigger" aria-expanded="false">
        <span class="avatar" style="background:${user.avatarColor}">${initials}</span>
        <span class="user-menu__name">${escapeHtml(user.fullName.split(' ').slice(-1)[0])}</span>
      </button>
      <div class="user-menu__dropdown" id="userMenuDropdown">
        <div class="user-menu__header">
          <strong>${escapeHtml(user.fullName)}</strong>
          <span>${escapeHtml(user.email)}</span>
        </div>
        <a href="${ROUTES.WALLET}" class="user-menu__item">Ví của tôi</a>
        <a href="${ROUTES.MY_ORDERS}" class="user-menu__item">Đơn của tôi</a>
        <a href="${ROUTES.PROFILE}" class="user-menu__item">Hồ sơ</a>
        ${dashboardItem}
        <button class="user-menu__item user-menu__item--danger" id="logoutBtn">Đăng xuất</button>
      </div>
    </div>
  `;
}

function logoMark() {
  return `<img src="/assets/img/logo-96.png" width="44" height="44" alt="Logo Cáo Đưa Thư" class="header__logo-mark" />`;
}

function wireMobileMenu(headerEl) {
  const toggle = qs('#menuToggle', headerEl);
  const mobileNav = qs('#mobileNav', headerEl);
  if (!toggle || !mobileNav) return;

  toggle.addEventListener('click', () => {
    const isOpen = mobileNav.classList.toggle('is-open');
    toggle.classList.toggle('is-open', isOpen);
    toggle.setAttribute('aria-expanded', String(isOpen));
    document.body.classList.toggle('no-scroll', isOpen);
  });

  qsa('a', mobileNav).forEach((link) => {
    link.addEventListener('click', () => {
      mobileNav.classList.remove('is-open');
      toggle.classList.remove('is-open');
      document.body.classList.remove('no-scroll');
    });
  });
}

function wireUserMenu(headerEl) {
  const trigger = qs('#userMenuTrigger', headerEl);
  const dropdown = qs('#userMenuDropdown', headerEl);
  if (!trigger || !dropdown) return;

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = dropdown.classList.toggle('is-open');
    trigger.setAttribute('aria-expanded', String(isOpen));
  });

  document.addEventListener('click', () => dropdown.classList.remove('is-open'));

  const logoutBtn = qs('#logoutBtn', headerEl);
  logoutBtn?.addEventListener('click', async () => {
    await logout();
    window.location.href = ROUTES.HOME;
  });
}

function wireScrollShadow(headerEl) {
  const header = headerEl.closest('header') || headerEl;
  const onScroll = () => header.classList.toggle('is-scrolled', window.scrollY > 8);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}
