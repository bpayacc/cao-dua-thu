/** Lỗi nghiệp vụ có mã + HTTP status, an toàn để trả về cho người dùng (không chứa chi tiết nội bộ). */
export class ApiError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}
