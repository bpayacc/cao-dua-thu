/**
 * layouts/dashboard-layout.js
 * Khởi tạo khung Dashboard dùng chung: Sidebar + Topbar + Breadcrumb.
 * Mỗi trang admin chỉ cần gọi initDashboardLayout() rồi tự render nội dung riêng.
 *
 * @param {{activeKey:string, breadcrumb:Array<{label:string, href?:string}>}} options
 */
import { renderSidebar, wireSidebarToggle } from '../components/sidebar.js';
import { renderDashboardTopbar } from '../components/dashboard-topbar.js';
import { renderBreadcrumb } from '../components/breadcrumb.js';

export async function initDashboardLayout({ activeKey, breadcrumb }) {
  renderSidebar('#dashboardSidebar', activeKey);
  await renderDashboardTopbar('#dashboardTopbar');
  renderBreadcrumb('#dashboardBreadcrumb', breadcrumb);
  wireSidebarToggle();
}
