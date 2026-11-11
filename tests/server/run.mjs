/**
 * tests/server/run.mjs — kiểm thử logic máy chủ (đơn, ví F, nạp, huỷ/hoàn) với Firestore giả lập.
 * Chạy:  node tests/server/run.mjs
 * Lưu ý: đây là test trên bản giả lập trong bộ nhớ; KHÔNG thay thế việc thử với Firebase thật sau khi deploy.
 */
import { FakeFirestore } from './fakeFirestore.mjs';
import { __setDepsForTest } from '../../netlify/lib/handler.mjs';
import { createOrder, cancelOrder, expireOrder, expireDueOrders } from '../../netlify/lib/orders.mjs';
import expireOrderFn from '../../netlify/functions/expire-order.mjs';
import { createTopup, decideTopup } from '../../netlify/lib/wallet.mjs';
import createOrderFn from '../../netlify/functions/create-order.mjs';
import cancelOrderFn from '../../netlify/functions/cancel-order.mjs';
import createTopupFn from '../../netlify/functions/create-topup.mjs';
import adminTopupFn from '../../netlify/functions/admin-topup.mjs';

let fails = 0; let total = 0;
const ok = (name, cond, extra = '') => { total++; if (!cond) { fails++; console.log('FAIL', name, extra); } else console.log('PASS', name); };
const rejects = async (promise) => { try { await promise; return null; } catch (e) { return e; } };

let rid = 0;
const newRid = () => `req_${String(++rid).padStart(6, '0')}_abcdefghij`;
const U = (n) => ({ uid: `user${n}`, email: `u${n}@test.vn`, name: `User ${n}` });
const ADMIN = { uid: 'admin1', email: 'admin@test.vn', name: 'Admin' };
const letter = (n, len = 30) => `Thư số ${n} `.padEnd(len, 'x');
const input = (over = {}) => ({
  packageId: 'single', senderMode: 'anonymous', senderName: '', recipientTiktok: '@nguoi_nhan',
  letters: [letter(1)], paymentMethod: 'bank', requestId: newRid(), ...over,
});
const lettersFor = (n) => Array.from({ length: n }, (_, i) => letter(i + 1));
const fresh = () => { const db = new FakeFirestore(); db.seed('users/admin1', { role: 'admin', fullName: 'Admin' }); return db; };
const wallet = (db, uid) => db.get(`wallets/${uid}`);
const ledger = (db, uid) => db.list(`wallets/${uid}/ledger/`).map((x) => x.data);
const ordersOf = (db) => db.list('orders/').map((x) => ({ id: x.path.split('/')[1], ...x.data }));
const bal = (db, uid) => (db.get(`wallets/${uid}`) || {}).balance;
const seedWallet = (db, uid, balance) => db.seed(`wallets/${uid}`, { balance, createdAt: new Date(), updatedAt: new Date() });

