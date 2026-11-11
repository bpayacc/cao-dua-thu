/**
 * config/constants.js
 * -----------------------------------------------------------------------
 * Nơi duy nhất khai báo các hằng số dùng chung toàn hệ thống:
 * route, trạng thái đơn, cấu hình gói thư/giá, giới hạn nội dung,
 * thông tin ngân hàng, kênh liên hệ...
 * Mọi module khác PHẢI import từ đây, không hard-code lại giá trị.
 * -----------------------------------------------------------------------
 */

export const APP_NAME = 'Cáo Đưa Thư';
export const APP_TAGLINE = 'Bạn viết thư, Cáo sẽ đưa.';

// Đường dẫn trang (tuyệt đối từ gốc site để chạy tốt trên Netlify lẫn local)
export const ROUTES = {
  HOME: '/index.html',
  ABOUT: '/pages/gioi-thieu.html',
  SEND_LETTER: '/pages/gui-thu.html',
  TERMS: '/pages/dieu-khoan.html',
  MY_ORDERS: '/pages/don-cua-toi.html',
  ORDER_DETAIL: '/pages/chi-tiet-don.html',
  PROFILE: '/pages/ho-so.html',
  WALLET: '/pages/vi-cua-toi.html',
  CONTACT: '/pages/lien-he.html',
  LOGIN: '/pages/auth/dang-nhap.html',
  REGISTER: '/pages/auth/dang-ky.html',
  DASHBOARD: '/dashboard/index.html',
  DASHBOARD_ORDERS: '/dashboard/don-hang.html',
  DASHBOARD_TOPUPS: '/dashboard/nap-f.html',
  DASHBOARD_WALLETS: '/dashboard/vi-nguoi-dung.html',
};

// Vai trò người dùng
export const ROLES = {
  CUSTOMER: 'customer',
  ADMIN: 'admin',
};

// ---- Trạng thái đơn hàng ----------------------------------------------
// CHỈ quản trị viên (sau khi đối soát thực tế) mới được chuyển trạng thái,
// trừ việc khách tự huỷ khi đơn còn "Chờ thanh toán". Hệ thống KHÔNG tự
// đánh dấu "Đã thanh toán" hay "Đã gửi thư".
export const ORDER_STATUS = {
  PENDING_PAYMENT: 'pending_payment', // Chờ thanh toán
  PAID: 'paid',                       // Đã thanh toán (admin đã đối soát)
  PROCESSING: 'processing',           // Đang xử lý
  SENT: 'sent',                       // Đã gửi thư
  FAILED: 'failed',                   // Không thể gửi
  CANCELLED: 'cancelled',             // Đã hủy
};

export const ORDER_STATUS_LABEL = {
  [ORDER_STATUS.PENDING_PAYMENT]: 'Chờ thanh toán',
  [ORDER_STATUS.PAID]: 'Đã thanh toán',
  [ORDER_STATUS.PROCESSING]: 'Đang xử lý',
  [ORDER_STATUS.SENT]: 'Đã gửi thư',
  [ORDER_STATUS.FAILED]: 'Không thể gửi',
  [ORDER_STATUS.CANCELLED]: 'Đã hủy',
};

// ---- Gói thư & giá ------------------------------------------------------
// NGUỒN GIÁ DUY NHẤT của toàn hệ thống: giao diện, hàm tạo đơn phía máy chủ
// (netlify/functions/create-order) và ví F đều đọc từ đây. Máy chủ luôn tự tính lại giá
// từ bảng này, không tin giá do trình duyệt gửi lên.
// Đơn vị: F (1 F = 1 VNĐ).
export const LETTER_PACKAGES = [
  {
    id: 'single',
    letterCount: 1,
    name: 'Gói 1 thư',
    tagline: 'Một lời nhắn gửi đến một người',
    price: 3000,
  },
  {
    id: 'triple',
    letterCount: 3,
    name: 'Gói 3 thư',
    tagline: 'Ba bức thư riêng biệt, mỗi thư một nội dung',
    price: 8000,
  },
  {
    id: 'five',
    letterCount: 5,
    name: 'Gói 5 thư',
    tagline: 'Năm bức thư riêng biệt, tiết kiệm hơn',
    price: 14000,
  },
];

// ---- Hình thức gửi ------------------------------------------------------
export const SENDER_MODE = {
  ANONYMOUS: 'anonymous',
  NAMED: 'named',
};

// ---- Giới hạn nội dung (có thể điều chỉnh tại đây) -----------------------
export const LETTER_MIN_LENGTH = 10;
export const LETTER_MAX_LENGTH = 600;
export const SENDER_NAME_MAX_LENGTH = 40;

// ---- Thông tin tài khoản ngân hàng nhận chuyển khoản (GIỮ NGUYÊN) --------
// Hiển thị mã VietQR sau khi đặt đơn. Việc đối soát chuyển khoản hiện do
// quản trị viên làm thủ công trong Dashboard > Quản lý đơn.
export const BANK_INFO = {
  bankCode: 'bidv', // mã ngân hàng dùng cho VietQR Quick Link (img.vietqr.io)
  bankLabel: 'BIDV',
  accountNumber: '8853746633',
  accountName: 'DINH VAN NOI',
};

