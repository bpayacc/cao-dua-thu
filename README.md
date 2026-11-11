# Cáo Đưa Thư

> Bạn viết thư, Cáo sẽ đưa. Có những điều khó nói trực tiếp, hãy để Cáo thay bạn gửi đi.

Website nhận đơn gửi thư TikTok. Frontend HTML5 · CSS3 · JavaScript ES Modules thuần (không framework, **không bước build**) + Firebase Auth + Firestore + **Netlify Functions** (xử lý mọi thứ liên quan tiền).

## Kiến trúc an toàn của Ví F (tóm tắt)
| Việc | Ai làm | Ở đâu |
|---|---|---|
| Tạo đơn, tính giá, trừ F, hủy đơn + hoàn F | **Máy chủ** (transaction) | `netlify/functions/create-order`, `cancel-order` |
| Tự động hủy đơn chuyển khoản quá 10 phút | **Máy chủ** (chạy mỗi phút + khi đồng hồ về 0) | `expire-orders` (scheduled), `expire-order` |
| Tạo yêu cầu nạp F | **Máy chủ** | `create-topup` |
| Xác nhận (cộng F) / từ chối nạp | **Máy chủ, chỉ admin** | `admin-topup` |
| Số dư + sổ cái (`wallets/{uid}`, `ledger`) | Chỉ máy chủ ghi; trình duyệt chỉ đọc | `firestore.rules` |
| Admin đổi trạng thái đơn (Đã nhận tiền → Đang xử lý → Đã gửi…) | Admin, trực tiếp Firestore, Rules kiểm từng bước | `firestore.rules` |

- Giá luôn do máy chủ tự tính từ `config/constants.js` (`LETTER_PACKAGES`), không tin giá của trình duyệt.
- Chống xử lý trùng: id đơn = `uid_requestId`; id sổ cái = `pay_<đơn>` / `refund_<đơn>` / `topup_<giao dịch>`. Bấm lặp hoặc gửi đồng thời không thể trừ / hoàn / cộng hai lần.
- **Hệ thống KHÔNG tự đối soát ngân hàng.** Nạp F và đơn chuyển khoản đều do admin kiểm tra tiền thực nhận rồi bấm xác nhận.

## Chạy thử local
- Chỉ xem giao diện tĩnh: `npx serve .` (các chức năng cần máy chủ sẽ báo "chưa sẵn sàng" — đúng hành vi, không có dữ liệu giả).
- Chạy cả Functions: `npm install` rồi `npx netlify dev` (cần đặt biến môi trường bên dưới, ví dụ trong file `.env` KHÔNG commit).

## Triển khai Netlify
1. Build command: **để trống** · Publish directory: **`.`** · Functions: `netlify/functions` (đã khai báo trong `netlify.toml`). Netlify tự chạy `npm install` để cài `firebase-admin` từ `package.json`.
2. Thêm domain Netlify vào Firebase Console → Authentication → Settings → **Authorized domains**.
3. Thêm **Environment variables** (Site settings → Environment variables; tick *Contains secret values*). KHÔNG đặt trong mã nguồn:

| Biến | Giá trị |
|---|---|
| `FIREBASE_PROJECT_ID` | `project_id` trong file service account (phải TRÙNG project của `config/firebaseClient.js`) |
| `FIREBASE_CLIENT_EMAIL` | `client_email` |
| `FIREBASE_PRIVATE_KEY` | `private_key` (giữ nguyên `\n`; code tự đổi thành xuống dòng) |

   Lấy khoá: Firebase Console → Project settings → Service accounts → *Generate new private key*. (Có thể thay 3 biến bằng một biến `FIREBASE_SERVICE_ACCOUNT` chứa nguyên JSON; nên dùng 3 biến vì Netlify giới hạn kích thước biến môi trường.) Sau khi tạo biến, **deploy lại**.
4. **Dán `firestore.rules` mới** vào Firebase Console → Firestore → Rules → *Publish*. ⚠ Rules mới KHÔNG cho trình duyệt tạo/sửa đơn, ví, bộ đếm nữa — nên chỉ publish khi đã deploy Functions, nếu không khách không đặt được thư.
5. Tài khoản admin: đăng ký bình thường, xác minh email, vào Firestore → `users/<uid>` → đặt `role = "admin"`.