// ======================= GIÁ & GIỚI HẠN THƯ =======================
{
  const db = fresh();
  for (const [pkg, n, price] of [['single', 1, 3000], ['triple', 3, 8000], ['five', 5, 14000]]) {
    const r = await createOrder(db, U(1), input({ packageId: pkg, letters: lettersFor(n) }));
    ok(`gói ${n} thư = ${price}`, r.order.totalPrice === price && r.order.letterCount === n && r.order.status === 'pending_payment' && r.order.paymentStatus === 'unpaid', JSON.stringify(r.order).slice(0, 200));
  }
  const codes = ordersOf(db).map((o) => o.code).sort();
  ok('mã đơn CDT-YYYYMMDD-001/002/003 tăng dần', codes.every((c, i) => new RegExp(`^CDT-\\d{8}-00${i + 1}$`).test(c)), codes.join());

  const forged = await createOrder(db, U(1), { ...input(), totalPrice: 1, price: 1, walletAmount: 99999, status: 'sent', paymentStatus: 'paid' });
  ok('server bỏ qua giá/trạng thái do trình duyệt gửi', forged.order.totalPrice === 3000 && forged.order.status === 'pending_payment' && forged.order.paymentStatus === 'unpaid' && forged.order.walletAmount === 0);

  ok('thư đúng 600 ký tự được chấp nhận', !(await rejects(createOrder(db, U(1), input({ letters: ['a'.repeat(600)] })))));
  const e601 = await rejects(createOrder(db, U(1), input({ letters: ['a'.repeat(601)] })));
  ok('thư 601 ký tự bị từ chối (400)', e601 && e601.status === 400 && /600/.test(e601.message), e601 && e601.message);
  const e9 = await rejects(createOrder(db, U(1), input({ letters: ['a'.repeat(9)] })));
  ok('thư dưới 10 ký tự bị từ chối', e9 && e9.status === 400);
  ok('thư đúng 10 ký tự được chấp nhận', !(await rejects(createOrder(db, U(1), input({ letters: ['b'.repeat(10)] })))));
  for (const [pkg, n] of [['triple', 3], ['five', 5]]) {
    for (let bad = 0; bad < n; bad++) {
      const ls = lettersFor(n); ls[bad] = 'z'.repeat(601);
      const err = await rejects(createOrder(db, U(1), input({ packageId: pkg, letters: ls })));
      ok(`gói ${n} thư: thư thứ ${bad + 1} vượt 600 ký tự bị từ chối`, err && err.status === 400 && new RegExp(`Thư ${bad + 1}`).test(err.message), err && err.message);
    }
  }
  const okAll = await createOrder(db, U(1), input({ packageId: 'five', letters: Array.from({ length: 5 }, (_, i) => String(i).repeat(600)) }));
  ok('gói 5 thư: cả 5 thư đúng 600 ký tự được chấp nhận', okAll.order.letters.every((l) => l.length === 600));
  const chk = { status: 'FOUND', username: 'nguoi_nhan', authorName: 'Tên', checkedAt: new Date().toISOString(), profileUrl: 'https://evil.com' };
  const withCheck = await createOrder(db, U(1), input({ tiktokCheck: chk }));
  ok('lưu kết quả kiểm tra TikTok đã làm sạch (link hồ sơ tự dựng lại)', withCheck.order.tiktokCheck.status === 'FOUND' && withCheck.order.tiktokCheck.profileUrl === 'https://www.tiktok.com/@nguoi_nhan');
  const badCheck = await createOrder(db, U(1), input({ tiktokCheck: { ...chk, username: 'nguoi_khac' } }));
  ok('kết quả kiểm tra không khớp ID thì không lưu', badCheck.order.tiktokCheck === null);
  const e5 = await rejects(createOrder(db, U(1), input({ packageId: 'five', letters: [...lettersFor(4), 'c'.repeat(601)] })));
  ok('gói 5 thư: thư thứ 5 vượt 600 bị từ chối', e5 && e5.status === 400 && /Thư 5/.test(e5.message), e5 && e5.message);
  ok('gói 5 thư: thiếu thư (4/5) bị từ chối', (await rejects(createOrder(db, U(1), input({ packageId: 'five', letters: lettersFor(4) })))).status === 400);
  ok('gói 1 thư: gửi 2 thư bị từ chối', (await rejects(createOrder(db, U(1), input({ letters: lettersFor(2) })))).status === 400);
  const dup = await rejects(createOrder(db, U(1), input({ packageId: 'triple', letters: [letter(1), letter(2), letter(1)] })));
  ok('gói 3 thư: nội dung trùng bị từ chối', dup && dup.status === 400 && /riêng/.test(dup.message));
  const dup2 = await rejects(createOrder(db, U(1), input({ packageId: 'five', letters: [letter(1), letter(2), letter(3), letter(4), `  ${letter(2).toUpperCase()}  `] })));
  ok('gói 5 thư: trùng khác hoa/thường & khoảng trắng cũng bị từ chối', dup2 && dup2.status === 400);
  ok('gói không tồn tại bị từ chối', (await rejects(createOrder(db, U(1), input({ packageId: 'ten' })))).status === 400);
  ok('link TikTok giả bị từ chối', (await rejects(createOrder(db, U(1), input({ recipientTiktok: 'https://evil.com/@abc' })))).status === 400);
  ok('có tên mà thiếu tên bị từ chối', (await rejects(createOrder(db, U(1), input({ senderMode: 'named', senderName: '  ' })))).status === 400);
  ok('phương thức thanh toán lạ bị từ chối', (await rejects(createOrder(db, U(1), input({ paymentMethod: 'cash' })))).status === 400);
  ok('thiếu requestId bị từ chối', (await rejects(createOrder(db, U(1), { ...input(), requestId: 'x' }))).status === 400);
  ok('letters không phải mảng chuỗi bị từ chối', (await rejects(createOrder(db, U(1), input({ letters: [{ a: 1 }] })))).status === 400);
}

