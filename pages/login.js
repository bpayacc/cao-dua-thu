/**
 * pages/login.js — điểm vào JS cho trang Đăng nhập
 */
import { renderHeader } from '../components/header.js';
import { renderFooter } from '../components/footer.js';
import { showToast } from '../components/toast.js';
import {
  login, initAuthData, isAuthenticated, sendResetPasswordEmail, resendVerificationEmailByCredentials,
} from '../services/authService.js';
import { validateEmail, validatePassword, runValidators } from '../utils/validators.js';
import { qs } from '../utils/dom.js';
import { renderBackButton } from '../components/back-button.js';
import { ROUTES, ROLES } from '../config/constants.js';

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
  wirePasswordToggle();
  wireForgotPassword();
}

function wireForm() {
  const form = qs('#loginForm');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const email = qs('#email').value.trim();
    const password = qs('#password').value;

    const result = runValidators([
      () => validateEmail(email),
      () => validatePassword(password),
    ]);

    if (!result.valid) {
      showFieldError(result.message);
      return;
    }
    clearFieldError();

    const submitBtn = qs('#loginSubmitBtn');
    setLoading(submitBtn, true);

    const res = await login(email, password);
    setLoading(submitBtn, false);

    if (!res.success) {
      showToast(res.message, 'error', res.unverified ? 6000 : 3500);
      showFieldError(res.message, res.unverified ? { email, password } : null);
      return;
    }

    showToast(`Chào mừng trở lại, ${res.user.fullName}!`, 'success');

    const params = new URLSearchParams(window.location.search);
    const rawRedirect = params.get('redirect') || '';
    // Chỉ chấp nhận đường dẫn nội bộ (bắt đầu bằng "/", không phải "//") để tránh chuyển hướng ra trang lạ
    const redirect = rawRedirect.startsWith('/') && !rawRedirect.startsWith('//') ? rawRedirect : '';

    setTimeout(() => {
      window.location.href = redirect || (res.user.role === ROLES.ADMIN ? ROUTES.DASHBOARD : ROUTES.HOME);
    }, 500);
  });
}

function wirePasswordToggle() {
  const toggle = qs('#togglePassword');
  const input = qs('#password');
  if (!toggle || !input) return;

  toggle.addEventListener('click', () => {
    const isPassword = input.type === 'password';
    input.type = isPassword ? 'text' : 'password';
    toggle.textContent = isPassword ? 'Ẩn' : 'Hiện';
  });
}

function wireForgotPassword() {
  const link = qs('#forgotPasswordLink');
  if (!link) return;

  link.addEventListener('click', async (e) => {
    e.preventDefault();
    const email = qs('#email').value.trim();

    if (!email) {
      showToast('Vui lòng nhập email ở trên trước, rồi bấm "Quên mật khẩu?" để nhận link đặt lại.', 'info', 4000);
      return;
    }

    link.textContent = 'Đang gửi...';
    const res = await sendResetPasswordEmail(email);
    link.textContent = 'Quên mật khẩu?';
    showToast(res.message, res.success ? 'success' : 'error', 4500);
  });
}

function showFieldError(message, resendCredentials) {
  const errorEl = qs('#loginError');
  if (!errorEl) return;
  errorEl.textContent = message;

  if (resendCredentials) {
    const resendBtn = document.createElement('button');
    resendBtn.type = 'button';
    resendBtn.className = 'form-error__resend';
    resendBtn.textContent = 'Gửi lại email xác minh';
    resendBtn.addEventListener('click', async () => {
      resendBtn.disabled = true;
      resendBtn.textContent = 'Đang gửi...';
      const res = await resendVerificationEmailByCredentials(resendCredentials.email, resendCredentials.password);
      showToast(res.message, res.success ? 'success' : 'error', 4500);
      resendBtn.disabled = false;
      resendBtn.textContent = 'Gửi lại email xác minh';
    });
    errorEl.appendChild(document.createElement('br'));
    errorEl.appendChild(resendBtn);
  }
}
function clearFieldError() {
  showFieldError('');
}

function setLoading(button, isLoading) {
  if (!button) return;
  button.disabled = isLoading;
  button.innerHTML = isLoading
    ? '<span class="spinner" style="border-color:rgba(255,255,255,.35);border-top-color:#fff;width:18px;height:18px;"></span> Đang đăng nhập...'
    : 'Đăng nhập';
}

document.addEventListener('DOMContentLoaded', init);
