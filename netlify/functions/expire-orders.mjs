/**
 * netlify/functions/expire-orders.mjs — Netlify SCHEDULED FUNCTION, chạy mỗi phút.
 * Tự động hủy các đơn chuyển khoản chưa thanh toán sau ORDER_PAYMENT_TIMEOUT_MINUTES (10 phút).
 * Chạy ngay cả khi khách đã đóng trang. Chỉ chạy trên bản deploy đang "Published" của Netlify.
 * Idempotent: gọi thêm lần nữa không gây hại (chỉ hủy đơn thật sự quá hạn và còn "Chờ thanh toán").
 */
import { getRealDeps } from '../lib/firebaseAdmin.mjs';
import { expireDueOrders } from '../lib/orders.mjs';

let lastRun = 0;

export default async () => {
  const now = Date.now();
  if (now - lastRun < 20_000) return new Response(JSON.stringify({ ok: true, skipped: true }), { status: 200 }); // chống bị gọi dồn
  lastRun = now;
  try {
    const { db } = await getRealDeps();
    const result = await expireDueOrders(db, new Date(now));
    if (result.expired || result.failed) console.log('[expire-orders]', JSON.stringify(result));
    return new Response(JSON.stringify({ ok: true, ...result }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error('[expire-orders] lỗi:', error?.message || error);
    return new Response(JSON.stringify({ ok: false }), { status: 500 });
  }
};

export const config = { schedule: '* * * * *' };
