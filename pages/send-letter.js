/**
 * pages/send-letter.js — điểm vào JS cho trang Gửi thư (gui-thu.html)
 * Quy trình 5 bước: Chọn gói → Hình thức gửi → ID TikTok → Viết thư → Xác nhận,
 * sau đó tạo đơn thật trên Firestore (trạng thái "Chờ thanh toán") và hiện khối
 * thanh toán chuyển khoản VietQR hiện có.
 *
 * Bản nháp (gói, tên, ID, nội dung thư) được giữ trong sessionStorage của tab
 * để khách không mất thư khi phải đăng nhập giữa chừng; xoá ngay khi đặt thành công.
 */
import { renderHeader } from '../components/header.js';
import { renderFooter } from '../components/footer.js';
import { renderPaymentBox } from '../components/payment-box.js';
import { showToast } from '../components/toast.js';
import { startPaymentWatch } from '../components/payment-watch.js';
import { getSupportLink } from '../utils/payment-info.js';
import { qs, qsa, createEl, escapeHtml } from '../utils/dom.js';
import { formatDateTime, formatF, fHtml } from '../utils/formatters.js';
import { parseTikTokId, validateLetterContent, normalizeLetterForCompare } from '../utils/validators.js';
import { createLeaveGuard } from '../utils/leave-guard.js';
import { composeLetterMessage } from '../utils/letter-format.js';
import { initAuthData, getCurrentUser } from '../services/authService.js';
import { createOrder, getPackageById } from '../services/orderService.js';
import { getBalance } from '../services/walletService.js';
import { newRequestId } from '../services/apiClient.js';
import { checkTikTokAccount, TIKTOK_CHECK_STATUS } from '../services/tiktokService.js';
import {
  ROUTES, LETTER_PACKAGES, SENDER_MODE, ORDER_STATUS_LABEL, PAYMENT_METHOD, ORDER_STATUS, ORDER_PAYMENT_TIMEOUT_MINUTES,
  LETTER_MIN_LENGTH, LETTER_MAX_LENGTH, SENDER_NAME_MAX_LENGTH,
} from '../config/constants.js';

const DRAFT_KEY = 'cdt_letter_draft';
const STEP_LABELS = ['Chọn gói', 'Hình thức gửi', 'ID TikTok', 'Viết thư', 'Xác nhận'];
const TOTAL_STEPS = STEP_LABELS.length;
// Mã lỗi cho biết CHẮC CHẮN đơn chưa được tạo (an toàn để dùng mã yêu cầu mới)
const DEFINITE_FAILURES = ['INVALID_INPUT', 'INSUFFICIENT_FUNDS', 'NOT_FOUND', 'FORBIDDEN', 'EMAIL_NOT_VERIFIED', 'RATE_LIMITED', 'UNAUTHENTICATED'];

const SENDER_MODES = [
  {
    id: SENDER_MODE.ANONYMOUS,
    title: 'Gửi ẩn danh',
    desc: 'Người nhận không biết bạn là ai. Tên bạn không xuất hiện trong thư.',
    icon: '🎭',
  },
  {
    id: SENDER_MODE.NAMED,
    title: 'Gửi có tên',
    desc: 'Thư ghi rõ tên bạn ở cuối, để người nhận biết ai đã gửi.',
    icon: '✍️',
  },
];

let state = {
  step: 1, packageId: null, senderMode: null, senderName: '', tiktok: '', letters: [], activeLetter: 0, agreed: false,
  tiktokCheck: null, // kết quả kiểm tra TikTok — chỉ giữ trong bộ nhớ, không lưu vào bản nháp
  paymentMethod: PAYMENT_METHOD.BANK, // mặc định chuyển khoản như trước đây
  requestId: null, // khoá chống tạo/trừ tiền trùng; giữ khi lỗi mạng để thử lại không bị trừ hai lần
};
let walletBalance = null; // null = chưa biết / không đọc được; số = số dư F đọc từ máy chủ
let balanceLoading = false;
let orderDone = false;
let guard = null;
let currentUser = null;
let isSubmitting = false;

// ---- Kiểm tra tài khoản TikTok (bước 3) ----
const CHECK_COOLDOWN_MS = 3000;       // giãn cách tối thiểu giữa hai lần bấm
const CHECK_MAX_PER_MINUTE = 6;       // trần số lần kiểm tra mỗi phút trong một tab (chỉ là lớp giảm spam phía giao diện)
let checkSeq = 0;                     // số thứ tự yêu cầu — chặn kết quả cũ ghi đè kết quả mới
let checkController = null;
let checkTimes = [];
let isChecking = false;

/* ===================== Khởi tạo ===================== */

async function init() {
  initAuthData();
  await renderHeader('#app-header');
  renderFooter('#app-footer');

  currentUser = await getCurrentUser();
  loadDraft();
  syncLettersToPackage();

  guard = createLeaveGuard({ isDirty: hasDraftData, onLeave: clearDraft });
  guard.refresh();

  renderPackages();
  renderSenderModes();
  wireInputs();
  qs('#wizardForm').addEventListener('submit', (e) => e.preventDefault());
  qs('#prevBtn').addEventListener('click', () => goToStep(state.step - 1));
  qs('#nextBtn').addEventListener('click', handleNext);

  goToStep(state.step, { scroll: false });
}

