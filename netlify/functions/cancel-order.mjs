/** POST /.netlify/functions/cancel-order — khách huỷ đơn (hoàn F nếu đơn trả bằng ví). Xem netlify/lib/orders.mjs */
import { createHandler } from '../lib/handler.mjs';
import { cancelOrder } from '../lib/orders.mjs';

export default createHandler({ run: ({ db, user, body }) => cancelOrder(db, user, body) });
