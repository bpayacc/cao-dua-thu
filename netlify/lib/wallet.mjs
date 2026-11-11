/**
 * netlify/lib/wallet.mjs — yêu cầu nạp F và xác nhận/từ chối nạp (admin), chạy phía máy chủ.
 *
 * Số dư CHỈ thay đổi tại đây và trong orders.mjs, luôn kèm một dòng sổ cái (wallets/{uid}/ledger)
 * trong cùng transaction. Hệ thống KHÔNG tự động đối soát ngân hàng: F chỉ được cộng khi
 * một quản trị viên bấm xác nhận sau khi tự kiểm tra tiền đã về tài khoản.
 */
import {
  WALLET_TOPUP_MIN, WALLET_TOPUP_MAX, WALLET_MAX_PENDING_TOPUPS, F_PER_VND, TOPUP_STATUS, LEDGER_TYPE,
} from '../../config/constants.js';
import { ApiError } from './errors.mjs';
import { dateKey, makeCode, serialize, REQUEST_ID_RE } from './util.mjs';

export const topupTransferContent = (code) => String(code).replace(/-/g, '');

export async function createTopup(db, user, input, now = new Date()) {
  const amount = input && input.amount;
  if (!Number.isInteger(amount) || amount < WALLET_TOPUP_MIN || amount > WALLET_TOPUP_MAX) {
    throw new ApiError(400, 'INVALID_INPUT', `Số tiền nạp phải là số nguyên từ ${WALLET_TOPUP_MIN} đến ${WALLET_TOPUP_MAX} F.`);
  }
  if (typeof input.requestId !== 'string' || !REQUEST_ID_RE.test(input.requestId)) {
    throw new ApiError(400, 'INVALID_INPUT', 'Thiếu mã yêu cầu hợp lệ.');
  }

  const topupRef = db.collection('topups').doc(`${user.uid}_${input.requestId}`);
  const counterRef = db.collection('counters').doc(`topups-${dateKey(now)}`);
  const profileRef = db.collection('users').doc(user.uid);

  // Giới hạn số yêu cầu đang chờ (chặn spam) — kiểm tra ngoài transaction, chỉ là lớp giảm lạm dụng
  const existing = await topupRef.get();
  if (!existing.exists) {
    const pending = await db.collection('topups').where('userId', '==', user.uid).where('status', '==', TOPUP_STATUS.PENDING).limit(WALLET_MAX_PENDING_TOPUPS).get();
    if (pending.size >= WALLET_MAX_PENDING_TOPUPS) {
      throw new ApiError(429, 'TOO_MANY_PENDING', `Bạn đang có ${WALLET_MAX_PENDING_TOPUPS} yêu cầu nạp chờ xác nhận. Vui lòng đợi Cáo xử lý trước khi tạo thêm.`);
    }
  }

  return db.runTransaction(async (tx) => {
    const topupSnap = await tx.get(topupRef);
    if (topupSnap.exists) {
      const t = topupSnap.data();
      if (t.userId !== user.uid || t.amount !== amount) {
        throw new ApiError(409, 'IDEMPOTENCY_MISMATCH', 'Yêu cầu trùng mã nhưng khác nội dung. Vui lòng tải lại trang và thử lại.');
      }
      return { topup: serialize(topupSnap.id, t), reused: true };
    }
    const counterSnap = await tx.get(counterRef);
    const profileSnap = await tx.get(profileRef);
    const seq = (counterSnap.exists ? counterSnap.data().count : 0) + 1;

    const topup = {
      code: makeCode('NAP', dateKey(now), seq),
      userId: user.uid,
      userName: (profileSnap.exists && profileSnap.data().fullName) || user.name || '',
      userEmail: user.email || '',
      amount, // VNĐ khách chuyển
      fAmount: amount * F_PER_VND, // F nhận được khi admin xác nhận
      status: TOPUP_STATUS.PENDING,
      rejectReason: '',
      requestId: input.requestId,
      createdAt: now,
      updatedAt: now,
    };
    tx.create(topupRef, topup);
    tx.set(counterRef, { count: seq });
    return { topup: serialize(topupRef.id, topup), reused: false };
  });
}