/* ===================== Bản nháp ===================== */

function saveDraft() {
  try {
    const { agreed, tiktokCheck, ...draft } = state; // luôn bắt khách tick lại xác nhận; kết quả kiểm tra TikTok cũng không giữ lại
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch (error) { /* trình duyệt chặn storage → bỏ qua, không ảnh hưởng chức năng */ }
  guard?.refresh();
}

/** Đã bắt đầu chọn / nhập dữ liệu chưa (và đơn chưa được tạo) — dùng cho cảnh báo rời trang */
function hasDraftData() {
  if (orderDone) return false;
  return !!(state.packageId || state.senderMode || state.senderName.trim() || state.tiktok.trim() || state.letters.some((l) => l.trim()));
}

function loadDraft() {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return;
    const draft = JSON.parse(raw);
    state = { ...state, ...draft, agreed: false, tiktokCheck: null };
    if (!getPackageById(state.packageId)) state.packageId = null;
    if (!Number.isInteger(state.step) || state.step < 1 || state.step > TOTAL_STEPS) state.step = 1;
    if (!Array.isArray(state.letters)) state.letters = [];
  } catch (error) { /* nháp hỏng → bắt đầu lại */ }
}

function clearDraft() {
  try { sessionStorage.removeItem(DRAFT_KEY); } catch (error) { /* bỏ qua */ }
}

/* ===================== Điều hướng bước ===================== */

