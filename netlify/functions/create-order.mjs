/** POST /.netlify/functions/create-order — tạo đơn (và trừ F nếu thanh toán bằng ví). Xem netlify/lib/orders.mjs */
import { createHandler } from '../lib/handler.mjs';
import { createOrder } from '../lib/orders.mjs';

export default createHandler({ run: ({ db, user, body }) => createOrder(db, user, body) });
