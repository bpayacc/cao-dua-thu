/**
 * components/toast.js
 * Toast thông báo góc màn hình. Dùng: import { showToast } from '...toast.js'
 * showToast('Đăng nhập thành công!', 'success');
 */
import { createEl } from '../utils/dom.js';

const ICONS = {
  success: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  error: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  info: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 16v-4M12 8h.01" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"/></svg>',
};

function getContainer() {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = createEl('div', { class: 'toast-container', role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(container);
  }
  return container;
}

/**
 * Hiển thị toast.
 * @param {string} message
 * @param {'success'|'error'|'info'} type
 * @param {number} duration - ms
 */
export function showToast(message, type = 'info', duration = 3200) {
  const container = getContainer();

  const toast = createEl('div', { class: `toast toast--${type}` }, [
    createEl('span', { class: 'toast__icon' }, [wrapIcon(type)]),
    createEl('span', { class: 'toast__message' }, message),
    createEl('button', { class: 'toast__close', 'aria-label': 'Đóng thông báo', onClick: () => removeToast(toast) }, '×'),
  ]);

  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('toast--visible'));

  const timer = setTimeout(() => removeToast(toast), duration);
  toast.addEventListener('mouseenter', () => clearTimeout(timer));
}

function removeToast(toast) {
  toast.classList.remove('toast--visible');
  toast.addEventListener('transitionend', () => toast.remove(), { once: true });
}

function wrapIcon(type) {
  const span = document.createElement('span');
  span.innerHTML = ICONS[type] || ICONS.info;
  return span.firstChild;
}