function goToStep(step, { scroll = true } = {}) {
  state.step = Math.min(Math.max(step, 1), TOTAL_STEPS);

  qsa('.step-panel').forEach((panel) => {
    panel.classList.toggle('is-active', Number(panel.dataset.step) === state.step);
  });

  if (state.step === 4) renderLetterEditor();
  if (state.step === 5) renderConfirm();

  renderStepper();
  renderSideSummary();
  renderNav();
  saveDraft();

  if (scroll) qs('#stepper').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderStepper() {
  const items = STEP_LABELS.map((label, index) => {
    const n = index + 1;
    const cls = n < state.step ? 'is-done' : n === state.step ? 'is-current' : '';
    const inner = `<span class="stepper__dot">${n < state.step ? '✓' : n}</span><span class="stepper__label">${label}</span>`;
    return n < state.step
      ? `<li class="stepper__item ${cls}"><button type="button" data-goto="${n}" aria-label="Quay lại bước ${n}: ${label}">${inner}</button></li>`
      : `<li class="stepper__item ${cls}" ${n === state.step ? 'aria-current="step"' : ''}><div>${inner}</div></li>`;
  }).join('');

  qs('#stepper').innerHTML = `
    <ol class="stepper__list">${items}</ol>
    <p class="stepper__caption">Bước ${state.step}/${TOTAL_STEPS} · <strong>${STEP_LABELS[state.step - 1]}</strong></p>
  `;
  qsa('#stepper [data-goto]').forEach((btn) => btn.addEventListener('click', () => goToStep(Number(btn.dataset.goto))));
}

function renderNav() {
  qs('#prevBtn').classList.toggle('is-hidden', state.step === 1);
  const next = qs('#nextBtn');
  if (isSubmitting) return;
  next.disabled = false;
  if (state.step < TOTAL_STEPS) next.textContent = 'Tiếp tục →';
  else if (!currentUser) next.textContent = 'Đăng nhập để đặt thư';
  else if (state.paymentMethod === PAYMENT_METHOD.WALLET) next.textContent = 'Thanh toán bằng F';
  else next.textContent = 'Xác nhận & chuyển khoản';
}

async function handleNext() {
  if (isSubmitting) return;

  const check = validateStep(state.step);
  if (!check.valid) {
    showStepError(state.step, check.message);
    return;
  }
  clearStepErrors();

  if (state.step < TOTAL_STEPS) {
    goToStep(state.step + 1);
    return;
  }
  await submitOrder();
}

/* ===================== Kiểm tra từng bước ===================== */

function validateStep(step) {
  if (step === 1) {
    return getPackageById(state.packageId)
      ? { valid: true }
      : { valid: false, message: 'Vui lòng chọn gói gửi thư.' };
  }

  if (step === 2) {
    if (!state.senderMode) return { valid: false, message: 'Vui lòng chọn hình thức gửi.' };
    if (state.senderMode === SENDER_MODE.NAMED) {
      const name = state.senderName.trim();
      if (!name) return { valid: false, message: 'Bạn đã chọn gửi có tên — vui lòng nhập tên người gửi.' };
      if (name.length > SENDER_NAME_MAX_LENGTH) {
        return { valid: false, message: `Tên người gửi tối đa ${SENDER_NAME_MAX_LENGTH} ký tự.` };
      }
    }
    return { valid: true };
  }

  if (step === 3) {
    const parsed = parseTikTokId(state.tiktok);
    return parsed.valid ? { valid: true } : { valid: false, message: parsed.message };
  }

  if (step === 4) {
    const pkg = getPackageById(state.packageId);
    for (let i = 0; i < pkg.letterCount; i += 1) {
      const label = pkg.letterCount > 1 ? `Thư ${i + 1}` : 'Nội dung thư';
      const result = validateLetterContent(state.letters[i], LETTER_MIN_LENGTH, LETTER_MAX_LENGTH, label);
      if (!result.valid) {
        state.activeLetter = i;
        renderLetterEditor();
        return result;
      }
    }
    const trimmed = state.letters.slice(0, pkg.letterCount).map(normalizeLetterForCompare);
    if (pkg.letterCount > 1 && new Set(trimmed).size !== trimmed.length) {
      return { valid: false, message: 'Mỗi bức thư cần có nội dung riêng, không dùng chung một nội dung cho nhiều thư.' };
    }
    return { valid: true };
  }

  if (step === 5) {
    return state.agreed
      ? { valid: true }
      : { valid: false, message: 'Bạn cần tick xác nhận đã kiểm tra ID TikTok và đồng ý điều khoản để tiếp tục.' };
  }
  return { valid: true };
}

function showStepError(step, message) {
  clearStepErrors();
  const target = { 1: '#packageOptions', 2: '#senderNameError', 3: '#tiktokError', 4: '#letterError', 5: '#confirmError' }[step];
  if (step === 1) {
    showToast(message, 'error');
    return;
  }
  if (step === 2 && !state.senderMode) {
    showToast(message, 'error');
    return;
  }
  const el = qs(target);
  if (el) el.textContent = message;
  showToast(message, 'error');
}

function clearStepErrors() {
  ['#senderNameError', '#tiktokError', '#letterError', '#confirmError'].forEach((sel) => {
    const el = qs(sel);
    if (el) el.textContent = '';
  });
}

/* ===================== Bước 1 & 2: thẻ lựa chọn ===================== */

function renderPackages() {
  qs('#packageOptions').innerHTML = LETTER_PACKAGES.map((pkg) => `
    <button type="button" class="choice-card ${pkg.id === state.packageId ? 'is-selected' : ''}" role="radio"
            aria-checked="${pkg.id === state.packageId}" data-package="${pkg.id}">
      <span class="choice-card__icon" aria-hidden="true">✉️${pkg.letterCount > 1 ? `<b class="choice-card__count">×${pkg.letterCount}</b>` : ''}</span>
      <span class="choice-card__title">${escapeHtml(pkg.name)}</span>
      <span class="choice-card__desc">${escapeHtml(pkg.tagline)}</span>
      <span class="choice-card__price">${fHtml(pkg.price)}</span>
    </button>
  `).join('');

  qsa('[data-package]').forEach((btn) => btn.addEventListener('click', () => {
    state.packageId = btn.dataset.package;
    syncLettersToPackage();
    renderPackages();
    renderSideSummary();
    saveDraft();
  }));
}

function renderSenderModes() {
  qs('#senderModeOptions').innerHTML = SENDER_MODES.map((mode) => `
    <button type="button" class="choice-card ${mode.id === state.senderMode ? 'is-selected' : ''}" role="radio"
            aria-checked="${mode.id === state.senderMode}" data-mode="${mode.id}">
      <span class="choice-card__icon" aria-hidden="true">${mode.icon}</span>
      <span class="choice-card__title">${mode.title}</span>
      <span class="choice-card__desc">${mode.desc}</span>
    </button>
  `).join('');

  qsa('[data-mode]').forEach((btn) => btn.addEventListener('click', () => {
    state.senderMode = btn.dataset.mode;
    renderSenderModes();
    updateSenderNameVisibility();
    renderSideSummary();
    saveDraft();
    if (state.senderMode === SENDER_MODE.NAMED) qs('#senderName').focus();
  }));
  updateSenderNameVisibility();
}

function updateSenderNameVisibility() {
  qs('#senderNameGroup').classList.toggle('is-hidden', state.senderMode !== SENDER_MODE.NAMED);
}

/** Giữ đúng số ô thư theo gói (1 hoặc 3), không làm mất nội dung đã viết */
function syncLettersToPackage() {
  const pkg = getPackageById(state.packageId);
  const count = pkg ? pkg.letterCount : 1;
  const next = Array.from({ length: count }, (_, i) => state.letters[i] || '');
  state.letters = next;
  if (state.activeLetter >= count) state.activeLetter = 0;
}

/* ===================== Bước 3 & 4: ô nhập ===================== */

function wireInputs() {
  const nameInput = qs('#senderName');
  nameInput.value = state.senderName;
  nameInput.addEventListener('input', () => {
    state.senderName = nameInput.value;
    qs('#senderNameError').textContent = '';
    renderSideSummary();
    saveDraft();
  });

  const tiktokInput = qs('#tiktokId');
  tiktokInput.value = state.tiktok;
  tiktokInput.addEventListener('input', () => {
    state.tiktok = tiktokInput.value;
    resetTikTokCheck(); // đổi ID → xoá kết quả kiểm tra cũ và huỷ yêu cầu đang chạy
    qs('#tiktokError').textContent = '';
    updateTikTokPreview();
    renderSideSummary();
    saveDraft();
  });
  updateTikTokPreview();

  [nameInput, tiktokInput].forEach((input) => input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); handleNext(); }
  }));

  const textarea = qs('#letterContent');
  textarea.maxLength = LETTER_MAX_LENGTH;
  textarea.addEventListener('input', () => {
    if (textarea.value.length > LETTER_MAX_LENGTH) textarea.value = textarea.value.slice(0, LETTER_MAX_LENGTH); // chốt cứng, kể cả khi dán văn bản dài
    state.letters[state.activeLetter] = textarea.value;
    qs('#letterError').textContent = '';
    updateLetterMeta();
    renderLetterTabs();
    saveDraft();
  });

  qs('#tiktokCheckBtn').addEventListener('click', handleTikTokCheck);

  qs('#agreeTerms').addEventListener('change', (e) => {
    state.agreed = e.target.checked;
    if (state.agreed) qs('#confirmError').textContent = '';
  });
}

