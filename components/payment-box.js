/**
 * components/payment-box.js
 * Khối thanh toán chuyển khoản VietQR (đơn hàng) / nạp F (giao dịch nạp).
 * GIỮ NGUYÊN hệ thống VietQR + thông tin ngân hàng hiện có (BANK_INFO), bổ sung:
 *   - nút "Chuyển khoản nhanh" (liên kết VietQR mở ứng dụng ngân hàng trên điện thoại),
 *   - nút sao chép số tài khoản / số tiền / nội dung,
 *   - cảnh báo bắt buộc ghi đúng mã.
 * Hệ thống KHÔNG tự xác nhận chuyển khoản: admin đối soát thủ công. Mở app ngân hàng ≠ đã chuyển khoản.
 */
import { mount, escapeHtml } from '../utils/dom.js';
import { showToast } from './toast.js';
import { formatCurrency, formatF } from '../utils/formatters.js';
import {
  BANK_INFO, QUICK_TRANSFER_BASE_URL, QUICK_TRANSFER_APP, ORDER_PAYMENT_TIMEOUT_MINUTES,
} from '../config/constants.js';

/** Nội dung chuyển khoản = mã bỏ dấu gạch: CDT-20261107-001 → CDT20261107001, NAP-... → NAP20261107001 */
export function getTransferContent(item) {
  return String(item.code).replace(/-/g, '');
}

export function buildVietQrImageUrl(item) {
  return `https://img.vietqr.io/image/${BANK_INFO.bankCode}-${BANK_INFO.accountNumber}-compact2.png`
    + `?amount=${item.totalPrice}&addInfo=${encodeURIComponent(getTransferContent(item))}&accountName=${encodeURIComponent(BANK_INFO.accountName)}`;
}

/**
 * Liên kết VietQR mở app ngân hàng, điền sẵn: ngân hàng nhận + số tài khoản, tên người nhận, số tiền, nội dung.
 * Không truyền tham số `app` (QUICK_TRANSFER_APP rỗng) → trang VietQR cho người dùng chọn ứng dụng ngân hàng của mình.
 */
export function buildQuickTransferUrl(item) {
  const params = new URLSearchParams();
  if (QUICK_TRANSFER_APP) params.set('app', QUICK_TRANSFER_APP);
  params.set('ba', `${BANK_INFO.accountNumber}@${BANK_INFO.bankCode}`);
  params.set('am', String(item.totalPrice));
  params.set('tn', getTransferContent(item));
  params.set('bn', BANK_INFO.accountName);
  return `${QUICK_TRANSFER_BASE_URL}?${params.toString()}`;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (error) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (e) { return false; }
  }
}

/**
 * @param {string} mountSelector
 * @param {{code:string, totalPrice:number}} item - đơn hàng hoặc giao dịch nạp (totalPrice = số tiền VNĐ cần chuyển)
 * @param {{kind?: 'order'|'topup'}} [options]
 */
export function renderPaymentBox(mountSelector, item, { kind = 'order' } = {}) {
  const content = getTransferContent(item);
  const what = kind === 'topup' ? 'mã giao dịch nạp' : 'mã đơn';

  const root = mount(mountSelector, `
    <div class="payment-box">
      <h3>Chuyển khoản ngân hàng</h3>
      <p class="text-muted">Quét mã QR hoặc bấm <strong>Chuyển khoản nhanh</strong> để mở ứng dụng ngân hàng. Nếu thiết bị không mở được, hãy chuyển thủ công theo thông tin bên dưới.</p>

      <div class="payment-warning" role="alert">
        <strong>Bắt buộc ghi đúng nội dung:</strong> <span class="mono payment-warning__code">${escapeHtml(content)}</span><br />
        Cáo đối soát bằng ${what}. Ghi sai hoặc thiếu nội dung có thể làm chậm việc xác nhận.${kind === 'order' ? `<br />Đơn sẽ <strong>tự động hủy</strong> nếu chưa thanh toán sau ${ORDER_PAYMENT_TIMEOUT_MINUTES} phút.` : ''}
      </div>

      <a class="btn btn--primary btn--block payment-quick" id="quickTransferBtn" href="${escapeHtml(buildQuickTransferUrl(item))}" target="_blank" rel="noopener noreferrer">⚡ Chuyển khoản nhanh</a>
      <p class="form-hint payment-quick__hint">Mở ứng dụng ngân hàng không có nghĩa là đã chuyển khoản. Đơn/giao dịch chỉ được xử lý sau khi Cáo xác nhận đã nhận tiền.</p>

      <img class="payment-box__qr" src="${escapeHtml(buildVietQrImageUrl(item))}" alt="Mã QR chuyển khoản VietQR" />

      <dl class="summary-list payment-box__info">
        <div><dt>Ngân hàng</dt><dd>${escapeHtml(BANK_INFO.bankLabel)}</dd></div>
        <div><dt>Chủ tài khoản</dt><dd>${escapeHtml(BANK_INFO.accountName)}</dd></div>
        <div><dt>Số tài khoản</dt><dd class="mono">${escapeHtml(BANK_INFO.accountNumber)} <button type="button" class="copy-btn" data-copy="${escapeHtml(BANK_INFO.accountNumber)}">Sao chép</button></dd></div>
        <div><dt>Số tiền</dt><dd class="mono">${formatCurrency(item.totalPrice)} <small>(= ${formatF(item.totalPrice)})</small> <button type="button" class="copy-btn" data-copy="${item.totalPrice}">Sao chép</button></dd></div>
        <div><dt>Nội dung chuyển khoản</dt><dd class="mono">${escapeHtml(content)} <button type="button" class="copy-btn" data-copy="${escapeHtml(content)}">Sao chép</button></dd></div>
      </dl>
      <p class="form-hint">Hệ thống chưa tự động xác nhận chuyển khoản — Cáo kiểm tra tiền thực nhận và cập nhật thủ công.</p>
    </div>
  `);

  root?.querySelectorAll('[data-copy]').forEach((btn) => btn.addEventListener('click', async () => {
    const ok = await copyText(btn.dataset.copy);
    showToast(ok ? 'Đã sao chép.' : 'Không sao chép được, hãy bôi đen và sao chép thủ công.', ok ? 'success' : 'error', 1600);
  }));
}
