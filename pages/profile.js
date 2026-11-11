/**
 * pages/profile.js — điểm vào JS cho trang Hồ sơ (ho-so.html)
 */
import { renderHeader } from '../components/header.js';
import { renderFooter } from '../components/footer.js';
import { showToast } from '../components/toast.js';
import { requireAuth } from '../utils/router-guard.js';
import { qs } from '../utils/dom.js';
import { getInitials } from '../utils/formatters.js';
import { validatePhone, validateRequired, validatePassword, validateMatch, runValidators } from '../utils/validators.js';
import { initAuthData, updateProfile, changePassword, logout, resendVerificationEmail } from '../services/authService.js';
import { renderBackButton } from '../components/back-button.js';
import { ROUTES } from '../config/constants.js';

let currentUser = null;

async function init() {
  initAuthData();
  await renderHeader('#app-header');
  renderFooter('#app-footer');

  currentUser = await requireAuth();
  if (!currentUser) return;

  renderBackButton('#pageBack', { fallbackHref: ROUTES.HOME });
  renderProfileSummary();
  renderVerifyBanner();
  fillProfileForm();
  wireProfileForm();
  wirePasswordForm();
}

function renderVerifyBanner() {
  const banner = qs('#verifyEmailBanner');
  if (!banner) return;

  banner.style.display = currentUser.emailVerified ? 'none' : 'block';

  qs('#resendVerifyBtn')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = 'Đang gửi...';
    const res = await resendVerificationEmail();
    showToast(res.message, res.success ? 'success' : 'error');
    btn.disabled = false;
    btn.textContent = 'Gửi lại email xác minh';
  });
}

function renderProfileSummary() {
  qs('#profileAvatar').textContent = getInitials(currentUser.fullName);
  qs('#profileAvatar').style.background = currentUser.avatarColor;
  qs('#profileName').textContent = currentUser.fullName;
  qs('#profileEmail').textContent = currentUser.email;
}

function fillProfileForm() {
  qs('#fullName').value = currentUser.fullName;
  qs('#email').value = currentUser.email;
  qs('#phone').value = currentUser.phone;
}

function wireProfileForm() {
  const form = qs('#profileForm');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const fullName = qs('#fullName').value.trim();
    const phone = qs('#phone').value.trim();

    const result = runValidators([
      () => validateRequired(fullName, 'Họ và tên'),
      () => (phone ? validatePhone(phone) : { valid: true, message: '' }),
    ]);

    if (!result.valid) {
      showToast(result.message, 'error');
      return;
    }

    const res = await updateProfile(currentUser.id, { fullName, phone });
    if (res.success) {
      currentUser = res.user;
      renderProfileSummary();
      showToast('Đã cập nhật hồ sơ.', 'success');
    } else {
      showToast(res.message, 'error');
    }
  });
}

function wirePasswordForm() {
  const form = qs('#passwordForm');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const currentPassword = qs('#currentPassword').value;
    const newPassword = qs('#newPassword').value;
    const confirmPassword = qs('#confirmNewPassword').value;

    const result = runValidators([
      () => validateRequired(currentPassword, 'Mật khẩu hiện tại'),
      () => validatePassword(newPassword),
      () => validateMatch(confirmPassword, newPassword, 'Mật khẩu nhập lại không khớp.'),
    ]);

    if (!result.valid) {
      showToast(result.message, 'error');
      return;
    }

    const res = await changePassword(currentUser.id, currentPassword, newPassword);
    showToast(res.message, res.success ? 'success' : 'error');

    if (res.success) {
      form.reset();
      showToast('Vui lòng đăng nhập lại với mật khẩu mới.', 'info', 2600);
      setTimeout(async () => { await logout(); window.location.href = ROUTES.LOGIN; }, 1600);
    }
  });
}

document.addEventListener('DOMContentLoaded', init);
