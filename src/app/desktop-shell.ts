import { desktop, isMobile, isWeb } from './platform';
import { resourceRequest, type OperationStatus } from './resource-api';
import './desktop-shell.css';
import './qol.css';
import { mountWindowChrome } from './window-chrome';
import { VersionNotice, type ResourceUpdate } from './version-notice';
import { HomeMusic } from './home-music';
import type { PreparedStartupMusic } from './home-music-boot';
import { AudioPage } from './audio-page';
import { confirmAction } from './action-confirm';
import { mountResourceSource } from './resource-source';
import { DownloadPage } from './download-page';
import externalArrow from './external-arrow.svg?raw';
interface Status {
  version: string | null;
  stories: number;
  storyPlayerScripts: number;
  resourceUpdate?: ResourceUpdate;
  baseResources?: { ready: boolean; bundleCount?: number; coverCount?: number };
  job: Partial<OperationStatus> & { running: boolean; message: string; error: string | null };
}
interface Storage extends Status {
  dataPath: string;
  runtimePath: string;
  originalBytes: number | null;
  originalFiles: number | null;
  temporaryBytes: number | null;
  startupBytes: number | null;
  scanned: boolean;
}
const icons = {
  library: '<path d="M4 5h6v14H4zM14 5h6v14h-6zM7 8v7M17 8v7"/>',
  storage: '<path d="M3 7h18v13H3zM3 7l3-4h12l3 4M8 12h8M10 16h4"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 10v7M12 7h.01"/>',
  audio: '<path d="M3 9h4l5-4v14l-5-4H3zM16 8a6 6 0 0 1 0 8M19 5a10 10 0 0 1 0 14"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
};
const icon = (name: keyof typeof icons) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name]}</svg>`;
export function formatBytes(bytes: number | null): string {
  if (bytes === null) return '待统计';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024,
    index = 0;
  while (value >= 1024 && index < 3) {
    value /= 1024;
    index++;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[index]}`;
}
export function mountDesktopShell(options: {
  leave: () => void;
  reload: () => Promise<void>;
  music?: PreparedStartupMusic;
  suspendForAudio: () => (() => void) | undefined;
  previewUi: () => void;
}): void {
  document.body.classList.add('desktop-app');
  const initialDownloads = isWeb && document.body.dataset.desktopPage === 'downloads';
  document.body.dataset.desktopPage = 'library';
  const rail = document.createElement('aside');
  rail.className = 'desktop-rail';
  rail.innerHTML = /* HTML */ `<div class="desktop-monogram" aria-label="ArkReader">
      A<span>/</span>
    </div>
    <nav aria-label="应用导航">
      <button data-page="library" aria-current="page" title="剧情库">
        ${icon('library')}<span>剧情库</span></button
      ><button data-page="resources" title="资源管理">${icon('storage')}<span>资源</span></button
      ><button data-page="audio" title="声音设置">${icon('audio')}<span>声音</span></button
      >${isWeb ? `<button data-page="downloads" title="下载客户端">${icon('download')}<span>客户端</span></button>` : ''}<button
        data-page="about"
        title="应用信息"
      >
        ${icon('info')}<span>应用</span>
      </button>
    </nav>
    <span class="desktop-rail-foot"
      >${isWeb ? 'WEB' : 'DESKTOP'}<br /><span id="rail-version"></span
    ></span>`;
  document.body.prepend(rail);
  const header = document.querySelector<HTMLElement>('.brand')!;
  header.querySelector('.subtitle')!.textContent = '明日方舟 · 剧情档案';
  const titleLink = header.querySelector<HTMLAnchorElement>('a')!;
  titleLink.onclick = (event) => {
    event.preventDefault();
    show('library');
  };
  const badge = document.createElement('span');
  badge.className = 'desktop-badge';
  badge.textContent = isWeb ? '网页版' : '桌面版';
  titleLink.after(badge);
  mountWindowChrome(header);
  const homeMusic = new HomeMusic(header, options.music);
  const audioPage = new AudioPage(() => show('library'), options.previewUi);
  const downloads = isWeb ? new DownloadPage() : undefined;
  let resumeAudioPage: (() => void) | undefined;
  (window as unknown as { arkreaderHomeMusic: HomeMusic }).arkreaderHomeMusic = homeMusic;
  const resources = document.createElement('section');
  resources.id = 'desktop-resources';
  resources.className = 'desktop-page';
  resources.hidden = true;
  resources.innerHTML = /* HTML */ `<div class="desktop-page-heading">
      <div>
        <span class="desktop-eyebrow">YOUR LOCAL LIBRARY</span>
        <h1>资源与资料库</h1>
        <p>按需下载，随时阅读。</p>
      </div>
      <div class="desktop-heading-actions"><button id="resource-refresh">刷新占用 ↻</button></div>
    </div>
    <div class="desktop-storage-grid">
      <article>
        <span>已下载资源</span><strong id="storage-original">待统计</strong
        ><small id="storage-files">下载后保留，可重复使用</small>
      </article>
      <article>
        <span>播放缓存</span><strong id="storage-temp">待统计</strong
        ><small>退出应用自动清理</small>
      </article>
      <article>
        <span>可用剧情</span><strong id="storage-stories">—</strong
        ><small id="storage-version">读取目录状态…</small>
      </article>
    </div>
    <article class="desktop-card library-location">
      <h2>资料库位置</h2>
      <div class="library-path-row">
        <input class="desktop-path" id="storage-path" readonly aria-label="资料库位置" /><button
          id="resource-open"
        >
          打开文件夹 ${externalArrow}
        </button>
      </div>
      <p>资料库保存在系统用户目录，更新程序不影响已下载资源。</p>
    </article>
    <article class="desktop-card cache-policy">
      <div>
        <h2>清理缓存</h2>
        <p id="storage-startup">启动缓存：待统计</p>
        <p>清理后，下次启动和播放需要重新准备。</p>
        <small>已下载资源、收藏和阅读记录会保留。</small>
      </div>
      <button id="resource-clear" data-resource-action>清理缓存</button>
    </article>`;
  const about = document.createElement('section');
  about.id = 'desktop-about';
  about.className = 'desktop-page';
  about.hidden = true;
  about.innerHTML = /* HTML */ `<div class="desktop-page-heading">
      <div>
        <span class="desktop-eyebrow">ARKREADER / APPLICATION</span>
        <h1>ArkReader <span id="desktop-version"></span></h1>
        <p>一个跨平台的《明日方舟》剧情播放器。</p>
        <nav class="app-links" aria-label="项目链接">
          <a href="https://ar.aunly.cn/" target="_blank" rel="noopener noreferrer"
            >官方网站 ${externalArrow}</a
          >
          <a href="https://github.com/djkcyl/ArkReader" target="_blank" rel="noopener noreferrer"
            >GitHub ${externalArrow}</a
          >
          <a
            href="https://github.com/djkcyl/ArkReader/releases"
            target="_blank"
            rel="noopener noreferrer"
            >更新说明 ${externalArrow}</a
          >
          <a
            href="https://github.com/djkcyl/ArkReader/issues"
            target="_blank"
            rel="noopener noreferrer"
            >问题反馈 ${externalArrow}</a
          >
        </nav>
      </div>
    </div>
    <article class="desktop-card">
      <h2>快捷操作</h2>
      <dl class="app-shortcuts">
        ${(isMobile
          ? [
              ['轻点画面', '推进对白'],
              ['长按画面', '快速播放'],
              ['长按后上下滑动', '切换倍速'],
              ['系统返回', '返回或关闭弹窗'],
            ]
          : [
              ['Ctrl / ⌘ + K', '搜索剧情'],
              ['双击剧情', '直接播放'],
              ['空格', '推进对白'],
              ['按住 Ctrl', '32× 快进'],
              ['A', '切换自动播放'],
              ['F10', '窗口全屏'],
              ['Esc', '返回或取消'],
            ]
        )
          .map(([action, description]) => `<div><dt>${action}</dt><dd>${description}</dd></div>`)
          .join('')}
      </dl>
    </article>
    <div class="app-guide">
      <article class="desktop-card">
        <h2>阅读与回顾</h2>
        <h3>继续阅读</h3>
        <p>历史记录保留最高阅读进度。再次打开剧情时，可继续阅读或从头播放。</p>
        <h3>回到某一段</h3>
        <p>点击 LOG 中的台词，或展开“剧情脚本”选择对应行，即可跳转。</p>
        <h3>分享剧情</h3>
        <p>播放器设置中的“复制剧情链接”可生成分享链接，对方可在网页中打开同一段剧情。</p>
      </article>
      <article class="desktop-card">
        <h2>缓存与声音</h2>
        <h3>提前缓存</h3>
        <p>在剧情目录缓存单段，或前往“缓存”批量下载。已缓存的剧情可离线阅读。</p>
        <h3>分开调节音量</h3>
        <p>“声音”页可分别调节界面音效、主页音乐和剧情播放音量。</p>
        <h3>本地记录</h3>
        <p>
          ${isWeb ? '收藏、阅读记录和资源保存在当前浏览器中。清除网站数据会将它们一并删除。' : '资料库与阅读记录保存在系统用户目录，更新或替换程序不会清除它们。'}
        </p>
      </article>
    </div>
    <article class="desktop-card">
      <h2>关于项目</h2>
      <p>由 djkcyl 开发维护。游戏资源来自官方公开资源及 PRTS 镜像，无需安装游戏或登录账号。</p>
      <p>
        遇到问题时，请在 GitHub 反馈中附上应用版本、设备与浏览器、剧情名称，以及出现问题的位置。
      </p>
    </article>
    <p class="desktop-fineprint">非官方项目。剧情、图像与音频版权归原权利人所有。</p>`;
  const notice = document.createElement('p');
  notice.id = 'resource-message';
  notice.className = 'desktop-toast';
  notice.setAttribute('role', 'status');
  notice.hidden = true;
  header.after(resources, audioPage.root, about);
  if (downloads) header.after(downloads.root);
  document.getElementById('app')!.append(notice);
  const versions = new VersionNotice(resources, () => show('resources'));
  mountResourceSource(
    resources
      .querySelector('.desktop-page-heading')!
      .insertAdjacentElement('afterend', document.createElement('div'))!,
  );
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  let busy = false,
    poll: ReturnType<typeof setTimeout> | undefined,
    jobRunning = false,
    scanBusy = false,
    refreshGeneration = 0,
    noticeTimer: ReturnType<typeof setTimeout> | undefined;
  function message(value: string, error = false) {
    clearTimeout(noticeTimer);
    notice.textContent = value;
    notice.hidden = !value;
    notice.classList.toggle('is-error', error);
    if (value && !error) noticeTimer = setTimeout(() => (notice.hidden = true), 5000);
  }
  function controls() {
    for (const button of resources.querySelectorAll<HTMLButtonElement>('[data-resource-action]'))
      button.disabled = busy || jobRunning;
    $<HTMLButtonElement>('resource-refresh').disabled = scanBusy;
  }
  function show(page: 'library' | 'resources' | 'audio' | 'about' | 'downloads') {
    if (page === 'downloads' && !downloads) return;
    const previous = document.body.dataset.desktopPage;
    if (page === previous) {
      if (page === 'library' && document.body.matches('.playing,.resource-loading'))
        options.leave();
      return;
    }
    let resume: (() => void) | undefined;
    if (previous === 'audio' && resumeAudioPage) {
      if (page === 'library') resume = resumeAudioPage;
      else options.leave();
      resumeAudioPage = undefined;
    } else if (page === 'audio' && document.body.matches('.playing:not(.resource-loading)')) {
      resumeAudioPage = options.suspendForAudio();
    } else if (document.body.matches('.playing,.resource-loading')) options.leave();
    document.body.dataset.desktopPage = page;
    if (isWeb) {
      const url = new URL(location.href);
      if (page === 'downloads') url.searchParams.set('page', 'downloads');
      else url.searchParams.delete('page');
      history.replaceState(history.state, '', url);
    }
    resources.hidden = page !== 'resources';
    about.hidden = page !== 'about';
    audioPage.root.hidden = page !== 'audio';
    if (downloads) downloads.root.hidden = page !== 'downloads';
    audioPage.setPlaying(!!resumeAudioPage);
    for (const button of rail.querySelectorAll('button')) {
      if (button.dataset.page === page) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    }
    window.scrollTo(0, 0);
    resume?.();
    if (page === 'audio') audioPage.focus();
    if (page === 'resources') void refresh();
  }
  document.addEventListener('arkreader-show-library', () => show('library'));
  if (initialDownloads) show('downloads');
  for (const button of rail.querySelectorAll<HTMLButtonElement>('button[data-page]'))
    button.onclick = () =>
      show(button.dataset.page as 'library' | 'resources' | 'audio' | 'about' | 'downloads');
  function displayStatus(data: Status) {
    versions.update(data.resourceUpdate);
    $('storage-stories').textContent = data.storyPlayerScripts.toLocaleString();
    $('storage-version').textContent = data.version ? `版本 ${data.version}` : '尚未建立目录';
    jobRunning = data.job.running;
    controls();
  }
  async function monitor(): Promise<void> {
    clearTimeout(poll);
    try {
      const data = await resourceRequest<Status>('/api/status');
      displayStatus(data);
      if (data.job.running) poll = setTimeout(() => void monitor(), 500);
    } catch (error) {
      message(String(error), true);
    }
  }
  function displayStorage(data: Storage) {
    displayStatus(data);
    displayPath(data.dataPath);
    $('storage-original').textContent = formatBytes(data.originalBytes);
    $('storage-temp').textContent = formatBytes(data.temporaryBytes);
    $('storage-startup').textContent = '启动缓存：' + formatBytes(data.startupBytes);
    $('storage-files').textContent =
      data.originalFiles === null
        ? '点击“刷新占用”统计'
        : `${data.originalFiles.toLocaleString()} 个缓存文件`;
  }
  async function refresh() {
    const generation = ++refreshGeneration;
    try {
      const data = await resourceRequest<Storage>('/api/storage?scan=false');
      if (generation !== refreshGeneration) return;
      displayStorage(data);
      await monitor();
      if (!data.scanned) void scan();
    } catch (error) {
      message(String(error), true);
    }
  }
  async function scan() {
    if (scanBusy) return;
    scanBusy = true;
    controls();
    try {
      displayStorage(await resourceRequest<Storage>('/api/storage'));
    } catch (error) {
      message(String(error), true);
    } finally {
      scanBusy = false;
      controls();
    }
  }
  async function action(work: () => Promise<void>) {
    if (busy) return;
    busy = true;
    controls();
    message('');
    try {
      await work();
    } catch (error) {
      message(String(error).replace(/^Error: /, ''), true);
    } finally {
      busy = false;
      controls();
      await refresh();
    }
  }
  $('resource-refresh').onclick = () => void scan();
  $('resource-open').onclick = () =>
    void desktop.openLibrary().catch((error) => message(String(error), true));
  if (isMobile || isWeb) $('resource-open').closest('article')?.setAttribute('hidden', '');
  document.addEventListener('arkreader-cache-finished', () => void scan());
  document.addEventListener('arkreader-storage-error', (event) =>
    message(String((event as CustomEvent).detail), true),
  );
  $('resource-clear').onclick = () =>
    void action(async () => {
      if (
        !(await confirmAction(
          '清理缓存？',
          '清理后，启动和播放需要重新准备。\n已下载资源、收藏和阅读记录会保留。',
          '清理',
        ))
      )
        return;
      await resourceRequest('/api/cache/clear', {});
      await options.reload();
      await scan();
      message('缓存已清理，已下载资源与阅读记录已保留。');
    });
  function displayPath(path: string) {
    const field = $<HTMLInputElement>('storage-path');
    field.value = path.replace(/^\\\\\?\\/, '');
    field.title = field.value;
  }
  void desktop
    .info()
    .then((info) => {
      $('desktop-version').textContent = 'v' + info.version;
      $('rail-version').textContent = 'v' + info.version;
      displayPath(info.library);
      if (info.displayRecovery) message(info.displayRecovery);
    })
    .catch((error) => message(String(error), true));
  void resourceRequest<Status>('/api/status')
    .then(displayStatus)
    .catch((error) => message(String(error), true));
}
