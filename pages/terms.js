/**
 * pages/terms.js — điểm vào JS cho trang Điều khoản (dieu-khoan.html)
 */
import { renderHeader } from '../components/header.js';
import { renderFooter } from '../components/footer.js';
import { renderBackButton } from '../components/back-button.js';
import { initAuthData } from '../services/authService.js';
import { ROUTES } from '../config/constants.js';

async function init() {
  initAuthData();
  await renderHeader('#app-header');
  renderFooter('#app-footer');
  renderBackButton('#pageBack', { fallbackHref: ROUTES.HOME });
}

document.addEventListener('DOMContentLoaded', init);
