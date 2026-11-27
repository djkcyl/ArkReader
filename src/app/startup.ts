import { appInvoke as invoke } from './platform';
import { mountResourceSource } from './resource-source';
import { mountWindowChrome } from './window-chrome';
import { resourceLabel, transferSpeed } from './transfer-labels';
import type { TransferSummary } from './resource-api';
import { prtsCursor } from './prts-cursor';
import { musicSettings, saveMusicSettings, prepareStartupMusic } from './home-music-source';
import { preloadStartupMusic, clearStartupMusic } from './home-music-boot';
import { mountMobilePlatform } from './mobile';
import { isMobile, isWeb } from './platform';
import './mobile.css';

mountMobilePlatform();
mountResourceSource(document.querySelector('.startup-loading')!);
const footerLabel = document.querySelector('#startup-root > footer')?.firstChild;
if (isMobile && !isWeb && footerLabel) footerLabel.textContent = 'ARKREADER · ANDROID ';

declare global {
  interface Window {
    startupError: (message: unknown) => void;
  }
}
interface Progress {
  error?: string;
  message?: string;
  elapsed: number;
  phase: string;
  state?: string;
  overallProgress?: number;
  resource?: string;
  transfers?: TransferSummary;
  done?: number;
  total?: number;
  running?: boolean;
  skinReady?: boolean;
  cursorReady?: boolean;
  resourcesReady?: boolean;
  navigating?: boolean;
  versionNotice?: string;
}
let disposeChrome = mountWindowChrome(document.querySelector<HTMLElement>('.startup-titlebar')!);
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
let timer: ReturnType<typeof setTimeout> | undefined,
  generation = 0,
  progress = 0,
  entered = false;
let musicAbort: AbortController | undefined,
  preparingMusic = false;