// ======================= THANH TOÁN BẰNG VÍ F =======================
{
  const db = fresh(); seedWallet(db, 'user2', 10000);
  const r = await createOrder(db, U(2), input({ packageId: 'triple', letters: lettersFor(3), paymentMethod: 'wallet' }));
  ok('ví đủ: trừ đúng 8000 F (10000 → 2000)', wallet(db, 'user2').balance === 2000 && r.balance === 2000);
  ok('ví: đơn ghi paymentMethod=wallet, paid, walletAmount=8000', r.order.paymentMethod === 'wallet' && r.order.paymentStatus === 'paid' && r.order.status === 'paid' && r.order.walletAmount === 8000 && !!r.order.paidAt);
  const l = ledger(db, 'user2');
  ok('ví: có đúng 1 dòng sổ cái payment (-8000, balanceAfter 2000)', l.length === 1 && l[0].type === 'payment' && l[0].delta === -8000 && l[0].balanceAfter === 2000 && l[0].refCode === r.order.code);

  // không đủ số dư
  const e = await rejects(createOrder(db, U(2), input({ packageId: 'triple', letters: lettersFor(3), paymentMethod: 'wallet' })));
  ok('ví thiếu F: 402 INSUFFICIENT_FUNDS + báo thiếu 6000', e && e.status === 402 && e.code === 'INSUFFICIENT_FUNDS' && e.extra.shortfall === 6000 && e.extra.balance === 2000, JSON.stringify(e && e.extra));
  ok('ví thiếu F: KHÔNG tạo thêm đơn / sổ cái, số dư giữ nguyên', ordersOf(db).length === 1 && ledger(db, 'user2').length === 1 && wallet(db, 'user2').balance === 2000);
  const e0 = await rejects(createOrder(db, U(9), input({ paymentMethod: 'wallet' })));
  ok('chưa có ví (0 F) → 402, không tạo ví âm', e0 && e0.status === 402 && !wallet(db, 'user9') && ordersOf(db).length === 1);

  // lặp & đồng thời
  const db2 = fresh(); seedWallet(db2, 'user3', 20000);
  const same = input({ packageId: 'five', letters: lettersFor(5), paymentMethod: 'wallet' });
  const results = await Promise.all(Array.from({ length: 6 }, () => createOrder(db2, U(3), same)));
  ok('gửi trùng/đồng thời 6 lần cùng requestId → chỉ 1 đơn, trừ 1 lần (20000-14000=6000)', ordersOf(db2).length === 1 && wallet(db2, 'user3').balance === 6000 && ledger(db2, 'user3').length === 1, `orders=${ordersOf(db2).length} bal=${wallet(db2, 'user3').balance}`);
  ok('các phản hồi trùng đều trả về cùng một đơn', new Set(results.map((x) => x.order.id)).size === 1 && results.filter((x) => x.reused).length === 5);
  const mismatch = await rejects(createOrder(db2, U(3), { ...same, recipientTiktok: 'someone_else' }));
  ok('cùng requestId nhưng khác nội dung → 409', mismatch && mismatch.status === 409);
  const hijack = await rejects(createOrder(db2, U(4), same));
  ok('người khác dùng lại requestId không chạm được đơn của người kia (đơn riêng theo uid)', !hijack && ordersOf(db2).length === 2 && wallet(db2, 'user3').balance === 6000 || (hijack && hijack.status));

  // hai đơn khác nhau đồng thời, ví chỉ đủ một đơn
  const db3 = fresh(); seedWallet(db3, 'user5', 8000);
  const settled = await Promise.allSettled([
    createOrder(db3, U(5), input({ packageId: 'triple', letters: lettersFor(3), paymentMethod: 'wallet' })),
    createOrder(db3, U(5), input({ packageId: 'triple', letters: lettersFor(3), paymentMethod: 'wallet' })),
    createOrder(db3, U(5), input({ packageId: 'single', letters: lettersFor(1), paymentMethod: 'wallet' })),
  ]);
  const bal = wallet(db3, 'user5').balance;
  ok('đồng thời nhiều đơn vượt số dư: số dư KHÔNG âm', bal >= 0, `bal=${bal}`);
  const spent = 8000 - bal;
  ok('số tiền đã trừ = tổng giá các đơn thành công', spent === ordersOf(db3).reduce((s, o) => s + o.totalPrice, 0), `spent=${spent}`);
  ok('đơn bị từ chối đều là 402', settled.filter((x) => x.status === 'rejected').every((x) => x.reason.status === 402));
}

