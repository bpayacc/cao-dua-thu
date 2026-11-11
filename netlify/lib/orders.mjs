/**
 * netlify/lib/orders.mjs — tạo đơn (kèm thanh toán bằng ví F) và huỷ đơn (kèm hoàn F), chạy phía máy chủ.
 *
 * Nguyên tắc an toàn:
 *  - Giá luôn lấy từ config/constants.js (LETTER_PACKAGES), KHÔNG tin giá từ trình duyệt.
 *  - Trừ F / hoàn F / đổi trạng thái đơn nằm CÙNG MỘT transaction → không bao giờ lệch nhau.
 *  - Idempotent: id đơn = `${uid}_${requestId}`; id sổ cái = `pay_<orderId>` / `refund_<orderId>`.
 *    Gửi lặp hoặc gửi đồng thời không thể trừ / hoàn hai lần.
 */
import {
  LETTER_PACKAGES, LETTER_MIN_LENGTH, LETTER_MAX_LENGTH, SENDER_NAME_MAX_LENGTH, SENDER_MODE,
  ORDER_STATUS, PAYMENT_METHOD, PAYMENT_STATUS, REFUND_STATUS, LEDGER_TYPE, ORDER_PAYMENT_TIMEOUT_MINUTES,
} from '../../config/constants.js';
import { parseTikTokId, validateLetterContent, normalizeLetterForCompare } from '../../utils/validators.js';
import { ApiError } from './errors.mjs';
import { dateKey, makeCode, sha256, serialize, toDate, REQUEST_ID_RE } from './util.mjs';

const TIMEOUT_MS = ORDER_PAYMENT_TIMEOUT_MINUTES * 60 * 1000;

const TIKTOK_CHECK_STATUSES = ['FOUND', 'NOT_VERIFIED', 'UNKNOWN'];

function sanitizeTikTokCheck(check, username) {
  if (!check || typeof check !== 'object') return null;
  if (check.username !== username || !TIKTOK_CHECK_STATUSES.includes(check.status)) return null;
  const checkedAt = new Date(check.checkedAt);
  if (Number.isNaN(checkedAt.getTime())) return null;
  return {
    status: check.status,
    username,
    authorName: check.status === 'FOUND' && typeof check.authorName === 'string' ? check.authorName.slice(0, 100) : '',
    profileUrl: `https://www.tiktok.com/@${username}`,
    checkedAt: checkedAt.toISOString(),
    source: 'tiktok-oembed (do trình duyệt khách gửi lên, chưa xác thực)',
  };
}

const bad = (message) => new ApiError(400, 'INVALID_INPUT', message);

/** Kiểm tra & chuẩn hoá toàn bộ dữ liệu đơn từ trình duyệt. Ném ApiError(400) nếu sai. */
export function validateOrderInput(input) {
  if (!input || typeof input !== 'object') throw bad('Dữ liệu đơn không hợp lệ.');

  const pkg = LETTER_PACKAGES.find((p) => p.id === input.packageId);
  if (!pkg) throw bad('Gói thư không hợp lệ.');

  if (![SENDER_MODE.ANONYMOUS, SENDER_MODE.NAMED].includes(input.senderMode)) throw bad('Hình thức gửi không hợp lệ.');
  const senderName = input.senderMode === SENDER_MODE.NAMED ? String(input.senderName || '').trim() : '';
  if (input.senderMode === SENDER_MODE.NAMED && (!senderName || senderName.length > SENDER_NAME_MAX_LENGTH)) {
    throw bad(`Tên người gửi cần từ 1 đến ${SENDER_NAME_MAX_LENGTH} ký tự.`);
  }

  const tiktok = parseTikTokId(input.recipientTiktok);
  if (!tiktok.valid) throw bad(tiktok.message);

  if (!Array.isArray(input.letters) || input.letters.length !== pkg.letterCount) {
    throw bad(`${pkg.name} cần đúng ${pkg.letterCount} bức thư.`);
  }
  input.letters.forEach((text, i) => {
    if (typeof text !== 'string') throw bad(`Thư ${i + 1} không hợp lệ.`);
    const check = validateLetterContent(text, LETTER_MIN_LENGTH, LETTER_MAX_LENGTH, `Thư ${i + 1}`);
    if (!check.valid) throw bad(check.message);
  });
  const letters = input.letters.map((t) => t.trim());
  if (new Set(letters.map(normalizeLetterForCompare)).size !== letters.length) {
    throw bad('Mỗi bức thư cần có nội dung riêng, không dùng chung một nội dung.');
  }

  if (![PAYMENT_METHOD.BANK, PAYMENT_METHOD.WALLET].includes(input.paymentMethod)) throw bad('Phương thức thanh toán không hợp lệ.');
  if (typeof input.requestId !== 'string' || !REQUEST_ID_RE.test(input.requestId)) throw bad('Thiếu mã yêu cầu hợp lệ.');

  return {
    pkg, senderMode: input.senderMode, senderName, recipient: tiktok.id, letters,
    paymentMethod: input.paymentMethod, requestId: input.requestId,
    tiktokCheck: sanitizeTikTokCheck(input.tiktokCheck, tiktok.id),
  };
}