const cursor = prtsCursor();
const versionNote = document.createElement('p');
versionNote.id = 'startup-version-notice';
versionNote.hidden = true;
versionNote.style.cssText = 'font-size:12px;line-height:1.7;color:#d6b97d;margin:12px 0';
$('status').after(versionNote);
window.startupError = (message) => {
  clearTimeout(timer);
  document.body.dataset.state = 'failed';
  $('startup-heading').textContent = '启动准备未完成';
  $('status').textContent = '已下载的资源会保留，重试会继续准备。';
  $('startup-error').textContent = String(message).replace(/^Error: /, '');
  $('startup-details').hidden = false;
  $('retry').hidden = false;
  $('retry').textContent = '重试';
  $('cancel').hidden = true;
  $('skip-music').hidden = !preparingMusic;
};
function render(value: Progress) {
  if (isWeb && (value.transfers?.downloadedBytes ?? 0) > 0)
    document.body.classList.remove('web-restoring');
  versionNote.textContent = value.versionNotice ?? '';
  versionNote.hidden = !value.versionNotice;
  if (value.cursorReady) void cursor.load().catch((error) => console.warn(String(error)));
  if (value.skinReady) document.body.classList.add('native-skin');
  $('elapsed').textContent = value.elapsed > 0 ? `${value.elapsed.toFixed(1)} 秒` : '';
  if (value.error) {
    window.startupError(value.error);
    return false;
  }
  const paused = value.state === 'cancelled',
    cancelling = value.state === 'cancelling';
  document.body.dataset.state = paused ? 'paused' : cancelling ? 'cancelling' : 'loading';
  $('startup-heading').textContent = paused
    ? '准备已暂停'
    : document.body.classList.contains('web-restoring')
      ? '正在打开剧情库'
      : '正在准备剧情档案';
  $('status').textContent = paused ? '下载进度已保留，可继续准备。' : value.message || '正在启动…';
  progress = Math.max(progress, 0.9 * Math.min(1, value.overallProgress ?? 0));
  $<HTMLProgressElement>('startup-progress').value = progress;
  $('percent').textContent = `${Math.floor(progress * 100)}%`;
  const order: Record<string, number> = {
    process: 0,
    cache: 0,
    engine: 0,
    library: 0,
    queue: 0,
    connect: 0,
    index: 0,
    download: 0,
    'base-plan': 1,
    'ui-download': 1,
    ui: 2,
    'base-download': 3,
    catalog: 3,
    'base-verify': 3,
    ready: 3,
  };
  const step = order[value.phase] ?? 0;
  document.querySelectorAll('#startup-steps li').forEach((el, i) => {
    el.classList.toggle('active', i === step);
    el.classList.toggle('done', i < step);
  });
  $('current-resource').textContent = value.resource ? resourceLabel(value.resource) : '';
  $('current-resource').title = value.resource ?? '';
  const transfer = value.transfers;
  $('transfer-detail').textContent = transfer?.totalFiles
    ? `资源 ${transfer.readyFiles} / ${transfer.totalFiles} · 已缓存 ${transfer.cachedFiles} 个`
    : '';
  $('transfer-speed').textContent = transfer?.activeDownloads
    ? `${transferSpeed(transfer.bytesPerSecond)} · ${(transfer.downloadedBytes / 1048576).toFixed(1)} MB · ${transfer.activeDownloads} 路下载`
    : value.phase === 'catalog'
      ? `封面 ${value.done ?? 0} / ${value.total ?? 0}`
      : transfer?.totalFiles
        ? '正在校验与准备本次运行资源'
        : '';
  $('retry').hidden = !paused;
  $('retry').textContent = '继续准备';
  $('cancel').hidden = !value.running;
  $<HTMLButtonElement>('cancel').disabled = cancelling;
  return !paused;
}
async function poll(run = generation) {
  try {
    const value = await invoke<Progress>('app_startup_progress');
    if (run !== generation) return;
    if (!render(value)) return;
    if (value.resourcesReady) {
      if (!entered) {
        entered = true;
        await enterLibrary(run);
      }
      return;
    }
    timer = setTimeout(() => void poll(run), 250);
  } catch (error) {
    if (run === generation) window.startupError(error);
  }
}
async function enterLibrary(run: number) {
  const controller = new AbortController();
  musicAbort = controller;
  preparingMusic = musicSettings().enabled;
  const began = performance.now(),
    elapsed = Number.parseFloat($('elapsed').textContent ?? '') || 0;
  const ticker = setInterval(() => {
    $('elapsed').textContent = `${(elapsed + (performance.now() - began) / 1000).toFixed(1)} 秒`;
  }, 250);
  $('cancel').hidden = true;
  $('skip-music').hidden = !preparingMusic;
  if (preparingMusic) {
    $('status').textContent = '准备主页音乐…';
    $('current-resource').textContent = '读取已选曲目';
    $('transfer-detail').textContent = '';
    $('transfer-speed').textContent = '';
    document.querySelectorAll('#startup-steps li').forEach((el, i) => {
      el.classList.toggle('active', i === 4);
      el.classList.toggle('done', i < 4);
    });
  }
  try {
    const payload = await prepareStartupMusic(controller.signal, (value) => {
      if (run !== generation || controller.signal.aborted) return;
      progress = Math.max(progress, 0.9 + 0.08 * (value.overallProgress ?? 0));
      $<HTMLProgressElement>('startup-progress').value = progress;
      $('percent').textContent = `${Math.floor(progress * 100)}%`;
      $('status').textContent = value.message;
      $('current-resource').textContent = value.resource ?? '';
      const t = value.transfers;
      $('transfer-detail').textContent = t?.totalFiles
        ? `资源 ${t.readyFiles}/${t.totalFiles}`
        : '';
      $('transfer-speed').textContent = t?.activeDownloads ? transferSpeed(t.bytesPerSecond) : '';
    });
    if (run !== generation || controller.signal.aborted) return;
    if (payload.pack) {
      $('status').textContent = '准备音乐播放…';
      $('current-resource').textContent = payload.pack.name;
    }
    await preloadStartupMusic(payload, controller.signal, (done, total) => {
      progress = Math.max(progress, 0.98 + 0.015 * (total ? done / total : 1));
      $<HTMLProgressElement>('startup-progress').value = progress;
      $('percent').textContent = `${Math.floor(progress * 100)}%`;
    });
    if (run !== generation || controller.signal.aborted) {
      clearStartupMusic();
      return;
    }
    progress = 0.995;
    $<HTMLProgressElement>('startup-progress').value = progress;
    $('percent').textContent = '99%';
    $('status').textContent = '打开剧情库…';
    $('skip-music').hidden = true;
    await invoke('app_startup_ready');
  } catch (error) {
    if (run === generation && !controller.signal.aborted) {
      entered = false;
      window.startupError(error);
    }
  } finally {
    clearInterval(ticker);
  }
}
async function retryStartup() {
  musicAbort?.abort();
  clearStartupMusic();
  preparingMusic = false;
  const run = ++generation;
  clearTimeout(timer);
  progress = 0;
  entered = false;
  $('retry').hidden = true;
  $('skip-music').hidden = true;
  $('startup-details').hidden = true;
  document.body.dataset.state = 'loading';
  $('startup-heading').textContent = '继续准备剧情档案';
  try {
    await invoke('app_retry');
    if (run === generation) void poll(run);
  } catch (error) {
    window.startupError(error);
  }
}
$('retry').onclick = () => void retryStartup();
const sourceChanged = () => void retryStartup();
document.addEventListener('arkreader-resource-source-changed', sourceChanged);
$('skip-music').onclick = () => {
  saveMusicSettings({ ...musicSettings(), enabled: false });
  void retryStartup();
};
$('cancel').onclick = async () => {
  const run = ++generation;
  clearTimeout(timer);
  $<HTMLButtonElement>('cancel').disabled = true;
  $('status').textContent = '正在停止准备，已下载的资源会保留…';
  try {
    await invoke('app_cancel_startup');
    if (run === generation) void poll(run);
  } catch (error) {
    window.startupError(error);
  }
};
$('quit').onclick = () => void invoke('app_quit').catch(window.startupError);
document.addEventListener('arkreader-before-close', () => musicAbort?.abort());
window.addEventListener('pagehide', () => {
  musicAbort?.abort();
  clearStartupMusic();
});
document.addEventListener('arkreader-startup-finished', () => {
  document.removeEventListener('arkreader-resource-source-changed', sourceChanged);
  clearTimeout(timer);
  musicAbort = undefined;
  disposeChrome();
  disposeChrome = () => {};
  versionNote.remove();
});
let opening = false;
window.addEventListener('arkreader-open-main', (event) => {
  if (opening) return;
  opening = true;
  const { epoch, version } = (event as CustomEvent<{ epoch: number; version: string }>).detail;
  if (isWeb) {
    const url = new URL(location.href);
    url.searchParams.set('boot', String(epoch));
    url.searchParams.set('v', version);
    history.replaceState(history.state, '', url);
  } else history.replaceState(null, '', `/?boot=${epoch}&v=${encodeURIComponent(version)}`);
  document.dispatchEvent(new CustomEvent('arkreader-main-loading', { detail: { epoch } }));
  void import('../main').catch((error) => {
    clearStartupMusic();
    void invoke('app_ui_failed', { message: String(error), epoch });
  });
});
void poll();