// ======================= NẠP F =======================
{
  const db = fresh();
  const t = await createTopup(db, U(6), { amount: 50000, requestId: newRid() });
  ok('tạo yêu cầu nạp: pending, mã NAP-YYYYMMDD-001, F=50000', t.topup.status === 'pending' && /^NAP-\d{8}-001$/.test(t.topup.code) && t.topup.fAmount === 50000);
  ok('nạp chưa xác nhận → KHÔNG có ví / sổ cái, số dư không đổi', !wallet(db, 'user6') && ledger(db, 'user6').length === 0);
  for (const bad of [999, 0, -5000, 5000001, 1500.5, '50000', null, NaN]) {
    const e = await rejects(createTopup(db, U(6), { amount: bad, requestId: newRid() }));
    ok(`amount ${JSON.stringify(bad)} bị từ chối`, e && e.status === 400);
  }
  const rq = newRid();
  const a = await createTopup(db, U(6), { amount: 20000, requestId: rq });
  const b = await createTopup(db, U(6), { amount: 20000, requestId: rq });
  ok('tạo nạp lặp cùng requestId → trả lại yêu cầu cũ', a.topup.id === b.topup.id && b.reused && db.list('topups/').length === 2);
  ok('cùng requestId khác số tiền → 409', (await rejects(createTopup(db, U(6), { amount: 30000, requestId: rq }))).status === 409);
  for (let i = 0; i < 3; i++) await createTopup(db, U(6), { amount: 10000, requestId: newRid() });
  const cap = await rejects(createTopup(db, U(6), { amount: 10000, requestId: newRid() }));
  ok('quá 5 yêu cầu đang chờ → 429', cap && cap.status === 429 && cap.code === 'TOO_MANY_PENDING');

  // admin xác nhận
  const tid = t.topup.id;
  const c = await decideTopup(db, ADMIN, { topupId: tid, action: 'confirm' });
  ok('admin xác nhận: cộng đúng 50000 F, trạng thái confirmed', wallet(db, 'user6').balance === 50000 && c.topup.status === 'confirmed' && c.topup.confirmedBy === 'admin1');
  const lg = ledger(db, 'user6');
  ok('sổ cái topup (+50000, balanceAfter 50000, ghi admin)', lg.length === 1 && lg[0].type === 'topup' && lg[0].delta === 50000 && lg[0].balanceAfter === 50000 && lg[0].actorRole === 'admin');
  await Promise.all([1, 2, 3, 4].map(() => decideTopup(db, ADMIN, { topupId: tid, action: 'confirm' })));
  ok('xác nhận lặp/đồng thời 4 lần nữa → KHÔNG cộng thêm', wallet(db, 'user6').balance === 50000 && ledger(db, 'user6').length === 1);
  const rj = await rejects(decideTopup(db, ADMIN, { topupId: tid, action: 'reject', reason: 'nhầm' }));
  ok('đã xác nhận thì không thể từ chối (409)', rj && rj.status === 409 && wallet(db, 'user6').balance === 50000);

  // từ chối
  const t2 = await createTopup(db, U(7), { amount: 10000, requestId: newRid() });
  const noReason = await rejects(decideTopup(db, ADMIN, { topupId: t2.topup.id, action: 'reject', reason: '  ' }));
  ok('từ chối bắt buộc có lý do', noReason && noReason.status === 400);
  const rr = await decideTopup(db, ADMIN, { topupId: t2.topup.id, action: 'reject', reason: 'Không thấy tiền về' });
  ok('từ chối: status rejected + lý do lưu lại, ví không đổi', rr.topup.status === 'rejected' && rr.topup.rejectReason === 'Không thấy tiền về' && !wallet(db, 'user7'));
  const cr = await rejects(decideTopup(db, ADMIN, { topupId: t2.topup.id, action: 'confirm' }));
  ok('đã từ chối thì không thể xác nhận (409), không cộng F', cr && cr.status === 409 && !wallet(db, 'user7') && ledger(db, 'user7').length === 0);

  // cộng đồng thời hai yêu cầu khác nhau vào cùng ví
  const db4 = fresh(); const ta = await createTopup(db4, U(8), { amount: 10000, requestId: newRid() }); const tb = await createTopup(db4, U(8), { amount: 5000, requestId: newRid() });
  await Promise.all([decideTopup(db4, ADMIN, { topupId: ta.topup.id, action: 'confirm' }), decideTopup(db4, ADMIN, { topupId: tb.topup.id, action: 'confirm' })]);
  const l4 = ledger(db4, 'user8');
  ok('hai lần nạp đồng thời: số dư = 15000, sổ cái 2 dòng', wallet(db4, 'user8').balance === 15000 && l4.length === 2);
  ok('sổ cái nhất quán: tổng delta = số dư, balanceAfter cuối = số dư', l4.reduce((s, x) => s + x.delta, 0) === 15000 && Math.max(...l4.map((x) => x.balanceAfter)) === 15000);
  ok('topup không tồn tại → 404', (await rejects(decideTopup(db4, ADMIN, { topupId: 'nope', action: 'confirm' }))).status === 404);
  ok('action lạ → 400', (await rejects(decideTopup(db4, ADMIN, { topupId: ta.topup.id, action: 'delete' }))).status === 400);
}