/**
 * Tạo đơn. Với paymentMethod = "wallet": trừ F + ghi sổ cái + đơn ở trạng thái "Đã thanh toán" trong cùng transaction.
 * Với "bank": đơn ở "Chờ thanh toán", admin đối soát thủ công như trước.
 */
export async function createOrder(db, user, input, now = new Date()) {
  const v = validateOrderInput(input);
  const price = v.pkg.price; // luôn lấy từ cấu hình đáng tin cậy
  const payloadHash = sha256([v.pkg.id, v.senderMode, v.senderName, v.recipient, v.letters, v.paymentMethod]);

  const orderRef = db.collection('orders').doc(`${user.uid}_${v.requestId}`);
  const counterRef = db.collection('counters').doc(`orders-${dateKey(now)}`);
  const walletRef = db.collection('wallets').doc(user.uid);
  const ledgerRef = walletRef.collection('ledger').doc(`pay_${orderRef.id}`);
  const profileRef = db.collection('users').doc(user.uid);
  const isWallet = v.paymentMethod === PAYMENT_METHOD.WALLET;

  return db.runTransaction(async (tx) => {
    // --- ĐỌC (mọi lần đọc phải trước mọi lần ghi) ---
    const orderSnap = await tx.get(orderRef);
    if (orderSnap.exists) {
      const existing = orderSnap.data();
      if (existing.customerId !== user.uid || existing.payloadHash !== payloadHash) {
        throw new ApiError(409, 'IDEMPOTENCY_MISMATCH', 'Yêu cầu trùng mã nhưng khác nội dung. Vui lòng tải lại trang và thử lại.');
      }
      return { order: serialize(orderSnap.id, existing), reused: true };
    }
    const counterSnap = await tx.get(counterRef);
    const profileSnap = await tx.get(profileRef);
    const walletSnap = isWallet ? await tx.get(walletRef) : null;

    const balance = walletSnap && walletSnap.exists ? Number(walletSnap.data().balance) || 0 : 0;
    if (isWallet && balance < price) {
      throw new ApiError(402, 'INSUFFICIENT_FUNDS', `Số dư không đủ. Bạn còn thiếu ${price - balance} F.`, { balance, price, shortfall: price - balance });
    }

    // --- GHI ---
    const seq = (counterSnap.exists ? counterSnap.data().count : 0) + 1;
    const order = {
      code: makeCode('CDT', dateKey(now), seq),
      customerId: user.uid,
      customerName: (profileSnap.exists && profileSnap.data().fullName) || user.name || '',
      customerEmail: user.email || '',
      packageId: v.pkg.id,
      packageName: v.pkg.name,
      letterCount: v.pkg.letterCount,
      senderMode: v.senderMode,
      senderName: v.senderName,
      recipientTiktok: v.recipient,
      tiktokCheck: v.tiktokCheck,
      letters: v.letters,
      totalPrice: price,
      status: isWallet ? ORDER_STATUS.PAID : ORDER_STATUS.PENDING_PAYMENT,
      statusNote: '',
      paymentMethod: v.paymentMethod,
      paymentStatus: isWallet ? PAYMENT_STATUS.PAID : PAYMENT_STATUS.UNPAID,
      walletAmount: isWallet ? price : 0,
      paidAt: isWallet ? now : null,
      // Đơn chuyển khoản phải thanh toán trước hạn này, quá hạn máy chủ tự hủy (đơn ví F không có hạn)
      expiresAt: isWallet ? null : new Date(now.getTime() + TIMEOUT_MS),
      refundStatus: REFUND_STATUS.NONE,
      requestId: v.requestId,
      payloadHash,
      createdAt: now,
      updatedAt: now,
    };
    tx.create(orderRef, order);
    tx.set(counterRef, { count: seq });

    let newBalance = null;
    if (isWallet) {
      newBalance = balance - price;
      tx.create(ledgerRef, {
        type: LEDGER_TYPE.PAYMENT, delta: -price, amount: price, balanceAfter: newBalance,
        refType: 'order', refId: orderRef.id, refCode: order.code,
        note: `Thanh toán đơn ${order.code} (${v.pkg.name})`,
        actor: user.uid, actorRole: 'customer', createdAt: now,
      });
      tx.set(walletRef, {
        balance: newBalance, updatedAt: now,
        createdAt: walletSnap.exists ? walletSnap.data().createdAt || now : now,
      });
    }
    return { order: serialize(orderRef.id, order), reused: false, balance: newBalance };
  });
}

