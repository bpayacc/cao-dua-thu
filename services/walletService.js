/**
 * services/walletService.js
 * Ví F. ĐỌC (số dư, sổ cái, yêu cầu nạp) trực tiếp từ Firestore — Rules chỉ cho chủ ví / admin đọc.
 * GHI (tạo yêu cầu nạp, xác nhận / từ chối nạp) chỉ qua Netlify Functions; số dư KHÔNG BAO GIỜ được
 * sửa từ trình duyệt. Hệ thống không tự đối soát ngân hàng: F chỉ được cộng khi admin xác nhận.
 */
import { db } from '../config/firebaseClient.js';
import {
  collection, doc, getDoc, getDocs, query, where, orderBy,
} from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js';
import { API, WALLET_TOPUP_MIN, WALLET_TOPUP_MAX } from '../config/constants.js';
import { callFunction } from './apiClient.js';

const TIME_FIELDS = ['createdAt', 'updatedAt', 'confirmedAt', 'rejectedAt'];
const toIso = (v) => (v && typeof v.toDate === 'function' ? v.toDate().toISOString() : v || null);
function normalize(id, data) {
  const out = { id, ...data };
  TIME_FIELDS.forEach((k) => { out[k] = toIso(data[k]); });
  return out;
}

/** Số dư F hiện tại (0 nếu chưa có ví). Ném lỗi nếu không đọc được — không giả định số dư. */
export async function getBalance(uid) {
  const snap = await getDoc(doc(db, 'wallets', uid));
  return snap.exists() ? Number(snap.data().balance) || 0 : 0;
}

/** Sổ cái ví của một người dùng, mới nhất trước */
export async function getLedger(uid) {
  const snap = await getDocs(query(collection(db, 'wallets', uid, 'ledger'), orderBy('createdAt', 'desc')));
  return snap.docs.map((d) => normalize(d.id, d.data()));
}

/** Lịch sử yêu cầu nạp của một người dùng, mới nhất trước */
export async function getTopupsByUser(uid) {
  const snap = await getDocs(query(collection(db, 'topups'), where('userId', '==', uid)));
  return snap.docs.map((d) => normalize(d.id, d.data())).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

/** Admin: toàn bộ yêu cầu nạp */
export async function getAllTopups() {
  const snap = await getDocs(query(collection(db, 'topups'), orderBy('createdAt', 'desc')));
  return snap.docs.map((d) => normalize(d.id, d.data()));
}

/** Admin: tìm tài khoản theo email (để xem ví) */
export async function findUserByEmail(email) {
  const snap = await getDocs(query(collection(db, 'users'), where('email', '==', String(email).trim().toLowerCase())));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function getUserById(uid) {
  const snap = await getDoc(doc(db, 'users', uid));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export function validateTopupAmount(amount) {
  if (!Number.isInteger(amount) || amount < WALLET_TOPUP_MIN || amount > WALLET_TOPUP_MAX) {
    return `Số F nạp phải là số nguyên từ ${WALLET_TOPUP_MIN.toLocaleString('vi-VN')} đến ${WALLET_TOPUP_MAX.toLocaleString('vi-VN')}.`;
  }
  return '';
}

/** Tạo yêu cầu nạp (trạng thái Chờ xác nhận — chưa cộng F) */
export async function createTopup(amount, requestId) {
  const problem = validateTopupAmount(amount);
  if (problem) return { success: false, code: 'INVALID_INPUT', message: problem };
  const res = await callFunction(API.CREATE_TOPUP, { amount, requestId });
  return res.ok ? { success: true, topup: res.topup, reused: !!res.reused } : { success: false, code: res.code, message: res.message };
}

/** Admin: xác nhận đã nhận tiền (cộng F) hoặc từ chối (bắt buộc lý do) */
export async function decideTopup(topupId, action, reason = '') {
  const res = await callFunction(API.ADMIN_TOPUP, { topupId, action, reason });
  return res.ok ? { success: true, topup: res.topup, balance: res.balance, alreadyDone: !!res.alreadyDone } : { success: false, code: res.code, message: res.message };
}