function updateTikTokPreview() {
  const hint = qs('#tiktokPreview');
  if (!state.tiktok.trim()) {
    hint.innerHTML = 'Ví dụ: <span class="mono">ten_nguoi_nhan</span> hoặc <span class="mono">ten.nguoi.nhan</span> (có thể dán cả link hồ sơ TikTok).';
    return;
  }
  const parsed = parseTikTokId(state.tiktok);
  hint.innerHTML = parsed.valid
    ? `Cáo sẽ gửi thư đến: <strong class="mono">@${escapeHtml(parsed.id)}</strong>`
    : `<span class="text-danger">${escapeHtml(parsed.message)}</span>`;
}

/* ===================== Kiểm tra tài khoản TikTok ===================== */

function setCheckButton(label, disabled) {
  const btn = qs('#tiktokCheckBtn');
  btn.disabled = disabled;
  btn.textContent = label;
}

/** Xoá kết quả cũ, huỷ yêu cầu đang chạy và vô hiệu hoá mọi phản hồi đến muộn */
function resetTikTokCheck() {
  checkSeq += 1;
  if (checkController) checkController.abort();
  checkController = null;
  isChecking = false;
  state.tiktokCheck = null;
  const box = qs('#tiktokResult');
  box.classList.add('is-hidden');
  box.replaceChildren();
  setCheckButton('Kiểm tra tài khoản TikTok', false);
}

async function handleTikTokCheck() {
  if (isChecking) return;

  const parsed = parseTikTokId(state.tiktok);
  if (!parsed.valid) {
    qs('#tiktokError').textContent = parsed.message;
    qs('#tiktokId').focus();
    return;
  }
  qs('#tiktokError').textContent = '';

  const now = Date.now();
  checkTimes = checkTimes.filter((t) => now - t < 60000);
  const last = checkTimes[checkTimes.length - 1];
  if (last && now - last < CHECK_COOLDOWN_MS) {
    showToast('Bạn thao tác hơi nhanh, đợi vài giây rồi thử lại nhé.', 'info');
    return;
  }
  if (checkTimes.length >= CHECK_MAX_PER_MINUTE) {
    showToast('Bạn đã kiểm tra nhiều lần trong một phút, vui lòng đợi một lúc.', 'info');
    return;
  }
  checkTimes.push(now);

  checkSeq += 1;
  const mySeq = checkSeq;
  if (checkController) checkController.abort();
  checkController = new AbortController();
  isChecking = true;
  state.tiktokCheck = null;

  renderTikTokLoading(parsed.id);
  setCheckButton('Đang kiểm tra...', true);

  let result;
  try {
    result = await checkTikTokAccount(parsed.id, { signal: checkController.signal });
  } catch (error) {
    return; // bị huỷ vì người dùng đổi ID → resetTikTokCheck đã dọn giao diện
  }

  // Bỏ qua phản hồi cũ: đã có yêu cầu mới hơn, hoặc ID trong ô nhập đã đổi
  if (mySeq !== checkSeq || parseTikTokId(state.tiktok).id !== parsed.id) return;

  isChecking = false;
  checkController = null;
  state.tiktokCheck = result;
  renderTikTokResult(result);
  setCheckButton(result.status === TIKTOK_CHECK_STATUS.UNKNOWN ? 'Thử lại' : 'Kiểm tra lại', false);
  renderSideSummary();
}

function renderTikTokLoading(username) {
  const box = qs('#tiktokResult');
  box.className = 'tiktok-result tiktok-result--loading';
  box.replaceChildren(
    createEl('span', { class: 'spinner' }),
    createEl('span', {}, `Đang hỏi TikTok về @${username}...`),
  );
}

