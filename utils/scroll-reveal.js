/**
 * utils/scroll-reveal.js
 * Hiệu ứng xuất hiện nhẹ khi phần tử [data-reveal] cuộn vào khung nhìn.
 * Dùng chung cho mọi trang thay vì lặp lại logic IntersectionObserver.
 */
export function setupScrollReveal() {
  const items = document.querySelectorAll('[data-reveal]');
  if (!items.length || !('IntersectionObserver' in window)) return;

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-revealed');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.15 });

  items.forEach((el) => observer.observe(el));
}
