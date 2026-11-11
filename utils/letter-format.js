/**
 * utils/letter-format.js
 * Định dạng nội dung tin nhắn mà Cáo sẽ gửi đến người nhận.
 * Dùng chung cho phần "Xem trước" khi viết thư và cho nút "Sao chép nội dung gửi"
 * trong Dashboard — đảm bảo người gửi thấy ĐÚNG những gì người nhận sẽ nhận.
 */
import { SENDER_MODE } from '../config/constants.js';

export function getSignature(senderMode, senderName) {
  return senderMode === SENDER_MODE.NAMED && senderName
    ? `Từ: ${senderName.trim()}`
    : 'Từ: một người giấu tên';
}

export function composeLetterMessage({ content, senderMode, senderName }) {
  return `💌 Một bức thư gửi đến bạn\n\n${String(content || '').trim()}\n\n— ${getSignature(senderMode, senderName)}\n(Gửi qua Cáo Đưa Thư)`;
}
