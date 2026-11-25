import { chapterProgress, type ProgressLedger, type SavedProgress } from './reading-state';

const node = (tag: string, cls: string, text = '') => {
  const el = document.createElement(tag);
  el.className = cls;
  el.textContent = text;
  return el;
};
function meter(label: string, percent: number | null, detail: string): HTMLElement {
  const root = node('span', 'reading-meter');
  root.classList.toggle('is-complete', percent === 100);
  const heading = node('span', 'reading-meter-heading');
  heading.append(
    node('span', '', label),
    node('strong', 'reading-percent', percent === null ? '未记录' : `${percent}%`),
  );
  const bar = document.createElement('progress');
  bar.max = 100;
  bar.value = percent ?? 0;
  bar.setAttribute('aria-label', label);
  if (percent === null) bar.setAttribute('aria-valuetext', '旧记录未记录观看位置');
  root.append(heading, bar);
  if (detail) root.append(node('span', 'reading-meter-detail', detail));
  return root;
}
export function storyProgressView(id: string, record: SavedProgress | undefined): HTMLElement {
  const root = meter(
    '最高进度',
    record ? record.percent : 0,
    record?.skipped ? '含跳过内容' : record?.complete ? '已看完' : '',
  );
  root.dataset.progressStory = id;
  root.title = '继续阅读时从最高进度开始。';
  return root;
}
export function chapterProgressView(
  id: string,
  ids: string[],
  ledger: ProgressLedger,
): HTMLElement {
  const progress = chapterProgress(ids, ledger),
    root = meter(
      '章节总进度',
      progress.percent,
      `已看完 ${progress.complete} / ${progress.total} 段${progress.unknown ? ' · 旧记录未记录进度' : ''}`,
    );
  root.dataset.progressGroup = id;
  root.title = '本章所有剧情的平均阅读进度。';
  return root;
}
