/**
 * components/faq.js
 * Danh sách câu hỏi thường gặp dạng accordion (mở rộng / thu gọn), có hỗ trợ bàn phím
 * và thuộc tính aria cho trình đọc màn hình.
 */
import { qs, createEl } from '../utils/dom.js';

export function setupFaq(mountSelector, faqs) {
  const container = qs(mountSelector);
  if (!container) return;

  faqs.forEach((faq, index) => {
    const answerId = `faq-answer-${index}`;
    const button = createEl('button', {
      type: 'button',
      class: 'faq-item__question',
      'aria-expanded': 'false',
      'aria-controls': answerId,
    }, [faq.question, chevron()]);

    const answer = createEl('div', { class: 'faq-item__answer', id: answerId, role: 'region' }, [createEl('p', {}, faq.answer)]);
    const item = createEl('div', { class: 'faq-item', 'data-reveal': '' }, [button, answer]);

    button.addEventListener('click', () => {
      const isOpen = item.classList.toggle('is-open');
      button.setAttribute('aria-expanded', String(isOpen));
      answer.style.maxHeight = isOpen ? `${answer.scrollHeight}px` : null;
    });

    container.appendChild(item);
  });
}

function chevron() {
  const span = document.createElement('span');
  span.className = 'faq-item__chevron';
  span.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  return span;
}