// ======================= HUỶ ĐƠN & HOÀN =======================
{
  // --- ví F: hoàn đúng một lần ---
  const db = fresh(); seedWallet(db, 'user10', 20000);
  const o = await createOrder(db, U(10), input({ packageId: 'triple', letters: lettersFor(3), paymentMethod: 'wallet' }));
  ok('(chuẩn bị) trả ví: 20000 → 12000', wallet(db, 'user10').balance === 12000);
  const c1 = await cancelOrder(db, U(10), { orderId: o.order.id });
  ok('huỷ đơn ví: hoàn đúng 8000 (→ 20000)', wallet(db, 'user10').balance === 20000 && c1.refundedF === 8000 && c1.order.status === 'cancelled');
  ok('đơn ghi paymentStatus=refunded, refundStatus=refunded_f', c1.order.paymentStatus === 'refunded' && c1.order.refundStatus === 'refunded_f' && !!c1.order.refundedAt);
  const lg = ledger(db, 'user10').filter((x) => x.type === 'refund');
  ok('có đúng 1 dòng sổ cái refund (+8000)', lg.length === 1 && lg[0].delta === 8000 && lg[0].refCode === o.order.code);
  const c2 = await cancelOrder(db, U(10), { orderId: o.order.id });
  ok('bấm huỷ lần 2: không hoàn thêm (alreadyCancelled)', c2.alreadyCancelled && wallet(db, 'user10').balance === 20000 && ledger(db, 'user10').filter((x) => x.type === 'refund').length === 1);

  // đồng thời
  const o2 = await createOrder(db, U(10), input({ packageId: 'five', letters: lettersFor(5), paymentMethod: 'wallet' }));
  await Promise.all(Array.from({ length: 6 }, () => cancelOrder(db, U(10), { orderId: o2.order.id })));
  ok('huỷ đồng thời 6 yêu cầu: hoàn đúng 1 lần (số dư về 20000)', wallet(db, 'user10').balance === 20000 && ledger(db, 'user10').filter((x) => x.type === 'refund').length === 2);
  const lg2 = ledger(db, 'user10');
  ok('sổ cái nhất quán sau thanh toán + hoàn: tổng delta = số dư - 20000 ban đầu', lg2.reduce((s, x) => s + x.delta, 0) === 0, String(lg2.reduce((s, x) => s + x.delta, 0)));

  // --- chuyển khoản: không cộng F ---
  const bank = await createOrder(db, U(11), input({ paymentMethod: 'bank' }));
  const cb = await cancelOrder(db, U(11), { orderId: bank.order.id });
  ok('huỷ đơn chuyển khoản: cancelled + refundStatus=bank_manual + paymentMethod giữ nguyên', cb.order.status === 'cancelled' && cb.order.refundStatus === 'bank_manual' && cb.order.paymentMethod === 'bank' && cb.bankRefundNeeded === true);
  ok('huỷ đơn chuyển khoản: KHÔNG cộng F, không tạo ví/sổ cái', !wallet(db, 'user11') && ledger(db, 'user11').length === 0 && cb.refundedF === 0);

  // --- không được huỷ ---
  const w = await createOrder(db, U(12), input({ paymentMethod: 'wallet' })).catch(() => null); // chưa có ví → null
  seedWallet(db, 'user12', 10000);
  const w2 = await createOrder(db, U(12), input({ paymentMethod: 'wallet' }));
  db.seed(`orders/${w2.order.id}`, { ...db.get(`orders/${w2.order.id}`), status: 'processing' });
  const eProc = await rejects(cancelOrder(db, U(12), { orderId: w2.order.id }));
  ok('đơn admin đã chuyển "Đang xử lý" → không huỷ được, không hoàn F', eProc && eProc.status === 409 && eProc.code === 'NOT_CANCELLABLE' && wallet(db, 'user12').balance === 7000);
  db.seed(`orders/${w2.order.id}`, { ...db.get(`orders/${w2.order.id}`), status: 'sent' });
  ok('đơn đã gửi thư → không huỷ được', (await rejects(cancelOrder(db, U(12), { orderId: w2.order.id }))).status === 409 && wallet(db, 'user12').balance === 7000);
  const bank2 = await createOrder(db, U(12), input({ paymentMethod: 'bank' }));
  db.seed(`orders/${bank2.order.id}`, { ...db.get(`orders/${bank2.order.id}`), status: 'paid', paymentStatus: 'paid' }); // admin đã xác nhận nhận tiền
  const eBankPaid = await rejects(cancelOrder(db, U(12), { orderId: bank2.order.id }));
  ok('đơn chuyển khoản đã được admin xác nhận → không huỷ được', eBankPaid && eBankPaid.status === 409 && wallet(db, 'user12').balance === 7000);
  db.seed(`orders/${w2.order.id}`, { ...db.get(`orders/${w2.order.id}`), status: 'failed' });
  ok('đơn "Không thể gửi" → không huỷ được', (await rejects(cancelOrder(db, U(12), { orderId: w2.order.id }))).status === 409);

  // --- quyền sở hữu & dữ liệu cũ ---
  const eOther = await rejects(cancelOrder(db, U(13), { orderId: bank.order.id }));
  ok('huỷ đơn của người khác → 404 (không lộ tồn tại)', eOther && eOther.status === 404);
  ok('mã đơn bất thường bị từ chối', (await rejects(cancelOrder(db, U(10), { orderId: '../users/admin1' }))).status === 400);
  db.seed('orders/legacy1', { code: 'CDT-20261107-009', customerId: 'user14', status: 'pending_payment', totalPrice: 8000, packageName: 'Gói 3 thư', letters: ['a'] });
  const cl = await cancelOrder(db, U(14), { orderId: 'legacy1' });
  ok('đơn CŨ (chưa có trường thanh toán) huỷ như chuyển khoản, không cộng F', cl.order.status === 'cancelled' && cl.order.refundStatus === 'bank_manual' && !wallet(db, 'user14'));
  db.seed('orders/odd1', { code: 'CDT-X', customerId: 'user15', status: 'paid', paymentMethod: 'wallet', paymentStatus: 'paid', walletAmount: 0, totalPrice: 3000 });
  const co = await cancelOrder(db, U(15), { orderId: 'odd1' });
  ok('đơn ví nhưng chưa từng bị trừ F (walletAmount=0) → không hoàn F', co.refundedF === 0 && !wallet(db, 'user15') && ledger(db, 'user15').length === 0);
}


