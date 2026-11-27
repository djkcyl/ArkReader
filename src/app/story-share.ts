import { isNative } from './platform';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';

export function storyShareUrl(story: string): string {
  const url = new URL('https://ar.aunly.cn/');
  url.searchParams.set('story', story);
  return url.href;
}

export async function copyStoryLink(story: string): Promise<void> {
  const text = storyShareUrl(story);
  if (isNative) await writeText(text, { label: 'ArkReader 剧情链接' });
  else if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
  else throw new Error('当前浏览器不支持复制链接，请从地址栏复制。');
}
