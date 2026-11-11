import { createHash } from 'node:crypto';

/** YYYYMMDD theo giờ Việt Nam */
export function dateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get('year')}${get('month')}${get('day')}`;
}

export const makeCode = (prefix, key, seq) => `${prefix}-${key}-${String(seq).padStart(3, '0')}`;

export function sha256(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/** Chuyển Date / Firestore Timestamp thành chuỗi ISO để trả JSON */
export function toIso(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  return value;
}

/** Bản sao đơn/giao dịch an toàn để trả về frontend (đổi thời gian → ISO, bỏ các trường nội bộ) */
export function serialize(id, data, hidden = ['payloadHash']) {
  const out = { id };
  for (const [key, value] of Object.entries(data)) {
    if (hidden.includes(key)) continue;
    out[key] = ['createdAt', 'updatedAt', 'paidAt', 'refundedAt', 'cancelledAt', 'confirmedAt', 'rejectedAt', 'expiresAt'].includes(key) ? toIso(value) : value;
  }
  return out;
}

export const REQUEST_ID_RE = /^[A-Za-z0-9_-]{16,64}$/;

/** Date | Firestore Timestamp | chuỗi ISO → Date (hoặc null) */
export function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === 'function') return value.toDate();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
