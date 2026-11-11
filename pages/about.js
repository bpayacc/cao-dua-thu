/**
 * pages/about.js — điểm vào JS cho trang Giới thiệu (gioi-thieu.html)
 */
import { renderHeader } from '../components/header.js';
import { renderFooter } from '../components/footer.js';
import { renderBackButton } from '../components/back-button.js';
import { initAuthData } from '../services/authService.js';
import { setupScrollReveal } from '../utils/scroll-reveal.js';
import { ROUTES } from '../config/constants.js';

async function init() {
  initAuthData();
  await renderHeader('#app-header');
  renderFooter('#app-footer');
  renderBackButton('#pageBack', { fallbackHref: ROUTES.HOME });
  setupScrollReveal();
}

document.addEventListener('DOMContentLoaded', init);