## Cấu hình trong `config/constants.js`
- Giá gói (`LETTER_PACKAGES`): 1 thư 3.000 F · 3 thư 8.000 F · 5 thư 14.000 F (1 F = 1 VNĐ).
- Giới hạn thư: `LETTER_MIN_LENGTH = 10`, `LETTER_MAX_LENGTH = 600` (giao diện + `validators.js` + máy chủ đều dùng chung).
- Nạp F: `WALLET_TOPUP_MIN` (1.000), `WALLET_TOPUP_MAX` (5.000.000), `WALLET_MAX_PENDING_TOPUPS` (5 yêu cầu chờ).
- `BANK_INFO` (không đổi), `CONTACT_CHANNELS` (điền khi có kênh liên hệ; nút "Liên hệ" khi hủy đơn chuyển khoản dùng kênh đầu tiên đã điền, chưa có thì dẫn tới trang Liên hệ).
- Chuyển khoản nhanh: `QUICK_TRANSFER_BASE_URL` (`https://dl.vietqr.io/pay`), `QUICK_TRANSFER_APP` (để trống = trang VietQR cho chọn app ngân hàng).

## Tự động hủy đơn sau 10 phút
- Chỉ áp dụng cho đơn **chuyển khoản** còn `Chờ thanh toán`. Đơn trả bằng ví F (đã thanh toán ngay) và đơn admin đã bấm "Đã nhận tiền" không bao giờ bị hủy kiểu này.
- Hạn = lúc tạo + `ORDER_PAYMENT_TIMEOUT_MINUTES` (10, trong `config/constants.js`). Máy chủ quyết định giờ — khách chỉnh đồng hồ máy không hủy sớm được.
- Hai cơ chế: Netlify Scheduled Function `expire-orders` (mỗi phút, chạy cả khi khách đã đóng trang) và `expire-order` (trang gọi khi đồng hồ về 0). Đơn hủy bị ghi `cancelledBy = "system"`.
- ⚠ Hệ thống không thấy được tiền vào ngân hàng: nếu khách chuyển khoản sau khi đơn đã hết hạn, đơn vẫn bị hủy. Khách được hướng dẫn liên hệ; admin lọc "Hết hạn thanh toán" → "Khách đã chuyển → cần hoàn" rồi hoàn tiền thủ công.
- Đơn cũ (tạo trước tính năng này) đang "Chờ thanh toán" sẽ bị hủy ở lần quét đầu tiên nếu đã quá 10 phút.

## Luồng đơn & hoàn tiền
- **Chuyển khoản**: đơn `Chờ thanh toán` → admin đối soát → `Đã thanh toán` → `Đang xử lý` → `Đã gửi thư` / `Không thể gửi`. Khách chỉ tự hủy được khi còn `Chờ thanh toán`; hủy xong đơn đánh dấu `Cần hỗ trợ hoàn tiền` (admin lọc "Cần hoàn tiền NH", hoàn thủ công rồi bấm "Đã hoàn tiền NH"). **Không bao giờ tự cộng F.**
- **Ví F**: trừ F + tạo đơn ở trạng thái `Đã thanh toán` trong 1 transaction. Khách tự hủy (hoàn đúng 1 lần) cho tới khi admin bấm "Bắt đầu xử lý". Sau đó không hủy được.
- Đơn tạo từ phiên bản cũ (chưa có trường thanh toán) được coi là chuyển khoản; dữ liệu cũ không bị sửa.

## Kiểm thử
- `node tests/server/run.mjs` — 121 kiểm thử logic máy chủ trên Firestore giả lập (giá, giới hạn 600, trừ F, thiếu F, thanh toán trùng/đồng thời, nạp, xác nhận/từ chối, hủy/hoàn, quyền admin).
- Các kiểm thử giao diện (Chromium) và mô phỏng Rules chỉ chạy trong môi trường phát triển, không kèm theo dự án.
- **Chưa kiểm thử với Firebase / Netlify / TikTok / VietQR thật** — xem danh sách "cần kiểm tra sau khi deploy" trong ghi chú bàn giao.

## Kiểm tra TikTok (bước 3)
Netlify Function `check-tiktok` hỏi oEmbed của TikTok: `FOUND` / `NOT_VERIFIED` / `UNKNOWN`. FOUND **không** nghĩa là hồ sơ công khai hay nhận tin nhắn từ người lạ. Kiểm tra là tuỳ chọn. Giới hạn tần suất của function chỉ là best-effort trong bộ nhớ; muốn chống spam thật sự hãy bật Rate Limiting của Netlify hoặc dùng WAF/Cloudflare.

## Giới hạn hiện tại
- Chưa có API để TikTok tự gửi tin nhắn: admin gửi thủ công (Dashboard có nút "Sao chép").
- Chưa tự động đối soát chuyển khoản / nạp F.
- Đơn ví F bị admin đánh dấu "Không thể gửi" **không** tự hoàn F (chưa có quy định) — nếu cần, bổ sung thao tác hoàn F của admin.
- Liên hệ chưa có form gửi tin.
