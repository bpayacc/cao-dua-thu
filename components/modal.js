/**
 * components/modal.js
 * Modal dùng chung — mọi hộp thoại (xác nhận, thêm/sửa dữ liệu...) trong
 * Dashboard đều dựng trên nền tảng này để đồng nhất giao diện + hành vi.
 */
import { createEl } from '../utils/dom.js';

/**
 * @param {{title:string, bodyNode:Node|string, footerNode?:Node|string, onClose?:Function}} options
 * @returns {{close:Function, el:HTMLElement}}
 */
export function openModal({ title, bodyNode, footerNode, onClose }) {
  const overlay = createEl('div', { class: 'modal-overlay' });
  const modal = createEl('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' }, [
    createEl('div', { class: 'modal__header' }, [
      createEl('h3', {}, title),
      createEl('button', { type: 'button', class: 'modal__close', 'aria-label': 'Đóng', onClick: () => close() }, '×'),
    ]),
    createEl('div', { class: 'modal__body' }, [bodyNode]),
    footerNode ? createEl('div', { class: 'modal__footer' }, [footerNode]) : null,
  ]);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  document.body.classList.add('no-scroll');
  requestAnimationFrame(() => overlay.classList.add('is-open'));

  function close() {
    overlay.classList.remove('is-open');
    document.body.classList.remove('no-scroll');
    overlay.addEventListener('transitionend', () => overlay.remove(), { once: true });
    onClose?.();
  }

  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  return { close, el: modal };
}