/**
 * Khách huỷ đơn. Được phép khi đơn CHƯA được admin xác nhận:
 *   - "Chờ thanh toán" (mọi phương thức), hoặc
 *   - "Đã thanh toán" bằng ví F mà admin chưa chuyển sang "Đang xử lý".
 * Đơn ví F: hoàn đúng số F đã trừ (1 lần duy nhất) cùng transaction với việc huỷ.
 * Đơn chuyển khoản: chỉ huỷ + đánh dấu cần hỗ trợ hoàn tiền thủ công, KHÔNG cộng F.
 */
export async function cancelOrder(db, user, input, now = new Date()) {
  const orderId = input && typeof input.orderId === 'string' ? input.orderId : '';
  if (!orderId || orderId.length > 200 || orderId.includes('/')) throw bad('Mã đơn không hợp lệ.');

  const orderRef = db.collection('orders').doc(orderId);
  const walletRef = db.collection('wallets').doc(user.uid);
  const refundRef = walletRef.collection('ledger').doc(`refund_${orderId}`);

  return db.runTransaction(async (tx) => {
    const orderSnap = await tx.get(orderRef);
    if (!orderSnap.exists || orderSnap.data().customerId !== user.uid) {
      throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy đơn hàng.');
    }
    const order = orderSnap.data();
    const method = order.paymentMethod || PAYMENT_METHOD.BANK; // đơn cũ chưa có trường này = chuyển khoản

    if (order.status === ORDER_STATUS.CANCELLED) {
      return { order: serialize(orderSnap.id, order), alreadyCancelled: true, refundedF: order.refundStatus === REFUND_STATUS.REFUNDED_F ? order.walletAmount : 0 };
    }

    const cancellable = order.status === ORDER_STATUS.PENDING_PAYMENT
      || (order.status === ORDER_STATUS.PAID && method === PAYMENT_METHOD.WALLET);
    if (!cancellable) {
      const reason = order.status === ORDER_STATUS.SENT ? 'Đơn đã được gửi thư nên không thể hủy.'
        : order.status === ORDER_STATUS.FAILED ? 'Đơn này đã được Cáo xử lý (không thể gửi) nên không thể hủy.'
          : 'Đơn đã được Cáo xác nhận và đang xử lý nên không thể hủy.';
      throw new ApiError(409, 'NOT_CANCELLABLE', reason);
    }

    const mustRefund = method === PAYMENT_METHOD.WALLET && order.paymentStatus === PAYMENT_STATUS.PAID && Number(order.walletAmount) > 0;
    let walletSnap = null; let refundSnap = null;
    if (mustRefund) {
      walletSnap = await tx.get(walletRef);
      refundSnap = await tx.get(refundRef);
    }

    if (!mustRefund) {
      const patch = {
        status: ORDER_STATUS.CANCELLED, statusNote: 'Khách hàng đã hủy đơn', cancelledAt: now, cancelledBy: 'customer', updatedAt: now,
        refundStatus: method === PAYMENT_METHOD.BANK ? REFUND_STATUS.BANK_MANUAL : REFUND_STATUS.NONE,
      };
      tx.update(orderRef, patch);
      return { order: serialize(orderSnap.id, { ...order, ...patch }), refundedF: 0, bankRefundNeeded: method === PAYMENT_METHOD.BANK };
    }

    const amount = Number(order.walletAmount);
    const balance = walletSnap.exists ? Number(walletSnap.data().balance) || 0 : 0;
    const refundedAlready = refundSnap.exists; // phòng thủ: không bao giờ ghi hoàn lần hai
    const newBalance = refundedAlready ? balance : balance + amount;

    const patch = {
      status: ORDER_STATUS.CANCELLED, statusNote: 'Khách hàng đã hủy đơn', cancelledAt: now, cancelledBy: 'customer', updatedAt: now,
      paymentStatus: PAYMENT_STATUS.REFUNDED, refundStatus: REFUND_STATUS.REFUNDED_F, refundedAt: now,
    };
    tx.update(orderRef, patch);
    if (!refundedAlready) {
      tx.create(refundRef, {
        type: LEDGER_TYPE.REFUND, delta: amount, amount, balanceAfter: newBalance,
        refType: 'order', refId: orderId, refCode: order.code,
        note: `Hoàn F do hủy đơn ${order.code}`,
        actor: user.uid, actorRole: 'customer', createdAt: now,
      });
      tx.set(walletRef, {
        balance: newBalance, updatedAt: now,
        createdAt: walletSnap.exists ? walletSnap.data().createdAt || now : now,
      });
    }
    return { order: serialize(orderSnap.id, { ...order, ...patch }), refundedF: refundedAlready ? 0 : amount, balance: newBalance };
  });
}

