/**
 * components/breadcrumb.js
 * Vẽ đường dẫn phân cấp (breadcrumb) cho các trang Dashboard.
 * @param {Array<{label:string, href?:string}>} items - mục cuối không cần href
 */
import { mount } from '../utils/dom.js';

export function renderBreadcrumb(mountSelector, items) {
  const html = items.map((item, index) => {
    const isLast = index === items.length - 1;
    if (isLast || !item.href) {
      return `<span class="breadcrumb__current">${item.label}</span>`;
    }
    return `<a href="${item.href}" class="breadcrumb__link">${item.label}</a><span class="breadcrumb__sep">/</span>`;
  }).join('');

  mount(mountSelector, html);
}
