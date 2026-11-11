/**
 * components/back-button.js
 * Nút "Quay lại" dùng chung cho các trang con — ưu tiên quay về trang
 * trước đó trong lịch sử duyệt web, nếu không có lịch sử thì về fallbackHref.
 */
import { mount, qs } from '../utils/dom.js';
import { ROUTES } from '../config/constants.js';

/**
 * @param {string} mountSelector
 * @param {{label?:string, fallbackHref?:string}} options
 */
export function renderBackButton(mountSelector, { label = 'Quay lại', fallbackHref = ROUTES.HOME } = {}) {
  const html = `
    <button type="button" class="back-button" id="pageBackBtn">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M15 18l-6-6 6-6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      ${label}
    </button>
  `;
  const el = mount(mountSelector, html);
  if (!el) return;

  qs('#pageBackBtn', el).addEventListener('click', () => {
    // window.history.length > 1 nghĩa là có trang trước đó để quay lại trong tab hiện tại
    if (window.history.length > 1) {
      window.history.back();
    } else {
      window.location.href = fallbackHref;
    }
  });
}
