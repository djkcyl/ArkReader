import content from './download-content.html?raw';
import './download-page.css';

export function prioritizeDownloads(root: HTMLElement): void {
  const hints = navigator as Navigator & { userAgentData?: { platform: string } };
  const userAgent = navigator.userAgent;
  const ios =
    /iPhone|iPad|iPod/i.test(userAgent) ||
    (/Mac/i.test(navigator.platform) && navigator.maxTouchPoints > 1);
  const system = `${hints.userAgentData?.platform ?? ''} ${navigator.platform} ${userAgent}`;
  const platform = /Android/i.test(userAgent)
    ? 'android'
    : ios
      ? null
      : /Windows|Win32|Win64/i.test(system)
        ? 'windows'
        : /Mac/i.test(system)
          ? 'macos'
          : /Linux/i.test(system)
            ? 'linux'
            : null;
  const card = platform ? root.querySelector<HTMLElement>(`[data-platform="${platform}"]`) : null;
  if (card) {
    card.parentElement!.prepend(card);
    card.classList.add('current-platform');
    card.querySelector<HTMLElement>('.platform-current')!.hidden = false;
  }
  if (ios) root.querySelector<HTMLElement>('#ios-notice')!.hidden = false;
}

export class DownloadPage {
  readonly root = document.createElement('section');
  constructor() {
    this.root.id = 'desktop-downloads';
    this.root.className = 'desktop-page downloads';
    this.root.hidden = true;
    this.root.innerHTML = content.replaceAll('%APP_VERSION%', __APP_VERSION__);
    prioritizeDownloads(this.root);
    this.root.querySelector<HTMLAnchorElement>('#ios-notice a')!.onclick = (event) => {
      event.preventDefault();
      document.dispatchEvent(new Event('arkreader-show-library'));
    };
  }
}

export function mountStartupDownloads(): void {
  const startup = document.getElementById('startup-root')!;
  const entry = startup.querySelector<HTMLAnchorElement>('.startup-download');
  if (!entry) return;
  const page = new DownloadPage();
  startup.append(page.root);
  const show = (downloads: boolean) => {
    document.body.dataset.desktopPage = downloads ? 'downloads' : 'library';
    page.root.hidden = !downloads;
    entry.textContent = downloads ? '返回剧情库' : '下载客户端';
    entry.setAttribute('aria-expanded', String(downloads));
    const url = new URL(location.href);
    if (downloads) url.searchParams.set('page', 'downloads');
    else url.searchParams.delete('page');
    history.replaceState(history.state, '', url);
  };
  entry.onclick = (event) => {
    event.preventDefault();
    show(document.body.dataset.desktopPage !== 'downloads');
  };
  const events = new AbortController();
  document.addEventListener('arkreader-show-library', () => show(false), { signal: events.signal });
  document.addEventListener('arkreader-startup-finished', () => events.abort(), { once: true });
  if (new URLSearchParams(location.search).get('page') === 'downloads') show(true);
}
