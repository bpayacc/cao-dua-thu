/**
 * config/firebaseClient.js
 * -----------------------------------------------------------------------
 * Khởi tạo Firebase App + Auth + Firestore, dùng chung cho toàn bộ services.
 * Import trực tiếp từ CDN gstatic — trình duyệt hỗ trợ import ES Module từ
 * URL đầy đủ nên KHÔNG cần bundler/npm install, vẫn giữ nguyên tắc
 * "HTML/CSS/JS thuần" của dự án.
 *
 * Firebase Auth lo việc đăng ký/đăng nhập/đổi mật khẩu/xác minh email thật.
 * Firestore (collection "users") lưu thêm các trường mà Firebase Auth
 * không có sẵn: role (customer/admin), school, phone, avatarColor.
 *
 * firebaseConfig bên dưới là cấu hình CÔNG KHAI — an toàn khi lộ ở trình
 * duyệt (bảo mật thật sự nằm ở Firestore Security Rules, không nằm ở việc
 * giấu các giá trị này).
 * -----------------------------------------------------------------------
 */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyCgfNi5adlTVoPbBYh7ioGG0xwcs7JgUxw',
  authDomain: 'doub-shop.firebaseapp.com',
  projectId: 'doub-shop',
  storageBucket: 'doub-shop.firebasestorage.app',
  messagingSenderId: '214788618625',
  appId: '1:214788618625:web:bc6f79948ad537004a9080',
  measurementId: 'G-LE0NZYFNWH',
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
