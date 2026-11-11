/**
 * pages/home.js — điểm vào JS riêng cho Trang chủ (index.html)
 * Bảng giá đọc từ config/constants.js (không hard-code trong HTML);
 * FAQ dựng dạng accordion.
 */
import { renderHeader } from '../components/header.js';
import { renderFooter } from '../components/footer.js';
import { initAuthData } from '../services/authService.js';
import { setupScrollReveal } from '../utils/scroll-reveal.js';
import { setupFaq } from '../components/faq.js';
import { qs } from '../utils/dom.js';
import { fHtml } from '../utils/formatters.js';
import { LETTER_PACKAGES, ROUTES } from '../config/constants.js';

const FAQS = [
  {
    question: 'Cáo Đưa Thư hoạt động như thế nào?',
    answer: 'Bạn chọn gói thư, chọn gửi ẩn danh hoặc có tên, nhập ID TikTok của người nhận, viết thư rồi xác nhận và chuyển khoản. Sau khi Cáo đối soát được thanh toán, đội ngũ sẽ gửi thư đến tài khoản TikTok của người nhận.',
  },
  {
    question: 'Tôi có thể gửi thư ẩn danh không?',
    answer: 'Có. Khi chọn "Gửi ẩn danh", tên của bạn không xuất hiện trong nội dung thư. Hãy lưu ý: nếu chính bạn viết tên hoặc thông tin nhận dạng vào thư thì người nhận vẫn sẽ thấy.',
  },
  {
    question: 'Người nhận có biết ai đã gửi thư không?',
    answer: 'Với thư ẩn danh, người nhận không được biết danh tính người gửi — thư ghi "một người giấu tên". Với thư có tên, tên bạn nhập sẽ hiện ở cuối thư. Thông tin người gửi chỉ dùng để xử lý đơn hàng.',
  },
  {
    question: 'Nếu nhập sai ID TikTok thì sao?',
    answer: 'Đơn sẽ không đủ điều kiện gửi và không được hoàn tiền. Vì vậy hãy kiểm tra thật kỹ ID ở bước xác nhận — bạn có thể quay lại sửa bất cứ lúc nào trước khi đặt.',
  },
  {
    question: 'Nếu người nhận không nhận được tin nhắn thì sao?',
    answer: 'Cáo không thể gửi đến tài khoản riêng tư hoặc tài khoản đã tắt nhận tin nhắn từ người lạ. Cáo chưa có công cụ xác minh tự động các thiết lập này, nên bạn cần đảm bảo trước khi đặt. Trường hợp này đơn không đủ điều kiện gửi và không được hoàn tiền.',
  },
  {
    question: 'Bao lâu thì thư được gửi đi?',
    answer: 'Cáo sẽ cố gắng gửi trong thời gian sớm nhất có thể, nhưng không cam kết một mốc thời gian cụ thể — thời gian có thể thay đổi tùy số lượng đơn và tình trạng của TikTok. Bạn theo dõi trạng thái đơn ngay trong mục "Đơn của tôi".',
  },
  {
    question: 'Tôi có được hoàn tiền không?',
    answer: 'Nếu nhập sai ID TikTok hoặc tài khoản người nhận không cho phép nhận tin nhắn từ người lạ thì đơn không được hoàn tiền. Bạn có thể tự hủy đơn khi Cáo chưa xác nhận/xử lý: đơn trả bằng ví F được hoàn lại đúng số F, đơn chuyển khoản cần liên hệ Cáo để được hỗ trợ hoàn tiền. Các trường hợp khác, bạn vui lòng liên hệ Cáo để được xem xét.',
  },
  {
    question: 'Ví F là gì?',
    answer: 'F là đơn vị trong ví của bạn trên Cáo Đưa Thư, 1 F = 1 VNĐ. Bạn nạp F bằng chuyển khoản; Cáo kiểm tra tiền thực nhận rồi mới cộng F vào ví. Sau đó bạn có thể dùng F để thanh toán đơn thư nhanh hơn, không cần chuyển khoản lại cho từng đơn.',
  },
];

function renderPrices() {
  qs('#priceGrid').innerHTML = LETTER_PACKAGES.map((pkg, index) => `
    <article class="price-card ${index === 1 ? 'price-card--accent' : ''}" data-reveal>
      <span class="price-card__icon" aria-hidden="true">${'✉️'.repeat(pkg.letterCount)}</span>
      <h3>${pkg.name}</h3>
      <p>${pkg.tagline}</p>
      <div class="price-card__price">${fHtml(pkg.price)}</div>
      <a href="${ROUTES.SEND_LETTER}" class="btn ${index === 1 ? 'btn--primary' : 'btn--outline'} btn--block">Chọn gói này</a>
    </article>
  `).join('');
}

async function init() {
  initAuthData();
  await renderHeader('#app-header');
  renderFooter('#app-footer');
  renderPrices();
  setupFaq('#faqList', FAQS);
  setupScrollReveal();
}

document.addEventListener('DOMContentLoaded', init);
