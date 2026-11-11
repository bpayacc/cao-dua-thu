/**
 * utils/leave-guard.js
 * Cảnh báo khi người dùng RỜI KHỎI trang trong lúc đang có dữ liệu nháp (vd. đang viết thư).
 *
 * Chặn được:
 *  - bấm liên kết nội bộ / ra ngoài (header, logo, footer...) → hộp thoại đẹp "Ở lại / Rời đi"
 *  - nút Quay lại của trình duyệt/điện thoại (dùng một "bẫy" history để giữ nguyên trang)
 *  - đóng tab / tải lại / gõ địa chỉ khác → hộp thoại gốc của trình duyệt (trình duyệt không cho tuỳ biến nội dung)
 * Không chặn: chuyển bước bên trong trang (không phải điều hướng), liên kết mở tab mới, mailto/tel, neo #.
 * Hộp thoại dựng trên components/confirm-dialog.js nên không ảnh hưởng các hộp thoại xác nhận khác.
 */
import { confirmDialog } from '../components/confirm-dialog.js';

export const LEAVE_MESSAGE = 'Thư của bạn sẽ bị hủy nếu bạn chuyển hướng ngay lúc này.';

/**
 * @param {{isDirty: () => boolean, onLeave?: () => void, title?: string, message?: string}} options
 *   onLeave chạy khi người dùng chọn "Rời đi" (dùng để huỷ dữ liệu nháp).
 */
export function createLeaveGuard({ isDirty, onLeave, title = 'Rời khỏi trang gửi thư?', message = LEAVE_MESSAGE }) {
  let allowLeave = false; // đã được phép đi (không hỏi nữa)
  let released = false;   // quy trình đã xong (vd. đặt thư thành công)
  let modalOpen = false;  // chống hiện hộp thoại lặp lại
  let trapPushed = false;

  const dirty = () => !allowLeave && !released && isDirty();

  async function ask() {
    if (modalOpen) return false;
    modalOpen = true;
    try {
      return await confirmDialog({ title, message, confirmLabel: 'Rời đi', cancelLabel: 'Ở lại', danger: true });
    } finally {
      modalOpen = false;
    }
  }

  function leaveNow(go) {
    allowLeave = true;
    onLeave?.();
    go();
  }

  // 1) Đóng tab / tải lại / điều hướng ra ngoài
  window.addEventListener('beforeunload', (event) => {
    if (!dirty()) return;
    event.preventDefault();
    event.returnValue = '';
  });

  // 2) Liên kết (kể cả header/footer render động nhờ bắt sự kiện ở document)
  document.addEventListener('click', async (event) => {
    if (!dirty()) return;
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = event.target.closest ? event.target.closest('a[href]') : null;
    if (!anchor) return;
    if ((anchor.target && anchor.target !== '_self') || anchor.hasAttribute('download')) return;

    let url;
    try { url = new URL(anchor.getAttribute('href'), window.location.href); } catch (error) { return; }
    if (!/^https?:$/.test(url.protocol)) return; // mailto:, tel:, javascript:...
    if (url.origin === window.location.origin && url.pathname === window.location.pathname && url.search === window.location.search) return; // neo #...

    event.preventDefault();
    if (await ask()) leaveNow(() => { window.location.href = url.href; });
  });

  // 3) Nút Quay lại: giữ nguyên trang bằng cách thêm một mục history "bẫy"
  let lastHash = window.location.hash;
  window.addEventListener('popstate', async () => {
    // Đổi neo (#...) trong cùng trang cũng phát popstate nhưng KHÔNG phải rời trang → bỏ qua
    if (window.location.hash !== lastHash) { lastHash = window.location.hash; return; }
    if (!dirty()) return;
    window.history.pushState({ cdtLeaveGuard: true }, '', window.location.href); // quay lại đúng trang hiện tại
    if (modalOpen) return;
    if (await ask()) leaveNow(() => window.history.go(-2)); // bỏ qua mục bẫy + mục trang hiện tại
  });

  return {
    /** Gọi mỗi khi dữ liệu thay đổi: lần đầu có dữ liệu nháp thì đặt "bẫy" nút Quay lại */
    refresh() {
      if (!trapPushed && dirty()) {
        window.history.pushState({ cdtLeaveGuard: true }, '', window.location.href);
        trapPushed = true;
      }
    },
    /** Cho phép điều hướng ngay mà KHÔNG huỷ nháp (vd. chuyển sang trang đăng nhập) */
    allowNavigation() { allowLeave = true; },
    /** Quy trình đã hoàn tất: tắt cảnh báo và gỡ "bẫy" để nút Quay lại hoạt động bình thường */
    release() {
      released = true;
      if (trapPushed) { trapPushed = false; window.history.go(-1); }
    },
  };
}
