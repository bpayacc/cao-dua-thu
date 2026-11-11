/**
 * dashboard/overview.js — điểm vào JS cho Dashboard > Tổng quan (index.html)
 * Thống kê số đơn theo trạng thái từ dữ liệu thật trên Firestore.
 */
import { initDashboardLayout } from '../layouts/dashboard-layout.js';
import { requireAdmin } from '../utils/router-guard.js';
import { qs } from '../utils/dom.js';
import { fHtml } from '../utils/formatters.js';
import { initAuthData } from '../services/authService.js';
import { getAllOrders } from '../services/orderService.js';
import { getAllTopups } from '../services/walletService.js';
import { ORDER_STATUS, ORDER_STATUS_LABEL, TOPUP_STATUS, REFUND_STATUS } from '../config/constants.js';

async function init() {
  initAuthData();
  const admin = await requireAdmin();
  if (!admin) return;

  await initDashboardLayout({ activeKey: 'overview', breadcrumb: [{ label: 'Dashboard' }] });

  try {
    const orders = await getAllOrders();
    const topups = await getAllTopups().catch(() => null); // lỗi đọc nạp F không chặn trang
    renderStats(orders);
    renderTodo(orders, topups);
    qs('#overviewContent').classList.remove('is-hidden');
  } catch (error) {
    const el = qs('#overviewError');
    el.textContent = error.message;
    el.classList.remove('is-hidden');
  } finally {
    qs('#overviewLoading').classList.add('is-hidden');
  }
}

const count = (orders, status) => orders.filter((o) => o.status === status).length;

function renderStats(orders) {
  const revenue = orders
    .filter((o) => [ORDER_STATUS.PAID, ORDER_STATUS.PROCESSING, ORDER_STATUS.SENT].includes(o.status))
    .reduce((sum, o) => sum + (o.totalPrice || 0), 0);

  qs('#overviewStats').innerHTML = `
    <div class="card stat-card"><span class="stat-card__label">Tổng số đơn</span><strong>${orders.length}</strong></div>
    <div class="card stat-card"><span class="stat-card__label">${ORDER_STATUS_LABEL[ORDER_STATUS.PENDING_PAYMENT]}</span><strong class="stat-card__value--warning">${count(orders, ORDER_STATUS.PENDING_PAYMENT)}</strong></div>
    <div class="card stat-card"><span class="stat-card__label">${ORDER_STATUS_LABEL[ORDER_STATUS.SENT]}</span><strong class="stat-card__value--success">${count(orders, ORDER_STATUS.SENT)}</strong></div>
    <div class="card stat-card"><span class="stat-card__label">Đã đối soát (đơn đã thanh toán trở đi)</span><strong class="stat-card__value--primary" style="font-size:1.3rem;">${fHtml(revenue)}</strong></div>
  `;
}

function renderTodo(orders, topups) {
  const pendingTopups = topups ? topups.filter((t) => t.status === TOPUP_STATUS.PENDING).length : null;
  const bankRefunds = orders.filter((o) => o.status === ORDER_STATUS.CANCELLED && o.refundStatus === REFUND_STATUS.BANK_MANUAL).length;
  const paid = count(orders, ORDER_STATUS.PAID);
  const processing = count(orders, ORDER_STATUS.PROCESSING);
  const waiting = count(orders, ORDER_STATUS.PENDING_PAYMENT);
  const items = [
    pendingTopups === null ? '<li>Không tải được yêu cầu nạp F.</li>' : `<li><strong>${pendingTopups}</strong> yêu cầu nạp F đang chờ xác nhận — vào <a href="/dashboard/nap-f.html">Nạp F</a>, kiểm tra tiền thực nhận rồi xác nhận.</li>`,
    `<li><strong>${bankRefunds}</strong> đơn chuyển khoản đã bị khách hủy, cần hỗ trợ hoàn tiền thủ công.</li>`,
    `<li><strong>${waiting}</strong> đơn đang chờ khách chuyển khoản — đối soát và bấm "Đã nhận tiền" khi tiền đã về.</li>`,
    `<li><strong>${paid}</strong> đơn đã thanh toán, chưa bắt đầu xử lý.</li>`,
    `<li><strong>${processing}</strong> đơn đang xử lý — gửi xong nhớ bấm "Đã gửi thư".</li>`,
  ];
  qs('#todoList').innerHTML = items.join('');
}

document.addEventListener('DOMContentLoaded', init);