/** Dựng kết quả bằng DOM API + textContent (không dùng innerHTML với dữ liệu từ máy chủ) */
function renderTikTokResult(result) {
  const box = qs('#tiktokResult');
  const checkedAt = formatDateTime(result.checkedAt);
  const profileLink = (label) => createEl('a', {
    class: 'tiktok-result__link', href: result.profileUrl, target: '_blank', rel: 'noopener noreferrer',
  }, label);

  if (result.status === TIKTOK_CHECK_STATUS.FOUND) {
    box.className = 'tiktok-result tiktok-result--found';

    const avatar = createEl('div', { class: 'tiktok-result__avatar', 'aria-hidden': 'true' });
    if (result.thumbnailUrl) {
      const img = createEl('img', { src: result.thumbnailUrl, alt: '', width: '56', height: '56', loading: 'lazy', referrerpolicy: 'no-referrer' });
      img.addEventListener('error', () => { img.remove(); avatar.textContent = '🦊'; });
      avatar.appendChild(img);
    } else {
      avatar.textContent = '🦊';
    }

    box.replaceChildren(
      createEl('p', { class: 'tiktok-result__title' }, '✓ Cáo tìm thấy hồ sơ TikTok này'),
      createEl('div', { class: 'tiktok-result__profile' }, [
        avatar,
        createEl('div', { class: 'tiktok-result__info' }, [
          createEl('strong', {}, result.authorName || `@${result.username}`),
          createEl('span', { class: 'mono' }, `@${result.username}`),
          profileLink('Mở hồ sơ TikTok ↗'),
        ]),
      ]),
      createEl('p', { class: 'tiktok-result__meta' }, `Kiểm tra lúc ${checkedAt}`),
      createEl('p', { class: 'tiktok-result__note' }, 'Lưu ý: tìm thấy hồ sơ chưa đảm bảo tài khoản đang công khai và cho phép nhận tin nhắn từ người lạ. Hãy đối chiếu đúng người bạn muốn gửi và tự kiểm tra các thiết lập đó.'),
    );
  } else if (result.status === TIKTOK_CHECK_STATUS.NOT_VERIFIED) {
    box.className = 'tiktok-result tiktok-result--warn';
    box.replaceChildren(
      createEl('p', { class: 'tiktok-result__title' }, 'Cáo chưa xác minh được hồ sơ này'),
      createEl('p', {}, 'TikTok không trả về dữ liệu hồ sơ. Có thể ID chưa đúng, hồ sơ ở chế độ riêng tư, bị hạn chế truy cập hoặc TikTok không cung cấp dữ liệu. Kết quả này chưa đủ để kết luận tài khoản có tồn tại hay không.'),
      createEl('p', {}, ['Hãy kiểm tra lại ID, hoặc ', profileLink('mở thử hồ sơ trên TikTok ↗'), ' để đối chiếu.']),
      createEl('p', { class: 'tiktok-result__meta' }, `Kiểm tra lúc ${checkedAt}`),
    );
  } else {
    box.className = 'tiktok-result tiktok-result--unknown';
    const retry = createEl('button', { type: 'button', class: 'btn btn--outline btn--sm' }, 'Thử lại');
    retry.addEventListener('click', handleTikTokCheck);
    box.replaceChildren(
      createEl('p', { class: 'tiktok-result__title' }, 'Chưa kiểm tra được lúc này'),
      createEl('p', {}, result.message || 'Có lỗi khi kết nối. Điều này không có nghĩa tài khoản không tồn tại.'),
      createEl('p', { class: 'tiktok-result__meta' }, `Lần thử lúc ${checkedAt}`),
      retry,
    );
  }
}

/** Dòng trạng thái kiểm tra hiển thị ở bước xác nhận (chỉ khi kết quả khớp ID hiện tại) */
function tikTokCheckSummary() {
  const check = state.tiktokCheck;
  const parsed = parseTikTokId(state.tiktok);
  if (!check || !parsed.valid || check.username !== parsed.id) return 'Chưa kiểm tra tài khoản TikTok';
  if (check.status === TIKTOK_CHECK_STATUS.FOUND) return `✓ Đã tìm thấy hồ sơ${check.authorName ? ` (${check.authorName})` : ''}`;
  if (check.status === TIKTOK_CHECK_STATUS.NOT_VERIFIED) return 'Chưa xác minh được hồ sơ — hãy kiểm tra kỹ ID';
  return 'Chưa kiểm tra được (lỗi kết nối) — hãy kiểm tra kỹ ID';
}

function renderLetterEditor() {
  syncLettersToPackage();
  renderLetterTabs();
  const textarea = qs('#letterContent');
  textarea.value = state.letters[state.activeLetter] || '';
  updateLetterMeta();
}

function renderLetterTabs() {
  const pkg = getPackageById(state.packageId);
  const tabs = qs('#letterTabs');
  const multi = pkg && pkg.letterCount > 1;
  tabs.classList.toggle('is-hidden', !multi);
  if (!multi) return;

  tabs.innerHTML = state.letters.map((text, i) => {
    const ok = validateLetterContent(text, LETTER_MIN_LENGTH, LETTER_MAX_LENGTH).valid;
    return `<button type="button" role="tab" class="letter-tab ${i === state.activeLetter ? 'is-active' : ''}" aria-selected="${i === state.activeLetter}" data-letter="${i}">
      Thư ${i + 1} ${ok ? '<span class="letter-tab__ok" aria-label="đã viết xong">✓</span>' : ''}
    </button>`;
  }).join('');

  qsa('[data-letter]', tabs).forEach((btn) => btn.addEventListener('click', () => {
    state.activeLetter = Number(btn.dataset.letter);
    renderLetterEditor();
    qs('#letterContent').focus();
  }));
}

