/**
 * components/confirm-dialog.js
 * Hộp thoại xác nhận dùng chung trước các hành động quan trọng (huỷ đơn,
 * đổi trạng thái, xoá dữ liệu...). Dựng trên components/modal.js.
 *
 * @param {{title:string, message:string, confirmLabel?:string, cancelLabel?:string, danger?:boolean}} options
 * @returns {Promise<boolean>} true nếu người dùng bấm xác nhận
 */
import { openModal } from './modal.js';
import { createEl } from '../utils/dom.js';

export function confirmDialog({
  title = 'Xác nhận', message, confirmLabel = 'Xác nhận', cancelLabel = 'Huỷ bỏ', danger = false,
}) {
  return new Promise((resolve) => {
    const body = createEl('p', { class: 'text-muted', style: 'margin:0;' }, message);

    const cancelBtn = createEl('button', { type: 'button', class: 'btn btn--ghost' }, cancelLabel);
    const confirmBtn = createEl('button', {
      type: 'button',
      class: `btn ${danger ? 'btn--primary' : 'btn--dark'}`,
    }, confirmLabel);

    const footer = createEl('div', { style: 'display:flex; justify-content:flex-end; gap:8px;' }, [cancelBtn, confirmBtn]);

    const { close } = openModal({
      title,
      bodyNode: body,
      footerNode: footer,
      onClose: () => resolve(false),
    });

    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
      close();
    };

    cancelBtn.addEventListener('click', () => finish(false));
    confirmBtn.addEventListener('click', () => finish(true));
  });
}
