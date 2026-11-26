export function resourceLabel(name: string): string {
  if (!name) return '';
  const filename = name.split('/').at(-1) ?? name;
  const kind = name.startsWith('avg/characters/')
    ? '立绘'
    : /^avg\/(bg|backgrounds)\//.test(name)
      ? '背景'
      : /^avg\/(imgs|images)\//.test(name)
        ? '剧情图片'
        : name.startsWith('avg/effects/')
          ? '演出特效'
          : /^(sharedassets\d+|globalgamemanagers|resources)\.assets$/.test(filename)
            ? '界面资源'
            : name.startsWith('anon/')
              ? '公共资源'
              : name.startsWith('spritepack/story_review')
                ? '目录封面'
                : name.includes('[uc]common')
                  ? '公共剧情贴图'
                  : '';
  return kind ? `${kind} · ${filename}` : name;
}
export function transferSpeed(bytes = 0): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB/s';
  return bytes >= 1048576
    ? `${(bytes / 1048576).toFixed(2)} MB/s`
    : `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB/s`;
}
import type { TransferSummary } from './resource-api';

export function renderTransfers(list: HTMLElement, transfers?: TransferSummary): void {
  list.replaceChildren();
  list.hidden = !transfers?.items.length;
  for (const item of transfers?.items ?? []) {
    const row = document.createElement('div');
    row.className = 'load-transfer';
    const label = document.createElement('span');
    label.className = 'load-resource-name';
    label.textContent = resourceLabel(item.name);
    label.title = item.name;
    const value = document.createElement('span');
    value.textContent =
      item.state === 'checking'
        ? '校验缓存'
        : item.state === 'verifying'
          ? '校验下载文件'
          : `${transferSpeed(item.bytesPerSecond)} · ${(item.downloaded / 1048576).toFixed(1)} / ${(item.total / 1048576).toFixed(1)} MB`;
    const bar = document.createElement('progress');
    bar.max = Math.max(1, item.total);
    bar.value = item.downloaded;
    bar.setAttribute('aria-label', label.textContent);
    row.append(label, value, bar);
    list.append(row);
  }
}
