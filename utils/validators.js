/**
 * utils/validators.js
 * Các hàm kiểm tra hợp lệ dữ liệu form, trả về { valid, message }
 * để component form hiển thị lỗi thống nhất.
 */

export function validateEmail(email) {
  const pattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email) return { valid: false, message: 'Vui lòng nhập email.' };
  if (!pattern.test(email)) return { valid: false, message: 'Email không đúng định dạng.' };
  return { valid: true, message: '' };
}

export function validatePhone(phone) {
  const pattern = /^(0|\+84)[0-9]{9,10}$/;
  if (!phone) return { valid: false, message: 'Vui lòng nhập số điện thoại.' };
  if (!pattern.test(phone.trim())) return { valid: false, message: 'Số điện thoại không hợp lệ.' };
  return { valid: true, message: '' };
}

export function validatePassword(password) {
  if (!password) return { valid: false, message: 'Vui lòng nhập mật khẩu.' };
  if (password.length < 6) return { valid: false, message: 'Mật khẩu cần tối thiểu 6 ký tự.' };
  return { valid: true, message: '' };
}

export function validateRequired(value, fieldLabel = 'Trường này') {
  if (!value || !String(value).trim()) {
    return { valid: false, message: `${fieldLabel} không được để trống.` };
  }
  return { valid: true, message: '' };
}

export function validateMatch(value, target, message = 'Giá trị không khớp.') {
  return value === target ? { valid: true, message: '' } : { valid: false, message };
}

/** Kiểm tra một số nguyên nằm trong khoảng [min, max] */
export function validateIntegerRange(value, min, max, fieldLabel = 'Giá trị') {
  const num = Number(value);
  if (value === '' || value === null || value === undefined || Number.isNaN(num)) {
    return { valid: false, message: `Vui lòng nhập ${fieldLabel.toLowerCase()}.` };
  }
  if (!Number.isInteger(num) || num < min || num > max) {
    return { valid: false, message: `${fieldLabel} phải là số nguyên từ ${min} đến ${max}.` };
  }
  return { valid: true, message: '' };
}

/**
 * Chạy nhiều validator liên tiếp, trả về lỗi đầu tiên gặp phải (nếu có).
 * @param {Array<() => {valid: boolean, message: string}>} checks
 */
export function runValidators(checks) {
  for (const check of checks) {
    const result = check();
    if (!result.valid) return result;
  }
  return { valid: true, message: '' };
}

/**
 * Lấy username từ link hồ sơ TikTok. Chỉ nhận host tiktok.com / www.tiktok.com (https hoặc http)
 * và đường dẫn bắt đầu bằng /@username. Trả về chuỗi rỗng nếu link không đúng dạng.
 */
function extractUsernameFromProfileUrl(raw) {
  try {
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
    const url = new URL(withScheme);
    if (!['https:', 'http:'].includes(url.protocol)) return '';
    if (url.username || url.password || url.port) return '';
    if (!['tiktok.com', 'www.tiktok.com'].includes(url.hostname.toLowerCase())) return '';
    const match = url.pathname.match(/^\/@([^/]+)\/?$/);
    return match ? decodeURIComponent(match[1]) : '';
  } catch (error) {
    return '';
  }
}

/**
 * Chuẩn hoá & kiểm tra ID TikTok của người nhận.
 * Chấp nhận: "ten.nguoi_nhan", "@ten.nguoi_nhan" hoặc link hồ sơ
 * "https://www.tiktok.com/@ten.nguoi_nhan" (host tiktok.com / www.tiktok.com). Quy tắc username TikTok:
 * 2–24 ký tự, chỉ gồm chữ cái a–z, số, dấu gạch dưới "_" và dấu chấm ".",
 * không được kết thúc bằng dấu chấm.
 * LƯU Ý: chỉ kiểm tra ĐỊNH DẠNG — không thể xác minh tài khoản có tồn tại,
 * công khai hay cho nhận tin nhắn hay không (TikTok không có API công khai cho việc này).
 * @returns {{valid:boolean, message:string, id:string}}
 */
export function parseTikTokId(input) {
  let value = String(input || '').trim();
  if (!value) return { valid: false, message: 'Vui lòng nhập ID TikTok của người nhận.', id: '' };

  // Nếu người dùng dán link: chỉ chấp nhận ĐÚNG host tiktok.com / www.tiktok.com và đường dẫn /@username.
  // Mọi link khác (domain giả, link rút gọn, link video...) bị từ chối, không "đoán" username từ chuỗi bất kỳ.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value) || /^(www\.)?tiktok\.com\//i.test(value)) {
    const link = extractUsernameFromProfileUrl(value);
    if (!link) {
      return { valid: false, message: 'Link không hợp lệ. Chỉ nhận link hồ sơ dạng https://www.tiktok.com/@username.', id: '' };
    }
    value = link;
  }
  value = value.replace(/^@+/, '').toLowerCase();

  if (value.length < 2 || value.length > 24) {
    return { valid: false, message: 'ID TikTok phải dài từ 2 đến 24 ký tự.', id: value };
  }
  if (!/^[a-z0-9_.]+$/.test(value)) {
    return { valid: false, message: 'ID TikTok chỉ gồm chữ cái không dấu, số, dấu gạch dưới (_) và dấu chấm (.).', id: value };
  }
  if (value.endsWith('.')) {
    return { valid: false, message: 'ID TikTok không được kết thúc bằng dấu chấm.', id: value };
  }
  return { valid: true, message: '', id: value };
}

/** Kiểm tra nội dung một bức thư (độ dài tối thiểu/tối đa) */
export function validateLetterContent(content, min, max, label = 'Nội dung thư') {
  const text = String(content || '').trim();
  if (!text) return { valid: false, message: `${label} không được để trống.` };
  if (text.length < min) return { valid: false, message: `${label} cần tối thiểu ${min} ký tự.` };
  if (String(content).length > max) return { valid: false, message: `${label} tối đa ${max} ký tự.` };
  return { valid: true, message: '' };
}

/** Chuẩn hoá nội dung thư để phát hiện thư trùng nhau (bỏ khác biệt hoa/thường và khoảng trắng) */
export function normalizeLetterForCompare(text) {
  return String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
}
