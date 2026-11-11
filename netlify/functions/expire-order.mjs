/** POST /.netlify/functions/expire-order — trang của khách gọi khi đồng hồ thanh toán về 0; máy chủ tự kiểm tra hạn rồi mới hủy. */
import { createHandler } from '../lib/handler.mjs';
import { expireOrder } from '../lib/orders.mjs';

export default createHandler({ run: ({ db, user, body }) => expireOrder(db, user, body && body.orderId) });
