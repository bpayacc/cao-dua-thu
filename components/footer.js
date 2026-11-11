/**
 * components/footer.js
 * Render footer dùng chung cho các trang phía khách hàng.
 */
import { mount } from '../utils/dom.js';
import { ROUTES, APP_NAME, APP_TAGLINE } from '../config/constants.js';

export function renderFooter(mountSelector = '#app-footer') {
  const year = new Date().getFullYear();

  const html = `
    <div class="container footer__inner">
      <div class="footer__brand">
        <div class="footer__logo">
          <img src="/assets/img/logo-96.png" width="40" height="40" alt="Logo Cáo Đưa Thư" class="brand-logo" />
          <span>${APP_NAME}</span>
        </div>
        <p>${APP_TAGLINE} Có những điều khó nói trực tiếp, hãy để Cáo thay bạn gửi đi.</p>
      </div>

      <div class="footer__col">
        <h4>Khám phá</h4>
        <a href="${ROUTES.SEND_LETTER}">Gửi một bức thư</a>
        <a href="${ROUTES.ABOUT}">Giới thiệu</a>
        <a href="${ROUTES.HOME}#faq">Câu hỏi thường gặp</a>
      </div>

      <div class="footer__col">
        <h4>Tài khoản</h4>
        <a href="${ROUTES.LOGIN}">Đăng nhập</a>
        <a href="${ROUTES.REGISTER}">Đăng ký</a>
        <a href="${ROUTES.MY_ORDERS}">Đơn của tôi</a>
      </div>

      <div class="footer__col">
        <h4>Thông tin</h4>
        <a href="${ROUTES.TERMS}">Điều khoản sử dụng</a>
        <a href="${ROUTES.CONTACT}">Liên hệ</a>
      </div>
    </div>
    <div class="footer__bottom">
      <div class="container">© ${year} ${APP_NAME}. Thư của bạn được giữ kín, chỉ dùng để xử lý đơn hàng.</div>
    </div>
  `;

  mount(mountSelector, html);
}