// ---- Kênh liên hệ -------------------------------------------------------
// Để trống (`url: ''`) = chưa có kênh → giao diện hiển thị "Sắp cập nhật".
// Khi có tài khoản thật, chỉ cần điền `url` (và `display`) — không cần sửa HTML.
export const CONTACT_CHANNELS = [
  { id: 'tiktok', label: 'TikTok', display: '', url: '' },     // VD: 'https://www.tiktok.com/@ten_kenh'
  { id: 'facebook', label: 'Facebook', display: '', url: '' }, // VD: 'https://facebook.com/ten_trang'
  { id: 'email', label: 'Email', display: '', url: '' },       // VD: display 'lienhe@example.com', url 'mailto:lienhe@example.com'
  { id: 'other', label: 'Kênh hỗ trợ khác', display: '', url: '' }, // VD: Zalo, Instagram...
];

// ---- Ví F ------------------------------------------------------------------
// 1 F = 1 VNĐ. Số dư chỉ được thay đổi bởi máy chủ (Netlify Functions + Firebase Admin),
// không bao giờ bởi JavaScript trong trình duyệt.
export const F_PER_VND = 1;
export const WALLET_TOPUP_MIN = 1000;       // F tối thiểu mỗi lần nạp
export const WALLET_TOPUP_MAX = 5000000;    // F tối đa mỗi lần nạp
export const WALLET_TOPUP_QUICK_AMOUNTS = [10000, 20000, 50000, 100000];
export const WALLET_MAX_PENDING_TOPUPS = 5; // số yêu cầu nạp "Chờ xác nhận" tối đa mỗi tài khoản

export const TOPUP_STATUS = {
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  REJECTED: 'rejected',
};
export const TOPUP_STATUS_LABEL = {
  [TOPUP_STATUS.PENDING]: 'Chờ xác nhận',
  [TOPUP_STATUS.CONFIRMED]: 'Đã xác nhận',
  [TOPUP_STATUS.REJECTED]: 'Bị từ chối',
};

// Sổ cái ví (wallet ledger)
export const LEDGER_TYPE = {
  TOPUP: 'topup',     // cộng F khi admin xác nhận nạp
  PAYMENT: 'payment', // trừ F khi thanh toán đơn
  REFUND: 'refund',   // hoàn F khi huỷ đơn đã thanh toán bằng F
};
export const LEDGER_TYPE_LABEL = {
  [LEDGER_TYPE.TOPUP]: 'Nạp F',
  [LEDGER_TYPE.PAYMENT]: 'Thanh toán đơn',
  [LEDGER_TYPE.REFUND]: 'Hoàn F',
};

// ---- Thanh toán đơn -------------------------------------------------------
// Đơn chuyển khoản mà chưa được thanh toán sau chừng này phút sẽ TỰ ĐỘNG HỦY (máy chủ thực hiện).
// Đơn trả bằng ví F được thanh toán ngay khi tạo nên không bị ảnh hưởng.
export const ORDER_PAYMENT_TIMEOUT_MINUTES = 10;
export const PAYMENT_METHOD = {
  BANK: 'bank',     // chuyển khoản ngân hàng (VietQR) — admin đối soát thủ công
  WALLET: 'wallet', // thanh toán bằng ví F — trừ ngay, do máy chủ xử lý
};
export const PAYMENT_METHOD_LABEL = {
  [PAYMENT_METHOD.BANK]: 'Chuyển khoản ngân hàng',
  [PAYMENT_METHOD.WALLET]: 'Ví F',
};

export const PAYMENT_STATUS = {
  UNPAID: 'unpaid',     // chưa thanh toán / chưa được admin xác nhận đã nhận tiền
  PAID: 'paid',         // đã thanh toán (F đã trừ, hoặc admin đã xác nhận nhận chuyển khoản)
  REFUNDED: 'refunded', // đã hoàn F vào ví
};
export const PAYMENT_STATUS_LABEL = {
  [PAYMENT_STATUS.UNPAID]: 'Chờ thanh toán',
  [PAYMENT_STATUS.PAID]: 'Đã thanh toán',
  [PAYMENT_STATUS.REFUNDED]: 'Đã hoàn F',
};

// Hoàn tiền khi huỷ đơn
export const REFUND_STATUS = {
  NONE: 'none',
  REFUNDED_F: 'refunded_f',      // đã hoàn F vào ví (tự động, nguyên tử với việc huỷ)
  BANK_MANUAL: 'bank_manual',    // đơn chuyển khoản bị huỷ: cần liên hệ để hoàn tiền thủ công
  BANK_DONE: 'bank_refunded',    // admin đã hoàn tiền ngân hàng thủ công
};
export const REFUND_STATUS_LABEL = {
  [REFUND_STATUS.NONE]: '',
  [REFUND_STATUS.REFUNDED_F]: 'Đã hoàn F',
  [REFUND_STATUS.BANK_MANUAL]: 'Cần hỗ trợ hoàn tiền',
  [REFUND_STATUS.BANK_DONE]: 'Đã hoàn tiền ngân hàng',
};

// ---- Chuyển khoản nhanh (mở app ngân hàng) -----------------------------------
// Dùng liên kết VietQR (dl.vietqr.io). Để trống QUICK_TRANSFER_APP = trang VietQR tự cho chọn app.
// Nếu muốn ép mở một app cụ thể, điền mã app theo tài liệu VietQR (xem README).
export const QUICK_TRANSFER_BASE_URL = 'https://dl.vietqr.io/pay';
export const QUICK_TRANSFER_APP = '';

// ---- API (Netlify Functions) -----------------------------------------------
export const API = {
  CREATE_ORDER: '/.netlify/functions/create-order',
  CANCEL_ORDER: '/.netlify/functions/cancel-order',
  EXPIRE_ORDER: '/.netlify/functions/expire-order',
  CREATE_TOPUP: '/.netlify/functions/create-topup',
  ADMIN_TOPUP: '/.netlify/functions/admin-topup',
};
