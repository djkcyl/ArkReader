import content from './download-content.html?raw';
import './download-page.css';
import { clientDownloads, type ClientDownloadState } from './client-download';
import externalArrow from './external-arrow.svg?raw';

function downloadBytes(value: number): string {
  const unit = value >= 1e9 ? 'GB' : value >= 1e6 ? 'MB' : 'KB';
  return `${(value / (unit === 'GB' ? 1e9 : unit === 'MB' ? 1e6 : 1e3)).toFixed(1)} ${unit}`;
}

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
  private unsubscribe: () => void;
  constructor() {
    this.root.id = 'desktop-downloads';
    this.root.className = 'desktop-page downloads';
    this.root.hidden = true;
    this.root.innerHTML = content
      .replaceAll('%APP_VERSION%', __APP_VERSION__)
      .replaceAll('%EXTERNAL_ARROW%', externalArrow);
    prioritizeDownloads(this.root);
    const transfer = document.createElement('section');
    transfer.className = 'client-download-transfer';
    transfer.setAttribute('aria-label', '客户端下载进度');
    transfer.innerHTML = `<div class="client-download-heading"><strong data-download-status role="status"></strong><span data-download-percent></span></div>
      <p class="client-download-name" data-download-name></p>
      <progress max="1" value="0" aria-label="下载总进度"></progress>
      <div class="client-download-footer"><span data-download-detail></span><div class="client-download-actions">
      <button type="button" data-download-cancel>取消下载</button><button type="button" data-download-retry hidden>重新下载</button>
      <a data-download-save download hidden>保存文件 ↓</a></div></div>`;
    this.root.querySelector('.download-grid')!.before(transfer);
    for (const link of this.root.querySelectorAll<HTMLAnchorElement>('.download-actions a')) {
      const name = new URL(link.href).pathname.split('/').at(-1)!;
      const id = name.slice(`ArkReader-${__APP_VERSION__}-`.length);
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.package = id;
      button.append(...link.childNodes);
      link.replaceWith(button);
      button.onclick = () => {
        if (!clientDownloads.busy) void clientDownloads.start(id);
        transfer.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      };
    }
    transfer.querySelector<HTMLButtonElement>('[data-download-cancel]')!.onclick = () =>
      clientDownloads.cancel();
    transfer.querySelector<HTMLButtonElement>('[data-download-retry]')!.onclick = () =>
      void clientDownloads.start(clientDownloads.state.id);
    const update = (state: ClientDownloadState) => {
      transfer.hidden = state.phase === 'idle';
      transfer.dataset.state = state.phase;
      const status = {
        idle: '',
        preparing: '正在准备下载…',
        downloading: '正在下载',
        ready: '文件已就绪',
        cancelled: '下载已取消',
        error: state.error,
      }[state.phase];
      transfer.querySelector('[data-download-status]')!.textContent = status;
      transfer.querySelector('[data-download-name]')!.textContent = state.name;
      const progress = transfer.querySelector('progress')!;
      progress.value = state.total ? state.received / state.total : 0;
      if (state.phase === 'preparing') progress.removeAttribute('value');
      transfer.querySelector('[data-download-percent]')!.textContent = state.total
        ? `${Math.floor(progress.value * 100)}%`
        : '';
      transfer.querySelector('[data-download-detail]')!.textContent = state.total
        ? `${downloadBytes(state.received)} / ${downloadBytes(state.total)}${state.phase === 'downloading' ? ` · ${downloadBytes(state.speed)}/s` : ''}`
        : '';
      transfer.querySelector<HTMLElement>('[data-download-cancel]')!.hidden = !clientDownloads.busy;
      transfer.querySelector<HTMLElement>('[data-download-retry]')!.hidden = ![
        'error',
        'cancelled',
      ].includes(state.phase);
      const save = transfer.querySelector<HTMLAnchorElement>('[data-download-save]')!;
      save.hidden = state.phase !== 'ready';
      save.href = state.url;
      save.download = state.name;
      if (state.version) {
        this.root.querySelector('.download-version')!.textContent = 'v' + state.version;
        this.root.querySelector<HTMLAnchorElement>('.download-links a')!.href =
          `https://github.com/djkcyl/ArkReader/releases/tag/v${state.version}`;
      }
      for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-package]'))
        button.disabled = clientDownloads.busy;
    };
    this.unsubscribe = clientDownloads.subscribe(update);
    this.root.querySelector<HTMLAnchorElement>('#ios-notice a')!.onclick = (event) => {
      event.preventDefault();
      document.dispatchEvent(new Event('arkreader-show-library'));
    };
  }
  dispose(): void {
    this.unsubscribe();
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
  document.addEventListener(
    'arkreader-startup-finished',
    () => {
      events.abort();
      page.dispose();
    },
    { once: true },
  );
  if (new URLSearchParams(location.search).get('page') === 'downloads') show(true);
}