function updateLetterMeta() {
  const pkg = getPackageById(state.packageId);
  const text = state.letters[state.activeLetter] || '';
  qs('#letterLabel').textContent = pkg && pkg.letterCount > 1 ? `Thư ${state.activeLetter + 1}/${pkg.letterCount}` : 'Thư của bạn';

  const counter = qs('#letterCounter');
  counter.textContent = `${text.length}/${LETTER_MAX_LENGTH}`;
  counter.classList.toggle('is-near', text.length >= LETTER_MAX_LENGTH * 0.9);

  const preview = qs('#letterPreview');
  preview.textContent = text.trim()
    ? composeLetterMessage({ content: text, senderMode: state.senderMode, senderName: state.senderName })
    : 'Nội dung thư của bạn sẽ hiện ở đây khi bạn bắt đầu viết...';
  preview.classList.toggle('is-empty', !text.trim());
}

/* ===================== Tóm tắt & bước xác nhận ===================== */

function modeLabel() {
  if (state.senderMode === SENDER_MODE.NAMED) return `Có tên${state.senderName.trim() ? `: ${state.senderName.trim()}` : ''}`;
  if (state.senderMode === SENDER_MODE.ANONYMOUS) return 'Ẩn danh';
  return '—';
}

function recipientLabel() {
  const parsed = parseTikTokId(state.tiktok);
  return parsed.valid ? `@${parsed.id}` : '—';
}

function renderSideSummary() {
  const pkg = getPackageById(state.packageId);
  qs('#sideSummary').innerHTML = `
    <div><dt>Gói</dt><dd>${pkg ? escapeHtml(pkg.name) : '—'}</dd></div>
    <div><dt>Hình thức</dt><dd>${escapeHtml(modeLabel())}</dd></div>
    <div><dt>Người nhận</dt><dd class="mono">${escapeHtml(recipientLabel())}</dd></div>
    <div><dt>Tổng cộng</dt><dd class="summary-total">${pkg ? fHtml(pkg.price) : '—'}</dd></div>
  `;
}

function renderConfirm() {
  const pkg = getPackageById(state.packageId);
  if (!pkg) return;

  const lettersHtml = state.letters.slice(0, pkg.letterCount).map((text, i) => `
    <div class="confirm-letter">
      <strong>${pkg.letterCount > 1 ? `Thư ${i + 1}` : 'Nội dung thư'}</strong>
      <p>${escapeHtml(text.trim())}</p>
    </div>
  `).join('');

  qs('#confirmSummary').innerHTML = `
    <div class="confirm-block"><div><span>Gói thư</span><strong>${escapeHtml(pkg.name)} · ${fHtml(pkg.price)}</strong></div><button type="button" class="link-btn" data-goto="1">Sửa</button></div>
    <div class="confirm-block"><div><span>Hình thức gửi</span><strong>${state.senderMode === SENDER_MODE.NAMED ? 'Gửi có tên' : 'Gửi ẩn danh'}</strong>
      ${state.senderMode === SENDER_MODE.NAMED ? `<span>Tên người gửi: <strong>${escapeHtml(state.senderName.trim())}</strong></span>` : ''}</div><button type="button" class="link-btn" data-goto="2">Sửa</button></div>
    <div class="confirm-block"><div><span>ID TikTok người nhận</span><strong class="mono">${escapeHtml(recipientLabel())}</strong><span>${escapeHtml(tikTokCheckSummary())}</span></div><button type="button" class="link-btn" data-goto="3">Sửa</button></div>
    <div class="confirm-block confirm-block--letters"><div>${lettersHtml}</div><button type="button" class="link-btn" data-goto="4">Sửa</button></div>
    <div class="confirm-total"><span>Tổng tiền</span><strong>${fHtml(pkg.price)}</strong></div>
  `;
  qsa('#confirmSummary [data-goto]').forEach((btn) => btn.addEventListener('click', () => goToStep(Number(btn.dataset.goto))));

  qs('#loginNotice').classList.toggle('is-hidden', !!currentUser);
  qs('#agreeTerms').checked = state.agreed;
  renderPaymentMethods();
  loadBalance();
}

/* ===================== Phương thức thanh toán (bước 5) ===================== */

/** Đọc số dư ví từ Firestore (Rules chỉ cho chủ ví đọc). Lỗi → không giả định số dư, khoá lựa chọn ví. */
async function loadBalance() {
  if (!currentUser || balanceLoading) return;
  balanceLoading = true;
  renderPaymentMethods();
  try {
    walletBalance = await getBalance(currentUser.id);
  } catch (error) {
    walletBalance = null;
  }
  balanceLoading = false;
  renderPaymentMethods();
  renderNav();
}

