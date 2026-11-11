/**
 * components/pagination.js
 * Phân trang phía client cho các bảng dữ liệu trong Dashboard.
 *
 * @param {string} mountSelector
 * @param {{totalItems:number, pageSize:number, currentPage:number, onPageChange:(page:number)=>void}} options
 */
import { mount, qsa } from '../utils/dom.js';

export function renderPagination(mountSelector, { totalItems, pageSize, currentPage, onPageChange }) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

  if (totalPages <= 1) {
    mount(mountSelector, '');
    return;
  }

  const pages = buildPageList(currentPage, totalPages);

  const html = `
    <button type="button" class="pagination__btn" data-page="${currentPage - 1}" ${currentPage === 1 ? 'disabled' : ''} aria-label="Trang trước">‹</button>
    ${pages.map((p) => (p === '...'
    ? '<span class="pagination__ellipsis">…</span>'
    : `<button type="button" class="pagination__btn ${p === currentPage ? 'is-active' : ''}" data-page="${p}">${p}</button>`
  )).join('')}
    <button type="button" class="pagination__btn" data-page="${currentPage + 1}" ${currentPage === totalPages ? 'disabled' : ''} aria-label="Trang sau">›</button>
  `;

  const container = mount(mountSelector, html);
  qsa('.pagination__btn', container).forEach((btn) => {
    if (btn.disabled) return;
    btn.addEventListener('click', () => onPageChange(Number(btn.dataset.page)));
  });
}

/** Rút gọn danh sách số trang kiểu 1 … 4 5 6 … 12 khi có nhiều trang */
function buildPageList(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

  const pages = new Set([1, total, current, current - 1, current + 1]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);

  const result = [];
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1] > 1) result.push('...');
    result.push(p);
  });
  return result;
}