// ======================= TỰ ĐỘNG HỦY ĐƠN SAU 10 PHÚT =======================
{
  const T0 = new Date('2026-11-10T03:00:00Z'); const at = (sec) => new Date(T0.getTime() + sec * 1000);
  const db = fresh(); seedWallet(db, 'user30', 50000);
  const bank = await createOrder(db, U(30), input({ paymentMethod: 'bank' }), T0);
  const wal = await createOrder(db, U(30), input({ paymentMethod: 'wallet' }), T0);
  ok('đơn chuyển khoản có hạn thanh toán = tạo + 10 phút', new Date(bank.order.expiresAt).getTime() === T0.getTime() + 600000, bank.order.expiresAt);
  ok('đơn ví F không có hạn thanh toán', wal.order.expiresAt === null);

  const e1 = await expireOrder(db, U(30), bank.order.id, at(0));
  ok('chưa tới hạn (0s): không hủy, còn 600s', e1.expired === false && e1.secondsLeft === 600 && db.get(`orders/${bank.order.id}`).status === 'pending_payment');
  const e2 = await expireOrder(db, U(30), bank.order.id, at(599));
  ok('599s: vẫn chưa hủy, còn 1s', e2.expired === false && e2.secondsLeft === 1 && db.get(`orders/${bank.order.id}`).status === 'pending_payment');
  const bBefore = bal(db, 'user30');
  const e3 = await expireOrder(db, U(30), bank.order.id, at(600));
  const o = db.get(`orders/${bank.order.id}`);
  ok('đúng 600s: tự động hủy (cancelled, cancelledBy=system, lý do payment_timeout, ghi chú hết hạn)', e3.expired === true && o.status === 'cancelled' && o.cancelledBy === 'system' && o.cancelReason === 'payment_timeout' && /Hết thời hạn thanh toán \(10 phút\)/.test(o.statusNote), JSON.stringify(o).slice(0, 200));
  ok('hủy do hết hạn KHÔNG đụng tới ví F và không đánh dấu hoàn tiền', bal(db, 'user30') === bBefore && o.refundStatus === 'none' && ledger(db, 'user30').every((l) => l.type !== 'refund'));
  const e4 = await expireOrder(db, U(30), bank.order.id, at(700));
  ok('gọi lại sau khi đã hủy: không đổi gì (alreadyCancelled)', e4.alreadyCancelled === true && e4.expired === true && db.get(`orders/${bank.order.id}`).updatedAt.getTime() === at(600).getTime());
  const bank2 = await createOrder(db, U(30), input({ paymentMethod: 'bank' }), T0);
  const par = await Promise.all(Array.from({ length: 6 }, () => expireOrder(db, U(30), bank2.order.id, at(601))));
  ok('hủy hết hạn đồng thời 6 lần: chỉ ghi 1 lần', par.every((x) => x.expired) && db.get(`orders/${bank2.order.id}`).status === 'cancelled');
  const cc = await cancelOrder(db, U(30), { orderId: bank2.order.id });
  ok('khách bấm hủy một đơn đã tự hủy: không hoàn/không đổi', cc.alreadyCancelled === true && cc.refundedF === 0 && db.get(`orders/${bank2.order.id}`).cancelledBy === 'system');

  // đơn ví F và đơn đã được admin xác nhận: KHÔNG bao giờ bị hủy do quá hạn
  const eW = await expireOrder(db, U(30), wal.order.id, at(99999));
  ok('đơn trả bằng ví F không bị tự hủy dù đã rất lâu', eW.expired === false && db.get(`orders/${wal.order.id}`).status === 'paid');
  const bank3 = await createOrder(db, U(30), input({ paymentMethod: 'bank' }), T0);
  db.seed(`orders/${bank3.order.id}`, { ...db.get(`orders/${bank3.order.id}`), status: 'paid', paymentStatus: 'paid' }); // admin đã nhận tiền
  const eP = await expireOrder(db, U(30), bank3.order.id, at(99999));
  ok('đơn chuyển khoản admin đã xác nhận (paid) không bị tự hủy', eP.expired === false && db.get(`orders/${bank3.order.id}`).status === 'paid');

  // quyền + đầu vào
  const bank4 = await createOrder(db, U(30), input({ paymentMethod: 'bank' }), T0);
  const eO = await rejects(expireOrder(db, U(31), bank4.order.id, at(99999)));
  ok('người khác không thể hủy hết hạn đơn của bạn (404)', eO && eO.status === 404 && db.get(`orders/${bank4.order.id}`).status === 'pending_payment');
  ok('mã đơn bất thường bị từ chối', (await rejects(expireOrder(db, U(30), '../x', at(0)))).status === 400);

  // đơn cũ (chưa có expiresAt) tính từ createdAt
  db.seed('orders/legacyA', { code: 'CDT-L-1', customerId: 'user32', status: 'pending_payment', createdAt: new Date(T0.getTime() - 20 * 60000), totalPrice: 8000, letters: ['a'] });
  db.seed('orders/legacyB', { code: 'CDT-L-2', customerId: 'user32', status: 'pending_payment', createdAt: new Date(T0.getTime() - 5 * 60000), totalPrice: 8000, letters: ['a'] });
  ok('đơn cũ 20 phút trước (không có expiresAt) bị hủy', (await expireOrder(db, U(32), 'legacyA', T0)).expired === true);
  const lb = await expireOrder(db, U(32), 'legacyB', T0);
  ok('đơn cũ 5 phút trước: chưa hủy, còn 300s', lb.expired === false && lb.secondsLeft === 300);
}
{
  // quét định kỳ
  const T0 = new Date('2026-11-10T04:00:00Z'); const at = (sec) => new Date(T0.getTime() + sec * 1000);
  const db = fresh(); seedWallet(db, 'user40', 50000);
  const mkb = (rid, t) => createOrder(db, U(40), input({ paymentMethod: 'bank', requestId: rid }), t);
  const old1 = await mkb('sweep_request_id_0001', T0); const old2 = await mkb('sweep_request_id_0002', T0);
  const fresh1 = await mkb('sweep_request_id_0003', at(500));
  const wal = await createOrder(db, U(40), input({ paymentMethod: 'wallet', requestId: 'sweep_request_id_0004' }), T0);
  const paid = await mkb('sweep_request_id_0005', T0); db.seed(`orders/${paid.order.id}`, { ...db.get(`orders/${paid.order.id}`), status: 'paid' });
  const r1 = await expireDueOrders(db, at(650));
  const st = (x) => db.get(`orders/${x.order.id}`).status;
  ok('quét định kỳ: hủy đúng 2 đơn quá hạn', r1.expired === 2 && st(old1) === 'cancelled' && st(old2) === 'cancelled', JSON.stringify(r1));
  ok('quét định kỳ: giữ nguyên đơn chưa quá hạn / đơn ví F / đơn đã xác nhận', st(fresh1) === 'pending_payment' && st(wal) === 'paid' && st(paid) === 'paid');
  const r2 = await expireDueOrders(db, at(650));
  ok('quét lần 2: không hủy thêm (idempotent)', r2.expired === 0 && r2.failed === 0);
  const r3 = await expireDueOrders(db, at(1200));
  ok('sau đó đơn còn lại cũng hết hạn và bị hủy', r3.expired === 1 && st(fresh1) === 'cancelled');
  ok('tổng: ví F không bị đụng, không có dòng hoàn F', bal(db, 'user40') === 50000 - 3000 && ledger(db, 'user40').every((l) => l.type === 'payment'));
}
{
  // qua handler: cần đăng nhập + chỉ chủ đơn
  const db = fresh(); db.seed('users/user50', { role: 'customer', fullName: 'K' }); db.seed('users/user51', { role: 'customer', fullName: 'K2' });
  const tokens = { a: { uid: 'user50', email: 'a@t.vn', email_verified: true }, b: { uid: 'user51', email: 'b@t.vn', email_verified: true } };
  __setDepsForTest({ db, verifyIdToken: async (t) => { if (!tokens[t]) throw new Error('x'); return tokens[t]; } });
  const mk = await createOrder(db, { uid: 'user50', email: 'a@t.vn', name: 'K' }, input({ paymentMethod: 'bank' }));
  const call = (token, body) => expireOrderFn(new Request('https://x/f', { method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {}, body: JSON.stringify(body) }));
  ok('expire-order không token → 401', (await call(null, { orderId: mk.order.id })).status === 401);
  const early = await call('a', { orderId: mk.order.id }); const ej = await early.json();
  ok('khách gọi expire-order sớm: server từ chối hủy (expired=false, còn ~600s), đơn không đổi', early.status === 200 && ej.expired === false && ej.secondsLeft > 590 && db.get(`orders/${mk.order.id}`).status === 'pending_payment', JSON.stringify(ej));
  const other = await call('b', { orderId: mk.order.id });
  ok('người khác gọi expire-order → 404', other.status === 404);
  db.seed(`orders/${mk.order.id}`, { ...db.get(`orders/${mk.order.id}`), expiresAt: new Date(Date.now() - 1000) });
  const late = await (await call('a', { orderId: mk.order.id })).json();
  ok('quá hạn: expire-order hủy đơn', late.ok && late.expired === true && db.get(`orders/${mk.order.id}`).status === 'cancelled');
}

