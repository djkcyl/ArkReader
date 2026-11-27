import { isWeb } from './platform';

export type ApplicationPage = 'library' | 'resources' | 'audio' | 'about' | 'downloads';
export const applicationPages: ApplicationPage[] = [
  'library',
  'resources',
  'audio',
  'about',
  'downloads',
];
export const applicationHeader = `<header class="brand">
  <a href="./">ARK<span>READER</span></a><span class="subtitle">明日方舟 · 剧情档案</span>
  <span class="connection" id="connection"></span>
</header>`;
const icons = {
  library: '<path d="M4 5h6v14H4zM14 5h6v14h-6zM7 8v7M17 8v7"/>',
  resources: '<path d="M3 7h18v13H3zM3 7l3-4h12l3 4M8 12h8M10 16h4"/>',
  about: '<circle cx="12" cy="12" r="9"/><path d="M12 10v7M12 7h.01"/>',
  audio: '<path d="M3 9h4l5-4v14l-5-4H3zM16 8a6 6 0 0 1 0 8M19 5a10 10 0 0 1 0 14"/>',
  downloads: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
};
export function createApplicationRail(): HTMLElement {
  const rail = document.createElement('aside');
  rail.className = 'desktop-rail';
  const items: [ApplicationPage, string, string][] = [
    ['library', '剧情库', '剧情库'],
    ['resources', '资源', '资源管理'],
    ['audio', '声音', '声音设置'],
    ...(isWeb ? [['downloads', '客户端', '下载客户端'] as [ApplicationPage, string, string]] : []),
    ['about', '应用', '应用信息'],
  ];
  rail.innerHTML = `<div class="desktop-monogram" aria-label="ArkReader">A<span>/</span></div>
    <nav aria-label="应用导航">${items.map(([page, label, title]) => `<button data-page="${page}" title="${title}"><svg viewBox="0 0 24 24" aria-hidden="true">${icons[page]}</svg><span>${label}</span></button>`).join('')}</nav>
    <span class="desktop-rail-foot">${isWeb ? 'WEB' : 'DESKTOP'}<br/><span id="rail-version">v${__APP_VERSION__}</span></span>`;
  return rail;
}
export function markApplicationPage(rail: HTMLElement, page: ApplicationPage): void {
  for (const button of rail.querySelectorAll<HTMLButtonElement>('button[data-page]')) {
    if (button.dataset.page === page) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
}
export function decorateApplicationHeader(header: HTMLElement): void {
  const badge = document.createElement('span');
  badge.className = 'desktop-badge';
  badge.textContent = isWeb ? '网页版' : '桌面版';
  header.querySelector('a')!.after(badge);
}