function renderPaymentMethods() {
  const pkg = getPackageById(state.packageId);
  const box = qs('#paymentMethods');
  if (!pkg || !box) return;

  const enough = typeof walletBalance === 'number' && walletBalance >= pkg.price;
  if (state.paymentMethod === PAYMENT_METHOD.WALLET && !enough) state.paymentMethod = PAYMENT_METHOD.BANK; // không bao giờ chọn ví khi không đủ F

  let walletInfo;
  if (!currentUser) walletInfo = '<span>Đăng nhập để dùng ví F.</span>';
  else if (balanceLoading) walletInfo = '<span>Đang tải số dư...</span>';
  else if (walletBalance === null) walletInfo = '<span>Không đọc được số dư ví lúc này.</span> <button type="button" class="link-btn" id="reloadBalanceBtn">Thử lại</button>';
  else walletInfo = `<span>Số dư: <strong>${fHtml(walletBalance)}</strong> · Giá đơn: <strong>${fHtml(pkg.price)}</strong></span>`;

  const shortage = currentUser && !balanceLoading && typeof walletBalance === 'number' && !enough
    ? `<p class="pay-card__short">Số dư không đủ, bạn còn thiếu <strong>${fHtml(pkg.price - walletBalance)}</strong>. <a href="${ROUTES.WALLET}#nap" target="_blank" rel="noopener">Nạp thêm F</a> (mở tab mới, thư của bạn vẫn được giữ).</p>`
    : '';

  const bankSelected = state.paymentMethod === PAYMENT_METHOD.BANK;
  box.innerHTML = `
    <div class="pay-card ${bankSelected ? 'is-selected' : ''}">
      <button type="button" class="pay-card__main" role="radio" aria-checked="${bankSelected}" data-method="${PAYMENT_METHOD.BANK}">
        <span class="pay-card__icon" aria-hidden="true">🏦</span>
        <span class="pay-card__text"><strong>Chuyển khoản ngân hàng</strong><small>Quét VietQR hoặc bấm “Chuyển khoản nhanh”. Cáo xác nhận khi nhận được tiền.</small></span>
      </button>
    </div>
    <div class="pay-card ${!bankSelected ? 'is-selected' : ''} ${enough ? '' : 'is-disabled'}">
      <button type="button" class="pay-card__main" role="radio" aria-checked="${!bankSelected}" data-method="${PAYMENT_METHOD.WALLET}" ${enough ? '' : 'disabled'}>
        <span class="pay-card__icon" aria-hidden="true">🦊</span>
        <span class="pay-card__text"><strong>Ví F</strong><small class="pay-card__wallet">${walletInfo}</small></span>
      </button>
      ${shortage}
    </div>
  `;

  qsa('[data-method]', box).forEach((btn) => btn.addEventListener('click', () => {
    if (btn.disabled) return;
    state.paymentMethod = btn.dataset.method;
    renderPaymentMethods();
    renderNav();
    saveDraft();
  }));
  qs('#reloadBalanceBtn')?.addEventListener('click', loadBalance);
}

/* ===================== Tạo đơn ===================== */

async function submitOrder() {
  // Kiểm tra lại toàn bộ các bước trước khi gửi lên máy chủ
  for (let step = 1; step <= TOTAL_STEPS; step += 1) {
    const check = validateStep(step);
    if (!check.valid) {
      goToStep(step);
      showStepError(step, check.message);
      return;
    }
  }

  if (!currentUser) {
    saveDraft();
    guard?.allowNavigation(); // chuyển sang đăng nhập nhưng GIỮ bản nháp
    window.location.href = `${ROUTES.LOGIN}?redirect=${encodeURIComponent(ROUTES.SEND_LETTER)}`;
    return;
  }

  isSubmitting = true;
  const nextBtn = qs('#nextBtn');
  nextBtn.disabled = true;
  nextBtn.innerHTML = '<span class="spinner spinner--light"></span> Đang xử lý...';
  qs('#prevBtn').disabled = true;

  // Mã yêu cầu cố định cho tới khi biết chắc kết quả: bấm lặp / thử lại sau lỗi mạng không thể tạo hoặc trừ F hai lần
  if (!state.requestId) state.requestId = newRequestId();
  saveDraft();

  const pkg = getPackageById(state.packageId);
  const result = await createOrder({
    paymentMethod: state.paymentMethod,
    requestId: state.requestId,
    packageId: pkg.id,
    senderMode: state.senderMode,
    senderName: state.senderName,
    recipientTiktok: state.tiktok,
    letters: state.letters.slice(0, pkg.letterCount),
    // Chỉ đính kèm nếu kết quả khớp đúng ID đang đặt; orderService sẽ làm sạch lại
    tiktokCheck: state.tiktokCheck,
  });

  isSubmitting = false;
  qs('#prevBtn').disabled = false;
  renderNav();

  if (!result.success) {
    let message = result.message;
    if (DEFINITE_FAILURES.includes(result.code)) state.requestId = null; // biết chắc đơn chưa được tạo → lần sau dùng mã mới
    if (result.code === 'INSUFFICIENT_FUNDS') {
      if (typeof result.balance === 'number') walletBalance = result.balance;
      renderPaymentMethods();
    }
    if (result.code === 'IDEMPOTENCY_MISMATCH') message = 'Yêu cầu trước đó chưa rõ kết quả. Hãy kiểm tra mục "Đơn của tôi" và "Ví của tôi" trước khi đặt lại để tránh bị trừ F hai lần.';
    if (['NETWORK', 'BAD_RESPONSE', 'INTERNAL', 'FUNCTION_UNAVAILABLE'].includes(result.code)) {
      message += ' Nếu bạn đã bấm thanh toán, hãy kiểm tra "Đơn của tôi" trước; bấm lại ở đây sẽ không bị trừ F hai lần.';
    }
    showToast(message, 'error', 6000);
    qs('#confirmError').textContent = message;
    renderNav();
    saveDraft();
    return;
  }

  orderDone = true;
  clearDraft();
  guard?.release();
  renderSuccess(result.order, { balance: result.balance });
}