// ======================= HANDLER: XÁC THỰC / QUYỀN =======================
{
  const db = fresh(); db.seed('users/user20', { role: 'customer', fullName: 'Khách' });
  const tokens = {
    'tok-user20': { uid: 'user20', email: 'k@t.vn', email_verified: true, name: 'Khách' },
    'tok-unverified': { uid: 'user21', email: 'x@t.vn', email_verified: false },
    'tok-admin': { uid: 'admin1', email: 'admin@test.vn', email_verified: true },
  };
  __setDepsForTest({ db, verifyIdToken: async (t) => { if (!tokens[t]) throw new Error('bad'); return tokens[t]; } });
  const call = (fn, body, token, method = 'POST') => fn(new Request('https://x.test/f', { method, headers: token ? { authorization: `Bearer ${token}` } : {}, body: method === 'POST' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined }));
  const j = async (res) => ({ status: res.status, body: await res.json() });

  let r = await j(await call(createOrderFn, input(), null));
  ok('không có token → 401', r.status === 401 && r.body.code === 'UNAUTHENTICATED' && r.body.ok === false);
  r = await j(await call(createOrderFn, input(), 'garbage'));
  ok('token sai → 401', r.status === 401);
  r = await j(await call(createOrderFn, input(), 'tok-unverified'));
  ok('email chưa xác minh → 403', r.status === 403 && r.body.code === 'EMAIL_NOT_VERIFIED');
  r = await j(await call(createOrderFn, input(), 'tok-user20', 'GET'));
  ok('GET → 405', r.status === 405);
  r = await j(await call(createOrderFn, '{bad json', 'tok-user20'));
  ok('JSON hỏng → 400', r.status === 400 && r.body.code === 'INVALID_JSON');
  r = await j(await call(createOrderFn, input({ packageId: 'triple', letters: lettersFor(3) }), 'tok-user20'));
  ok('tạo đơn qua handler: 200 ok, đơn thuộc uid trong token', r.status === 200 && r.body.ok && r.body.order.customerId === 'user20' && r.body.order.totalPrice === 8000 && !('payloadHash' in r.body.order));
  const tp = await j(await call(createTopupFn, { amount: 10000, requestId: newRid() }, 'tok-user20'));
  ok('create-topup qua handler: pending', tp.status === 200 && tp.body.topup.status === 'pending');
  r = await j(await call(adminTopupFn, { topupId: tp.body.topup.id, action: 'confirm' }, 'tok-user20'));
  ok('KHÁCH tự xác nhận nạp của mình → 403, không cộng F', r.status === 403 && r.body.code === 'FORBIDDEN' && !wallet(db, 'user20'));
  r = await j(await call(adminTopupFn, { topupId: tp.body.topup.id, action: 'confirm' }, null));
  ok('admin-topup không token → 401', r.status === 401);
  r = await j(await call(adminTopupFn, { topupId: tp.body.topup.id, action: 'confirm' }, 'tok-admin'));
  ok('admin xác nhận qua handler → 200 và cộng F', r.status === 200 && wallet(db, 'user20').balance === 10000);
  const co = await j(await call(cancelOrderFn, { orderId: 'whatever' }, 'tok-admin'));
  ok('hủy đơn không tồn tại → 404 (admin cũng không huỷ hộ qua endpoint khách)', co.status === 404);
  // lỗi bất ngờ không lộ chi tiết
  __setDepsForTest({ db: { collection() { throw new Error('SECRET-INTERNAL-DETAIL'); } }, verifyIdToken: async () => tokens['tok-user20'] });
  const boom = await j(await call(createOrderFn, input(), 'tok-user20'));
  ok('lỗi nội bộ → 500 chung chung, không lộ chi tiết', boom.status === 500 && boom.body.code === 'INTERNAL' && !JSON.stringify(boom.body).includes('SECRET'));
}

console.log(`\n${total - fails}/${total} passed`);
console.log(fails ? `${fails} FAILURES` : 'ALL SERVER TESTS PASSED');
process.exit(fails ? 1 : 0);
