/**
 * utils/dom.js
 * Các hàm tiện ích thao tác DOM ngắn gọn, tái sử dụng khắp dự án.
 */

/** querySelector rút gọn */
export const qs = (selector, scope = document) => scope.querySelector(selector);

/** querySelectorAll rút gọn, trả về mảng thật để dùng map/filter */
export const qsa = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));

/**
 * Tạo element nhanh với thuộc tính + con bên trong.
 * @param {string} tag - tên thẻ, vd 'div'
 * @param {object} attrs - thuộc tính { class, id, dataset, ... }
 * @param {Array|string} children - danh sách node con hoặc text
 */
export function createEl(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);

  Object.entries(attrs).forEach(([key, value]) => {
    if (key === 'class') {
      el.className = value;
    } else if (key === 'dataset') {
      Object.entries(value).forEach(([dKey, dVal]) => { el.dataset[dKey] = dVal; });
    } else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value !== undefined && value !== null) {
      el.setAttribute(key, value);
    }
  });

  const childList = Array.isArray(children) ? children : [children];
  childList.forEach((child) => {
    if (child === null || child === undefined) return;
    el.append(child instanceof Node ? child : document.createTextNode(child));
  });

  return el;
}

/** Chèn HTML vào một vùng chứa (dùng cho các component render sẵn HTML string) */
export function mount(target, html) {
  const container = typeof target === 'string' ? qs(target) : target;
  if (!container) return null;
  container.innerHTML = html;
  return container;
}

/** Bật/tắt class hiển thị nhanh */
export function toggleVisible(el, isVisible) {
  if (!el) return;
  el.classList.toggle('is-hidden', !isVisible);
}

/** Escape HTML — BẮT BUỘC dùng khi chèn nội dung do người dùng nhập vào innerHTML (chống XSS) */
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
