/**
 * pages/register.js — điểm vào JS cho trang Đăng ký
 */
import { renderHeader } from '../components/header.js';
import { renderFooter } from '../components/footer.js';
import { showToast } from '../components/toast.js';
import { register, initAuthData, isAuthenticated } from '../services/authService.js';
import {
  validateEmail, validatePassword, validateRequired, validateMatch, runValidators,
} from '../utils/validators.js';
import { qs } from '../utils/dom.js';
import { renderBackButton } from '../components/back-button.js';
import { ROUTES } from '../config/constants.js';

async function init() {
  await initAuthData();
  await renderHeader('#app-header');
  renderFooter('#app-footer');
  renderBackButton('#pageBack', { fallbackHref: ROUTES.HOME });

  if (await isAuthenticated()) {
    window.location.href = ROUTES.HOME;
    return;
  }

  wireForm();
}

function wireForm() {
  const form = qs('#registerForm');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const fullName = qs('#fullName').value.trim();
    const email = qs('#email').value.trim();
    const password = qs('#password').value;
    const confirmPassword = qs('#confirmPassword').value;
    const agreeTerms = qs('#agreeTerms').checked;

    const result = runValidators([
      () => validateRequired(fullName, 'Họ và tên'),
      () => validateEmail(email),
      () => validatePassword(password),
      () => validateMatch(confirmPassword, password, 'Mật khẩu nhập lại không khớp.'),
    ]);

    if (!result.valid) {
      showFieldError(result.message);
      return;
    }
    if (!agreeTerms) {
      showFieldError('Bạn cần đồng ý với Điều khoản dịch vụ để tiếp tục.');
      return;
    }
    clearFieldError();

    const submitBtn = qs('#registerSubmitBtn');
    setLoading(submitBtn, true);

    const res = await register({ fullName, email, password });
    setLoading(submitBtn, false);

    if (!res.success) {
      showToast(res.message, 'error');
      showFieldError(res.message);
      return;
    }

    showToast(res.message, 'success', 5000);
    setTimeout(() => { window.location.href = ROUTES.LOGIN; }, 1600);
  });
}

function showFieldError(message) {
  const errorEl = qs('#registerError');
  if (errorEl) errorEl.textContent = message;
}
function clearFieldError() {
  showFieldError('');
}

function setLoading(button, isLoading) {
  if (!button) return;
  button.disabled = isLoading;
  button.innerHTML = isLoading
    ? '<span class="spinner" style="border-color:rgba(255,255,255,.35);border-top-color:#fff;width:18px;height:18px;"></span> Đang tạo tài khoản...'
    : 'Tạo tài khoản';
}

document.addEventListener('DOMContentLoaded', init);