/** Hạn thanh toán của một đơn (đơn cũ chưa có expiresAt: tính từ lúc tạo) */
export function getPaymentDeadline(order) {
  const explicit = toDate(order.expiresAt);
  if (explicit) return explicit;
  const created = toDate(order.createdAt);
  return created ? new Date(created.getTime() + TIMEOUT_MS) : null;
}

/**
 * Tự động hủy MỘT đơn chuyển khoản quá hạn thanh toán (10 phút). Dùng chung cho:
 *  - function chạy định kỳ expire-orders (user = null),
 *  - function expire-order do trang của khách gọi khi đồng hồ về 0 (user = chủ đơn).
 * Máy chủ tự kiểm tra giờ nên khách không thể hủy sớm; chỉ hủy khi đơn VẪN "Chờ thanh toán" (nếu admin đã xác nhận
 * nhận tiền thì không đụng tới). Không đụng tới ví F. Chạy trong transaction nên an toàn khi gọi trùng/đồng thời.
 */
export async function expireOrder(db, user, orderId, now = new Date()) {
  if (typeof orderId !== 'string' || !orderId || orderId.length > 200 || orderId.includes('/')) throw bad('Mã đơn không hợp lệ.');
  const ref = db.collection('orders').doc(orderId);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists || (user && snap.data().customerId !== user.uid)) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy đơn hàng.');
    const order = snap.data();
    const method = order.paymentMethod || PAYMENT_METHOD.BANK;

    if (order.status === ORDER_STATUS.CANCELLED) {
      return { order: serialize(snap.id, order), expired: order.cancelledBy === 'system', alreadyCancelled: true };
    }
    if (order.status !== ORDER_STATUS.PENDING_PAYMENT || method !== PAYMENT_METHOD.BANK) {
      return { order: serialize(snap.id, order), expired: false, reason: 'NOT_PENDING' };
    }

    const deadline = getPaymentDeadline(order);
    if (!deadline || now < deadline) {
      return { order: serialize(snap.id, order), expired: false, secondsLeft: deadline ? Math.ceil((deadline - now) / 1000) : null };
    }

    const patch = {
      status: ORDER_STATUS.CANCELLED,
      statusNote: `Hết thời hạn thanh toán (${ORDER_PAYMENT_TIMEOUT_MINUTES} phút) — đơn đã tự động hủy`,
      cancelledAt: now, cancelledBy: 'system', cancelReason: 'payment_timeout',
      refundStatus: REFUND_STATUS.NONE, updatedAt: now,
    };
    tx.update(ref, patch);
    return { order: serialize(snap.id, { ...order, ...patch }), expired: true };
  });
}

/** Quét các đơn "Chờ thanh toán" và tự hủy những đơn quá hạn. Chạy định kỳ mỗi phút. */
export async function expireDueOrders(db, now = new Date(), limit = 200) {
  const snap = await db.collection('orders').where('status', '==', ORDER_STATUS.PENDING_PAYMENT).limit(limit).get();
  let expired = 0; let failed = 0;
  for (const doc of snap.docs) {
    const data = doc.data();
    if ((data.paymentMethod || PAYMENT_METHOD.BANK) !== PAYMENT_METHOD.BANK) continue;
    const deadline = getPaymentDeadline(data);
    if (!deadline || now < deadline) continue;
    try {
      const res = await expireOrder(db, null, doc.id, now);
      if (res.expired && !res.alreadyCancelled) expired += 1;
    } catch (error) {
      failed += 1;
      console.error('[expire-orders] không hủy được đơn', doc.id, error?.code || error?.message);
    }
  }
  return { checked: snap.size, expired, failed };
}
