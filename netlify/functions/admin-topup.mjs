/** POST /.netlify/functions/admin-topup — CHỈ ADMIN: xác nhận (cộng F) hoặc từ chối yêu cầu nạp. Xem netlify/lib/wallet.mjs */
import { createHandler } from '../lib/handler.mjs';
import { decideTopup } from '../lib/wallet.mjs';

export default createHandler({ admin: true, run: ({ db, user, body }) => decideTopup(db, user, body) });
