/**
 * utils/formatters.js
 * Định dạng hiển thị: tiền tệ VNĐ, ngày giờ kiểu Việt Nam, viết tắt tên...
 */

/** 25000 → "25.000" */
export function formatNumber(amount) {
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(Number(amount) || 0);
}

/** Dạng chữ thuần của đơn vị F: "25.000 F" (dùng cho toast, hộp thoại, textContent) */
export function formatF(amount) {
  return `${formatNumber(amount)} F`;
}

/**
 * Dạng HTML có biểu tượng F tuỳ biến (xem .f-coin trong components.css):
 * <span class="money-f">25.000<span class="f-coin">F</span></span>. Chỉ chứa số → an toàn khi chèn innerHTML.
 */
export function fHtml(amount) {
  return `<span class="money-f">${formatNumber(amount)}<span class="f-coin" role="img" aria-label="F">F</span></span>`;
}

/** Tiền VNĐ — CHỈ dùng khi hướng dẫn chuyển khoản ngân hàng (1 F = 1 VNĐ) */
export function formatCurrency(amount) {
  return `${formatNumber(amount)} VNĐ`;
}

export function formatDate(dateInput) {
  const date = new Date(dateInput);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
}

export function formatDateTime(dateInput) {
  const date = new Date(dateInput);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(date);
}

/** Lấy chữ cái đầu của tên để làm avatar chữ (vd "Nguyễn Văn A" -> "NA") */
export function getInitials(fullName = '') {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 0 || !parts[0]) return '?';
  const first = parts[0][0];
  const last = parts[parts.length - 1][0];
  return (parts.length > 1 ? first + last : first).toUpperCase();
}
