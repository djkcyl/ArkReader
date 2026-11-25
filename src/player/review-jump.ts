export function bindReviewJump(
  row: HTMLElement,
  label: string,
  jump: () => void,
  dragged: () => boolean,
): void {
  row.classList.add('review-jump');
  row.tabIndex = 0;
  row.setAttribute('role', 'button');
  row.setAttribute('aria-label', `跳转到：${label}`);
  row.title = '从这里继续播放';
  row.addEventListener('click', (event) => {
    event.stopPropagation();
    if (event.detail && dragged()) return;
    jump();
  });
  row.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || event.repeat || !['Enter', 'Space'].includes(event.code)) return;
    event.preventDefault();
    event.stopPropagation();
    row.click();
  });
}
