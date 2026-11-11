/**
 * pages/contact.js — điểm vào JS cho trang Liên hệ (lien-he.html)
 * Chưa có hệ thống liên hệ hoàn chỉnh: trang chỉ liệt kê các kênh khai báo trong
 * config/constants.js (CONTACT_CHANNELS). Kênh nào để trống `url` sẽ hiện "Sắp cập nhật".
 * KHÔNG có form gửi tin nhắn giả lập.
 */
import { renderHeader } from '../components/header.js';
import { renderFooter } from '../components/footer.js';
import { renderBackButton } from '../components/back-button.js';
import { initAuthData } from '../services/authService.js';
import { qs, escapeHtml } from '../utils/dom.js';
import { CONTACT_CHANNELS, ROUTES } from '../config/constants.js';

const ICONS = { tiktok: '🎵', facebook: '👍', email: '📧', other: '💬' };

/** Chỉ cho phép link http(s) hoặc mailto — tránh nhúng "javascript:" từ cấu hình sai */
function isSafeUrl(url) {
  return /^(https?:\/\/|mailto:)/i.test(url);
}

function renderChannels() {
  qs('#contactGrid').innerHTML = CONTACT_CHANNELS.map((channel) => {
    const ready = channel.url && isSafeUrl(channel.url);
    const icon = ICONS[channel.id] || '💬';
    if (!ready) {
      return `
        <div class="card contact-card contact-card--empty">
          <span class="contact-card__icon" aria-hidden="true">${icon}</span>
          <strong>${escapeHtml(channel.label)}</strong>
          <span class="contact-card__soon">Sắp cập nhật</span>
        </div>`;
    }
    return `
      <a class="card card--hover contact-card" href="${escapeHtml(channel.url)}" target="_blank" rel="noopener noreferrer">
        <span class="contact-card__icon" aria-hidden="true">${icon}</span>
        <strong>${escapeHtml(channel.label)}</strong>
        <span class="contact-card__value">${escapeHtml(channel.display || channel.url)}</span>
      </a>`;
  }).join('');
}

async function init() {
  initAuthData();
  await renderHeader('#app-header');
  renderFooter('#app-footer');
  renderBackButton('#pageBack', { fallbackHref: ROUTES.HOME });
  renderChannels();
}

document.addEventListener('DOMContentLoaded', init);