/**
 * Admin xác nhận / từ chối yêu cầu nạp. Người gọi đã được kiểm tra là admin ở tầng handler.
 * Xác nhận: cộng F + ghi sổ cái + đổi trạng thái trong MỘT transaction; id sổ cái `topup_<id>` đảm bảo chỉ cộng một lần.
 */
export async function decideTopup(db, admin, input, now = new Date()) {
  const topupId = input && typeof input.topupId === 'string' ? input.topupId : '';
  if (!topupId || topupId.length > 200 || topupId.includes('/')) throw new ApiError(400, 'INVALID_INPUT', 'Mã giao dịch nạp không hợp lệ.');
  const action = input.action;
  if (!['confirm', 'reject'].includes(action)) throw new ApiError(400, 'INVALID_INPUT', 'Hành động không hợp lệ.');
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (action === 'reject' && (reason.length < 3 || reason.length > 300)) {
    throw new ApiError(400, 'INVALID_INPUT', 'Vui lòng nhập lý do từ chối (3–300 ký tự).');
  }

  const topupRef = db.collection('topups').doc(topupId);

  return db.runTransaction(async (tx) => {
    const topupSnap = await tx.get(topupRef);
    if (!topupSnap.exists) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy giao dịch nạp.');
    const topup = topupSnap.data();

    if (action === 'reject') {
      if (topup.status === TOPUP_STATUS.REJECTED) return { topup: serialize(topupSnap.id, topup), alreadyDone: true };
      if (topup.status === TOPUP_STATUS.CONFIRMED) throw new ApiError(409, 'ALREADY_CONFIRMED', 'Giao dịch đã được xác nhận và đã cộng F, không thể từ chối.');
      const patch = { status: TOPUP_STATUS.REJECTED, rejectReason: reason, rejectedBy: admin.uid, rejectedByEmail: admin.email || '', rejectedAt: now, updatedAt: now };
      tx.update(topupRef, patch);
      return { topup: serialize(topupSnap.id, { ...topup, ...patch }) };
    }

    // ---- confirm ----
    if (topup.status === TOPUP_STATUS.CONFIRMED) return { topup: serialize(topupSnap.id, topup), alreadyDone: true };
    if (topup.status === TOPUP_STATUS.REJECTED) throw new ApiError(409, 'ALREADY_REJECTED', 'Giao dịch đã bị từ chối. Hãy nhờ khách tạo yêu cầu nạp mới.');

    const walletRef = db.collection('wallets').doc(topup.userId);
    const ledgerRef = walletRef.collection('ledger').doc(`topup_${topupId}`);
    const walletSnap = await tx.get(walletRef);
    const ledgerSnap = await tx.get(ledgerRef);

    const credit = Number(topup.fAmount);
    if (!Number.isInteger(credit) || credit <= 0) throw new ApiError(500, 'INTERNAL', 'Dữ liệu giao dịch nạp không hợp lệ.');
    const balance = walletSnap.exists ? Number(walletSnap.data().balance) || 0 : 0;
    const alreadyCredited = ledgerSnap.exists; // phòng thủ: không cộng lần hai
    const newBalance = alreadyCredited ? balance : balance + credit;

    const patch = { status: TOPUP_STATUS.CONFIRMED, confirmedBy: admin.uid, confirmedByEmail: admin.email || '', confirmedAt: now, updatedAt: now };
    tx.update(topupRef, patch);
    if (!alreadyCredited) {
      tx.create(ledgerRef, {
        type: LEDGER_TYPE.TOPUP, delta: credit, amount: credit, balanceAfter: newBalance,
        refType: 'topup', refId: topupId, refCode: topup.code,
        note: `Nạp F ${topup.code} — admin ${admin.email || admin.uid} xác nhận đã nhận ${topup.amount} VNĐ`,
        actor: admin.uid, actorRole: 'admin', createdAt: now,
      });
      tx.set(walletRef, {
        balance: newBalance, updatedAt: now,
        createdAt: walletSnap.exists ? walletSnap.data().createdAt || now : now,
      });
    }
    return { topup: serialize(topupSnap.id, { ...topup, ...patch }), balance: newBalance };
  });
}
