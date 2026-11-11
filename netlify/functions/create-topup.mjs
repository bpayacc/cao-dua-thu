/** POST /.netlify/functions/create-topup — tạo yêu cầu nạp F (chờ admin xác nhận; KHÔNG cộng F). Xem netlify/lib/wallet.mjs */
import { createHandler } from '../lib/handler.mjs';
import { createTopup } from '../lib/wallet.mjs';

export default createHandler({ run: ({ db, user, body }) => createTopup(db, user, body) });
