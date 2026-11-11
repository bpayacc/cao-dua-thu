/**
 * utils/router-guard.js
 * Gọi ở đầu mỗi trang cần bảo vệ để tự động điều hướng nếu người dùng
 * chưa đăng nhập hoặc không đủ quyền. Vì việc kiểm tra phiên đăng nhập giờ
 * đi qua Firebase Auth (bất đồng bộ), các hàm này là async — luôn nhớ dùng await.
 */
import { getCurrentUser } from '../services/authService.js';
import { ROLES, ROUTES } from '../config/constants.js';

/** Bắt buộc đã đăng nhập, nếu không thì chuyển sang trang đăng nhập */
export async function requireAuth() {
  const user = await getCurrentUser();
  if (!user) {
    const redirect = encodeURIComponent(window.location.pathname);
    window.location.href = `${ROUTES.LOGIN}?redirect=${redirect}`;
    return null;
  }
  return user;
}

/** Bắt buộc quyền admin, nếu không thì đưa về trang chủ */
export async function requireAdmin() {
  const user = await requireAuth();
  if (!user) return null;
  if (user.role !== ROLES.ADMIN) {
    window.location.href = ROUTES.HOME;
    return null;
  }
  return user;
}
