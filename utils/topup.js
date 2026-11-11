/** Nội dung chuyển khoản của giao dịch nạp: NAP-20261107-001 → NAP20261107001 (khớp với phần thanh toán) */
export const topupTransferContent = (code) => String(code).replace(/-/g, '');