function renderSuccess(order, { balance } = {}) {
  qs('#wizardView').classList.add('is-hidden');
  const view = qs('#successView');
  view.classList.remove('is-hidden');
  const isWallet = order.paymentMethod === PAYMENT_METHOD.WALLET;

  qs('#successTitle').textContent = isWallet ? 'Đã thanh toán bằng ví F!' : 'Đã ghi nhận đơn thư của bạn!';
  qs('#successLead').textContent = isWallet
    ? 'Cáo đã nhận thư của bạn và sẽ xử lý sớm nhất có thể. Bạn có thể hủy đơn (hoàn F) cho tới khi Cáo bắt đầu xử lý.'
    : 'Còn một bước nữa: hãy chuyển khoản bên dưới. Cáo chỉ bắt đầu xử lý sau khi xác nhận đã nhận tiền.';

  qs('#successSummary').innerHTML = `
    <div><dt>Mã đơn</dt><dd class="mono">${escapeHtml(order.code)}</dd></div>
    <div><dt>Gói thư</dt><dd>${escapeHtml(order.packageName)}</dd></div>
    <div><dt>Tài khoản TikTok nhận</dt><dd class="mono">@${escapeHtml(order.recipientTiktok)}</dd></div>
    <div><dt>Trạng thái</dt><dd><span class="badge badge--${order.status}" id="successStatusBadge">${ORDER_STATUS_LABEL[order.status]}</span></dd></div>
    <div><dt>Thời gian đặt</dt><dd>${formatDateTime(order.createdAt)}</dd></div>
    <div><dt>Thanh toán</dt><dd>${isWallet ? 'Ví F' : 'Chuyển khoản ngân hàng'}</dd></div>
    <div><dt>Tổng tiền</dt><dd class="summary-total">${fHtml(order.totalPrice)}</dd></div>
    ${isWallet && typeof balance === 'number' ? `<div><dt>Số dư ví còn lại</dt><dd>${fHtml(balance)}</dd></div>` : ''}
  `;
  if (isWallet) {
    qs('#successPayment').innerHTML = `<p class="form-hint">Đã trừ ${escapeHtml(formatF(order.totalPrice))} khỏi ví. Xem lịch sử tại <a href="${ROUTES.WALLET}">Ví của tôi</a>.</p>`;
  } else {
    renderPaymentBox('#successPayment', order);
    // Đơn chuyển khoản: đếm ngược hạn thanh toán, tự cập nhật nếu bị hủy do quá hạn hoặc admin đã xác nhận
    stopSuccessWatch?.();
    stopSuccessWatch = startPaymentWatch(qs('#successTimer'), order, { onChange: (updated) => handleOrderChanged(updated) });
  }

  showToast(isWallet ? 'Thanh toán bằng ví F thành công!' : 'Đã ghi nhận đơn thư của bạn!', 'success');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

let stopSuccessWatch = null;

/** Đơn chuyển khoản đổi trạng thái khi khách còn đang ở màn hình thanh toán */
function handleOrderChanged(order) {
  const badge = qs('#successStatusBadge');
  badge.className = `badge badge--${order.status}`;
  badge.textContent = ORDER_STATUS_LABEL[order.status] || order.status;

  if (order.status === ORDER_STATUS.CANCELLED && order.cancelledBy === 'system') {
    qs('#successTitle').textContent = 'Đơn đã hết hạn thanh toán';
    qs('#successLead').textContent = `Đơn ${order.code} đã tự động hủy vì quá ${ORDER_PAYMENT_TIMEOUT_MINUTES} phút chưa thanh toán.`;
    const support = getSupportLink();
    const box = qs('#successPayment');
    box.replaceChildren();
    const note = document.createElement('p');
    note.className = 'notice notice--info';
    note.textContent = 'Nếu bạn đã chuyển khoản trước khi đơn bị hủy, vui lòng liên hệ Cáo Đưa Thư để được hỗ trợ. Nếu chưa, bạn có thể gửi thư mới bất cứ lúc nào.';
    const contact = document.createElement('a');
    contact.className = 'btn btn--outline btn--block';
    contact.href = support.href; contact.textContent = support.label;
    if (support.external) { contact.target = '_blank'; contact.rel = 'noopener noreferrer'; }
    const again = document.createElement('a');
    again.className = 'btn btn--primary btn--block'; again.style.marginTop = '8px';
    again.href = ROUTES.SEND_LETTER; again.textContent = 'Gửi thư mới';
    box.append(note, contact, again);
    showToast('Đơn đã tự động hủy vì quá hạn thanh toán.', 'info', 5000);
  } else if (order.status !== ORDER_STATUS.PENDING_PAYMENT) {
    qs('#successTitle').textContent = order.status === ORDER_STATUS.CANCELLED ? 'Đơn đã được hủy' : 'Cáo đã xác nhận thanh toán!';
    qs('#successLead').textContent = order.status === ORDER_STATUS.CANCELLED ? '' : 'Cáo đã nhận được tiền và sẽ xử lý thư của bạn sớm nhất có thể.';
    qs('#successPayment').replaceChildren();
    if (order.status !== ORDER_STATUS.CANCELLED) showToast('Cáo đã xác nhận thanh toán đơn của bạn!', 'success', 5000);
  }
}

document.addEventListener('DOMContentLoaded', init);
