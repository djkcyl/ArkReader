import { HistoryView } from './player/history-view';
import { audioLevels } from './app/audio-levels';
import { ScriptView } from './player/script-view';
import { SkipView } from './player/skip-view';
import { StoryVideo } from './player/video';
import './style.css';
import './player/normal-toolbar.css';
import './player/native-selectable.css';
import { StoryPlayer, type Pack } from './player/runtime';
import { StoryAudio } from './player/audio';
import { StageRenderer } from './player/renderer';
import { CatalogView, type CatalogData } from './player/catalog-view';
import { renderChoices } from './player/choices';
import { dialogPresets } from './core/dialog-presets';
import { QuickPress } from './core/quick-play';
import { KeyboardQuickPlay } from './player/keyboard-quick-play';
import { QuickPanel } from './player/quick-panel';
import { QuickNoticeView } from './player/quick-notice';
import { ReaderView } from './player/reader-view';
import { ReaderToolbar } from './player/reader-toolbar';
import { ReaderSettingsView } from './player/reader-settings-view';
import { NativeSelectableSurface } from './player/native-selectable';
import { NativeNavigation } from './player/native-navigation';
import { StoryBackInput } from './player/story-back-input';
import { topNativeDialog } from './player/native-dialogs';
import { StandaloneStoryHost } from './player/standalone-story-host';
import { unsupportedStandaloneHostCommands } from './core/story-host-requirements';
import { parseScript } from './core/parser';
import { StageFullscreen } from './player/stage-fullscreen';
import { fitStageDialog, stagePoint } from './player/stage-geometry';
import { FloatingProgress } from './player/floating-progress';
import { requirePackResources } from './core/pack-resources';
import './player/page-frame.css';
import { isNative, isMobile, isWeb, setDesktopPlaying } from './app/platform';
import { mountMobilePlatform } from './app/mobile';
import { mountDesktopShell } from './app/desktop-shell';
import { ResumePrompt } from './app/resume-prompt';
import { prepareRemoteStory } from './app/resource-api';
import { LoadingView } from './app/loading-view';
import { ReadingShelf } from './app/reading-shelf';
import './app/library-layout.css';
import './app/reading-progress.css';
import './app/topic-catalog.css';
import './app/playback-surface.css';
import { mountPlaybackSettings } from './player/playback-settings-view';
import { loadWidgetProfile, NativePrompt, NativeVolumeSlider } from './player/native-widgets';
import { installSettingsWidgets } from './player/native-settings-widgets';
import { setControlLabel } from './player/control-label';
import { prtsCursor } from './app/prts-cursor';
import { InterfaceAudio, mountInterfaceSounds } from './app/interface-audio';
import { StoryCacheView } from './app/story-cache-view';
import { inspectScript, ScriptCompatibilityError } from './core/script-compatibility';
import { restorePosition, RestoringVideo, type PlaybackTarget } from './player/restore-position';
import { RestoringAudio } from './player/restoring-audio';
import { adoptStartupMusic } from './app/home-music-boot';
import { invoke } from '@tauri-apps/api/core';
import './app/mobile.css';
import { mountApplicationControls, syncApplicationControl } from './app/native-controls';
import { copyStoryLink, storyShareUrl } from './app/story-share';

if (isNative && !document.getElementById('startup-root')) {
  await invoke('app_retry');
  await new Promise(() => {});
}
const startupMusic = isNative || isWeb ? adoptStartupMusic() : undefined;
if (document.getElementById('startup-root')) {
  document.dispatchEvent(new Event('arkreader-startup-finished'));
  document.getElementById('startup-root')!.remove();
  document.getElementById('startup-style')?.remove();
  document.body.classList.remove('startup-page', 'native-skin');
  delete document.body.dataset.state;
  const app = document.createElement('div');
  app.id = 'app';
  document.body.append(app);
}

document.querySelector<HTMLDivElement>('#app')!.innerHTML = /* HTML */ ` <header class="brand">
    <a href="./">ARK<span>READER</span></a
    ><span class="subtitle">明日方舟 · 剧情播放器</span
    ><span class="connection" id="connection">连接资源库</span>
  </header>
  <main>
    <section id="intro" class="intro">
      <div class="story-select"></div>
      <div class="start-row">
        <button class="primary" id="start" disabled>开始播放 <span>▶</span></button
        ><label
          >博士称呼 <input id="nickname" value="博士" maxlength="24" aria-label="博士称呼"
        /></label>
      </div>
      <p class="hint">点击画面或按空格推进 · 首次点击补全文字，再次点击继续</p>
      <div id="loading" role="status"></div>
    </section>
    <section id="player-panel" hidden>
      <div class="playback-heading">
        <div class="playback-heading-top">
          <button id="leave-story">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 6-6 6 6 6M8 12h13" /></svg
            >返回剧情目录</button
          ><span class="playback-location">剧情档案 <span aria-hidden="true">/</span> 正在播放</span
          ><button id="script-toggle" type="button">剧情脚本</button
          ><span class="playback-clock"
            ><span class="playback-clock-label">播放时间</span
            ><span id="position" aria-label="播放时间"></span
          ></span>
        </div>
        <div class="chapterbar">
          <span class="playback-caption"
            >STORY ARCHIVE <span aria-hidden="true">/</span> 剧情回顾</span
          >
          <h1 id="chapter-title"></h1>
        </div>
      </div>
      <div class="playback-surface" id="playback-surface">
        <div class="playback-frame">
          <div class="stage" id="stage">
            <div class="viewport">
              <canvas id="canvas" aria-label="剧情演出画面" tabindex="0"></canvas>
              <nav class="controls" aria-label="播放控制">
                <button id="skip">跳过</button><button id="log">回顾</button
                ><button id="settings" aria-haspopup="dialog">设置</button
                ><button id="auto" aria-pressed="false">自动</button
                ><button id="auto-speed" hidden aria-label="切换自动播放速度">1×</button
                ><button id="pause">暂停</button><button id="hide">隐藏界面</button
                ><button id="full">全屏</button>
              </nav>
              <div id="choices" class="choices" aria-label="剧情选项"></div>
              <div id="quick-play" class="quick-play" hidden></div>
              <div id="paused" class="overlay" hidden>
                <h2>已暂停</h2>
                <button id="resume">继续播放</button>
              </div>
              <div id="ended" class="overlay" hidden>
                <div class="eyebrow">STORY COMPLETE</div>
                <h2>本段剧情结束</h2>
                <p id="ended-title">播放完毕</p>
                <button id="restart" class="primary">重新播放</button
                ><button id="library">选择其他剧情</button>
              </div>
              <div id="error" class="overlay" hidden role="alert">
                <p id="playback-error-message"></p>
                <button id="error-library">返回剧情库</button
                ><button id="error-retry">重新尝试</button>
              </div>
            </div>
          </div>
        </div>
        <p id="accessible-dialog" class="sr-only" aria-live="polite"></p>
        <div class="playback-footer">
          <p class="footnote" id="story-note"></p>
          <div class="playback-progress">
            <label for="playback-seek">剧情进度 <output id="playback-percent">0%</output></label
            ><input
              id="playback-seek"
              type="range"
              min="0"
              max="100"
              step="1"
              value="0"
              aria-label="跳转剧情进度"
              title="点击或拖动跳转；遇到未记录的分支时暂停"
            /><span id="playback-seek-status" role="status"></span>
          </div>
        </div>
      </div>
    </section>
    <dialog id="history">
      <div class="dialog-heading">
        <h2>剧情回顾</h2>
        <button id="close-log">返回剧情 ×</button>
      </div>
      <div id="history-list"></div>
    </dialog>
    <dialog id="reading-settings" aria-labelledby="settings-title">
      <div class="dialog-heading">
        <h2 id="settings-title">剧情设置</h2>
        <button id="close-settings">返回剧情 ×</button>
      </div>
      <fieldset>
        <legend>对白字号</legend>
        ${dialogPresets.map((p) => `<label><input type="radio" name="dialog-size" value="${p.id}">${p.label}</label>`).join('')}
      </fieldset>
    </dialog>
    <dialog id="skip-confirm">
      <div class="dialog-heading">
        <h2>跳过剧情</h2>
        <button id="cancel-skip">继续阅读 ×</button>
      </div>
      <p id="skip-summary"></p>
      <button id="confirm-skip" class="primary">确认跳过</button>
    </dialog>
  </main>
  <footer>ARKREADER <span>原版资源 · 本地播放</span></footer>`;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const scriptView = new ScriptView(
  $('playback-surface'),
  $<HTMLButtonElement>('script-toggle'),
  (commandIndex) => {
    if (!player || loading) return;
    interfaceAudio.play('normal.log-back');
    void start({ commandIndex, position: player.replayPosition });
  },
);
void prtsCursor()
  .load()
  .catch((error) => console.warn(String(error)));
const interfaceAudio = new InterfaceAudio();
mountInterfaceSounds(interfaceAudio);
void interfaceAudio.load().catch((error) => console.warn(String(error)));
document.addEventListener('arkreader-resource-idle', () => {
  void interfaceAudio.load().catch((error) => console.warn(String(error)));
});
const playbackSettings = mountPlaybackSettings($<HTMLDialogElement>('reading-settings'));
$('playback-surface').append($('reading-settings'));
const loadingView = new LoadingView();
const resumePrompt = new ResumePrompt();
let pendingPlayback: { story: string; controller: AbortController } | undefined;
const selectedCaption = document.createElement('p');
selectedCaption.id = 'selected-story-caption';
selectedCaption.hidden = true;
document.querySelector('#intro .start-row')!.prepend(selectedCaption);
document.addEventListener('catalog-selection', (event) => {
  const detail = (event as CustomEvent).detail;
  selectedCaption.textContent = detail.label ?? '';
  selectedCaption.hidden = !detail.label;
});
try {
  $<HTMLInputElement>('nickname').value = localStorage.getItem('arkreader.nickname') ?? '博士';
} catch {}
$<HTMLInputElement>('volume').value = String(audioLevels.get('player'));
$('nickname').addEventListener('change', () => {
  try {
    localStorage.setItem('arkreader.nickname', $<HTMLInputElement>('nickname').value);
  } catch {}
});
const browserControls = playbackSettings.querySelector('.browser-controls')!;
const windowFull = document.createElement('button');
windowFull.id = 'window-full';
windowFull.title = '窗口全屏（F10）';
browserControls.append(windowFull, $('full'));
playbackSettings.querySelector('.playback-pause-slot')!.append($('pause'));
const stageFullscreen = new StageFullscreen(
  $('playback-surface'),
  $<HTMLButtonElement>('full'),
  windowFull,
);
new FloatingProgress(
  $('playback-surface'),
  document.querySelector<HTMLElement>('.playback-footer')!,
);
let volumeSlider: NativeVolumeSlider | undefined;
let player: StoryPlayer | undefined,
  audio: StoryAudio | undefined,
  renderer: StageRenderer | undefined;
let sharedGesturePending = false;
let storyHost: StandaloneStoryHost | undefined;
audioLevels.subscribe((channel, value) => {
  if (channel !== 'player') return;
  $<HTMLInputElement>('volume').value = String(value);
  volumeSlider?.sync();
  audio?.setVolume(value / 100);
});
const hostBoundary = document.createElement('dialog');
hostBoundary.id = 'story-host-boundary';
hostBoundary.setAttribute('aria-labelledby', 'host-boundary-title');
hostBoundary.innerHTML =
  '<h2 id="host-boundary-title">即将进入战斗</h2><p>战斗部分不在回放中，继续阅读后续剧情。</p><button id="host-continue" class="primary">继续剧情</button><button id="host-leave">返回剧情库</button>';
document.querySelector('main')!.append(hostBoundary);
hostBoundary.addEventListener('cancel', (event) => event.preventDefault());
$('error-library').onclick = () => returnToLibrary();
$('error-retry').onclick = () => void start();
async function prepareNativeWidgets(signal: AbortSignal) {
  const [profile] = await Promise.all([loadWidgetProfile(signal), interfaceAudio.load()]);
  signal.throwIfAborted();
  if (volumeSlider) return;
  installSettingsWidgets($<HTMLDialogElement>('reading-settings'), profile.settings);
  volumeSlider = new NativeVolumeSlider($<HTMLInputElement>('volume'), profile.volume);
  const pauseContent = document.createElement('div');
  pauseContent.append($('paused').querySelector('h2')!);
  new NativePrompt($('paused'), profile.dialogs.ok, pauseContent, $<HTMLButtonElement>('resume'));
  const endContent = document.createElement('div');
  endContent.append($('ended').querySelector('h2')!, $('ended-title'));
  new NativePrompt(
    $('ended'),
    profile.dialogs.judge,
    endContent,
    $<HTMLButtonElement>('restart'),
    $<HTMLButtonElement>('library'),
  );
  const errorContent = document.createElement('div');
  errorContent.append($('playback-error-message'));
  new NativePrompt(
    $('error'),
    profile.dialogs.judge,
    errorContent,
    $<HTMLButtonElement>('error-retry'),
    $<HTMLButtonElement>('error-library'),
  );
  const hostContent = document.createElement('div');
  hostContent.append($('host-boundary-title'), hostBoundary.querySelector('p')!);
  new NativePrompt(
    hostBoundary,
    profile.dialogs.judge,
    hostContent,
    $<HTMLButtonElement>('host-continue'),
    $<HTMLButtonElement>('host-leave'),
  );
  const fit = () => {
    fitStageDialog(hostBoundary, $('stage'));
  };
  new ResizeObserver(fit).observe($('stage'));
  window.addEventListener('resize', fit);
  window.addEventListener('playback-screen-mode', fit);
  window.addEventListener('scroll', fit, { passive: true });
  fit();
}
$('host-continue').onclick = () => {
  if (!player || !storyHost?.continueBattle(player)) return;
  hostBoundary.close();
  player.tick(0);
  if (player.atEnd) player.advance();
  sync();
};
$('host-leave').onclick = () => returnToLibrary();
let lastFrame = 0,
  hiddenUI = false,
  normalAutoBeforeHide = false;
let loading: AbortController | undefined;
let lastChoices = '';
let lastDialog = '';
let autoBeforeSettings = false;
const readerButton = document.createElement('button');
readerButton.id = 'reader-mode';
readerButton.textContent = '阅读模式';
$('log').after(readerButton);
const readerSurface = document.createElement('div');
readerSurface.id = 'reader-view';
readerSurface.className = 'reader-view';
readerSurface.hidden = true;
readerSurface.setAttribute('aria-label', '剧情阅读');
$('canvas').after(readerSurface);
function jumpToReview(cell: { text: string }): void {
  if (!player || loading) return;
  const position = player.reviewPosition(cell);
  if (position) {
    interfaceAudio.play('normal.log-back');
    void start({ position, review: true });
  }
}
const readerView = new ReaderView(readerSurface, jumpToReview);
const nativeNavigation = new NativeNavigation(
  $('stage'),
  () => !!player && !player.finished && !player.paused && !player.error,
);
const storyBackInput = new StoryBackInput(
  (event) => {
    if (!player) return false;
    const target = event.target;
    // The chapter search and other page text inputs are outside the story UI.
    if (
      target instanceof HTMLElement &&
      !target.closest('#stage,dialog') &&
      (target.isContentEditable || target.matches('input,textarea,select'))
    )
      return false;
    return true;
  },
  () => {
    let layer: string | undefined;
    const modal = topNativeDialog();
    if (modal) {
      layer = modal.id;
      // Existing native views retain their fade/auto-resume lifecycle. A closing
      // layer still consumes back until it is removed, preventing fall-through.
      if (modal.dispatchEvent(new Event('cancel', { cancelable: true }))) modal.close();
    } else if (stageFullscreen.active) {
      layer = 'fullscreen';
      void stageFullscreen.exit();
    } else if (
      player &&
      !player.paused &&
      !player.finished &&
      !player.error &&
      !player.theaterMode
    ) {
      if (hiddenUI) {
        layer = 'hidden-ui';
        setHiddenUI(false);
      } else if (player.readerVisible) {
        layer = 'reader';
        skipView.show(player);
      }
    }
    $('stage').dispatchEvent(
      new CustomEvent('native-story-back', { detail: { layer: layer ?? null } }),
    );
  },
);
const readerSelectable = new NativeSelectableSurface(
  $('stage'),
  '.controls button,.reader-live-decision button',
  () => !$('stage').classList.contains('clean'),
  (el) =>
    el.closest('.reader-live-decision')
      ? [{ element: el }]
      : ($('stage').classList.contains('reader-active')
            ? ['auto', 'auto-speed', 'skip']
            : ['auto', 'auto-speed', 'skip', 'log', 'hide', 'settings', 'reader-mode']
          ).includes(el.id)
        ? [
            { element: el, pseudo: '::before' },
            ...(el.id === 'auto-speed' ? [{ element: el, pseudo: '::after' }] : []),
          ]
        : [],
);
let historyView: HistoryView;
const readerToolbar = new ReaderToolbar($('auto'), $('auto-speed'));
const normalToolbar = new ReaderToolbar($('auto'), $('auto-speed'));
readerButton.onclick = () => {
  if (player) {
    player.setReaderMode(!player.readerMode);
    sync();
  }
};
function selectQuickSpeed(index: number): void {
  if (keyboardQuick.active) return;
  if (!player?.quickPlay || index === player.quickSpeedIndex) return;
  player.setQuickSpeed(index);
  try {
    localStorage.setItem('arkreader.quickSpeed', String(player.quickSpeedIndex));
  } catch {
    /* Storage is optional. */
  }
  sync();
}
let quickPanel: QuickPanel;
const quickNoticeRoot = document.createElement('div');
$('canvas').parentElement!.append(quickNoticeRoot);
const quickNotice = new QuickNoticeView(quickNoticeRoot);
const quickPress = new QuickPress(
  () => player?.beginQuickPlay() ?? false,
  () => player?.endQuickPlay(),
  (direction) => {
    if (player) selectQuickSpeed(Math.max(0, Math.min(3, player.quickSpeedIndex + direction)));
  },
);
const keyboardQuick = new KeyboardQuickPlay(
  () => player,
  () =>
    !!player?.canQuickPlay &&
    !loading &&
    !hiddenUI &&
    !document.hidden &&
    !document.activeElement?.closest('#script-panel') &&
    !document.querySelector('dialog[open]'),
  cancelGesture,
);
let pressPointer: number | null = null,
  suppressPointerClickUntil = 0;

function releasePlayback(): Promise<void> {
  sharedGesturePending = false;
  scriptView.clear();
  saveReadingProgress();
  readingShelf.flush();
  hostBoundary.close();
  storyHost?.dispose();
  storyHost = undefined;
  nativeNavigation.clear();
  storyBackInput.clear();
  skipView.clear();
  cancelGesture();
  keyboardQuick.cancel();
  quickNotice.clear();
  renderChoices($('choices'), [], () => {});
  const oldAudio = audio;
  player?.dispose();
  renderer?.dispose();
  player = undefined;
  renderer = undefined;
  audio = undefined;
  return oldAudio?.close() ?? Promise.resolve();
}

function prepareStory(story: string, signal: AbortSignal): Promise<Pack> {
  return prepareRemoteStory<Pack>(story, signal, (state) => loadingView.update(state));
}

async function requestPlayback(automatic = false): Promise<void> {
  if (loading || pendingPlayback) return;
  const story = catalogView.selectedId;
  if (!story) return;
  const choice = readingShelf.resume(story);
  if (!choice) {
    await start(undefined, automatic);
    return;
  }
  const controller = new AbortController(),
    request = { story, controller };
  pendingPlayback = request;
  $<HTMLButtonElement>('start').disabled = true;
  try {
    const target = await resumePrompt.ask(
      catalogView.label(story) ?? story,
      choice,
      controller.signal,
    );
    if (target !== null && !controller.signal.aborted && catalogView.selectedId === story)
      await start(target);
  } catch (error) {
    if (!controller.signal.aborted) {
      loadingView.show(catalogView.label(story) ?? story, returnToLibrary);
      loadingView.fail(error, () => void requestPlayback());
    }
  } finally {
    if (pendingPlayback === request) {
      pendingPlayback = undefined;
      $<HTMLButtonElement>('start').disabled = !!loading || !catalogView.selectedId;
    }
  }
}
function cancelPlaybackPrompt() {
  const request = pendingPlayback;
  if (!request) return;
  pendingPlayback = undefined;
  request.controller.abort();
  $<HTMLButtonElement>('start').disabled = !!loading || !catalogView.selectedId;
}
document.addEventListener('catalog-selection', (event) => {
  if (pendingPlayback && (event as CustomEvent).detail.id !== pendingPlayback.story)
    cancelPlaybackPrompt();
});
document.addEventListener('library-tab-changed', cancelPlaybackPrompt);
document.addEventListener('arkreader-reading-preview', (event) => {
  if (pendingPlayback?.story === (event as CustomEvent).detail.id) resumePrompt.refreshPreview();
});
document.addEventListener('arkreader-before-close', cancelPlaybackPrompt);
document.addEventListener(
  'click',
  (event) => {
    if (
      event.target instanceof Element &&
      event.target.closest('.desktop-rail [data-page],#catalog-back')
    )
      cancelPlaybackPrompt();
  },
  true,
);
document.addEventListener(
  'keydown',
  (event) => {
    if (event.key === 'Escape' && pendingPlayback && !resumePrompt.dialog.open) {
      event.preventDefault();
      cancelPlaybackPrompt();
    }
  },
  true,
);

async function start(target?: PlaybackTarget, automatic = false): Promise<void> {
  if (loading) return;
  const request = new AbortController(),
    signal = request.signal;
  loading = request;
  setDesktopPlaying(true);
  const story = catalogView.selectedId;
  if (!story) {
    loading = undefined;
    setDesktopPlaying(false);
    return;
  }
  stageFullscreen.prepareMobile();
  const keepFullscreen =
    !!target &&
    !!player &&
    stageFullscreen.active &&
    typeof loadingView.root.showPopover === 'function';
  loadingView.show(catalogView.label(story) ?? '准备剧情', returnToLibrary, keepFullscreen);
  $('start').setAttribute('disabled', '');
  $('restart').setAttribute('disabled', '');
  $('loading').textContent = '正在准备剧情与音频…';
  let newAudio: StoryAudio | undefined,
    newRenderer: StageRenderer | undefined,
    newPlayer: StoryPlayer | undefined;
  let waitForGesture = false;
  let newHost: StandaloneStoryHost | undefined;
  const preload = new AbortController();
  const cancelResources = () => {
    preload.abort(signal.reason);
    newRenderer?.dispose();
    void newAudio?.close();
  };
  try {
    // The loading surface belongs to the application frame. Leave either
    // fullscreen mode before replaying so it cannot sit behind the stage.
    if (!keepFullscreen && !(isWeb && isMobile)) await stageFullscreen.exit();
    signal.throwIfAborted();
    const releasing = releasePlayback();
    newAudio = new StoryAudio();
    waitForGesture =
      automatic &&
      isWeb &&
      newAudio.context.state !== 'running' &&
      !navigator.userActivation?.hasBeenActive;
    newAudio.setVolume(audioLevels.get('player') / 100);
    signal.addEventListener('abort', cancelResources, { once: true });
    await Promise.all([releasing, waitForGesture ? Promise.resolve() : newAudio.unlock()]);
    signal.throwIfAborted();
    const pack = await prepareStory(story, signal);
    signal.throwIfAborted();
    readingShelf.scriptSource(story, pack);
    const compatibility = inspectScript(pack.script, pack.variables);
    if (compatibility.status === 'unsupported')
      throw new ScriptCompatibilityError({
        ...compatibility,
        resourceVersion: pack.version,
        clientVersion: pack.clientVersion,
      });
    await prepareNativeWidgets(signal);
    // Built-in graphics are downloaded/extracted by profile on a cold library.
    // Construct image-bearing panels only after that request has succeeded.
    historyView ??= new HistoryView(
      $<HTMLDialogElement>('history'),
      $('stage').querySelector<HTMLElement>('.viewport')!,
      $('history-list'),
      $('close-log'),
      jumpToReview,
    );
    quickPanel ??= new QuickPanel($('quick-play'), selectQuickSpeed);
    requirePackResources(pack);
    const external = unsupportedStandaloneHostCommands(parseScript(pack.script, pack.variables));
    if (external.length)
      throw new Error(
        `此剧情需要播放器之外的场景或信号：${external.map((c) => `${c.name}（第 ${c.line} 行）`).join('、')}`,
      );
    newRenderer = new StageRenderer($<HTMLCanvasElement>('canvas'));
    if (newRenderer.desktopGraphics) {
      try {
        newRenderer.highResolutionRT = localStorage.getItem('arkreader.highResRT') !== '0';
      } catch {
        /* Use the desktop high preset. */
      }
    }
    let audioDone = 0,
      rendererDone = 0,
      decodeResource = '';
    const audioTotal = Object.values(pack.assets).filter((a) => a.kind === 'audio').length;
    const decodeProgress = () =>
      loadingView.update({
        phase: 'decode',
        message: rendererDone ? '准备声音…' : '准备画面与声音…',
        resource: decodeResource,
        done: audioDone + rendererDone,
        total: audioTotal + 1,
      });
    decodeProgress();
    const loads = await Promise.allSettled(
      [
        newRenderer
          .load(pack, preload.signal, (resource) => {
            decodeResource = resource;
            decodeProgress();
          })
          .then(() => {
            rendererDone = 1;
            decodeProgress();
          }),
        newAudio.load(pack, preload.signal, (done, _total, resource) => {
          audioDone = done;
          decodeResource = resource;
          decodeProgress();
        }),
      ].map((task) =>
        task.catch((error) => {
          preload.abort(error);
          throw error;
        }),
      ),
    );
    signal.throwIfAborted();
    for (const result of loads) if (result.status === 'rejected') throw result.reason;
    let savedSpeed = 0;
    try {
      savedSpeed = Number(localStorage.getItem('arkreader.buttonAutoSpeed'));
    } catch {
      /* Storage is optional. */
    }
    newHost = new StandaloneStoryHost();
    const restoringAudio = new RestoringAudio(newAudio, () => newPlayer?.time ?? player?.time ?? 0),
      restoringVideo = new RestoringVideo(
        new StoryVideo(newAudio.context, newAudio.master),
        () => newPlayer?.scheduler.index !== target?.commandIndex,
      );
    newPlayer = new StoryPlayer(pack, restoringAudio, savedSpeed, {
      commands: newHost,
      video: restoringVideo,
      firstRead: false,
      archiveReplay: true,
      layoutDialog: newRenderer.prepareDialog,
      prepareSpell: newRenderer.prepareSpell,
      releaseSpell: newRenderer.releaseSpell,
    });
    newPlayer.nickname = $<HTMLInputElement>('nickname').value || '博士';
    try {
      newPlayer.setQuickSpeed(Number(localStorage.getItem('arkreader.quickSpeed')));
      newPlayer.skipQuickDecisions = localStorage.getItem('arkreader.quickSkipDecisions') === '1';
    } catch {
      /* Native default: do not auto-select decisions. */
    }
    try {
      newPlayer.setDialogPreset(Number(localStorage.getItem('arkreader.dialogPreset')));
    } catch {
      /* Storage is optional. */
    }
    try {
      newPlayer.readerPlayback.pure = localStorage.getItem('arkreader.readerPure') === '1';
    } catch {
      /* Storage is optional. */
    }
    try {
      const preferences = newPlayer.readerPlayback;
      for (const [key, apply] of [
        ['font', (n: number) => preferences.setFont(n)],
        ['spacing', (n: number) => preferences.setSpacing(n)],
        ['alpha', (n: number) => preferences.setAlpha(n)],
      ] as const) {
        const value = localStorage.getItem('arkreader.reader.' + key);
        if (value !== null) apply(Number(value));
      }
    } catch {
      /* Storage is optional. */
    }
    const title = catalogView.label(story) ?? pack.review?.label ?? story;
    if (isWeb) document.title = `${title} · ArkReader`;
    const locationUrl = new URL(location.href);
    locationUrl.searchParams.set('story', story);
    history.replaceState(null, '', locationUrl);
    $('chapter-title').textContent = title;
    $('ended-title').textContent = title + ' · 播放完毕';
    $('story-note').textContent = '点击画面或按空格推进 · 按住 Ctrl 32× 快进';
    $('intro').hidden = true;
    $('player-panel').hidden = false;
    $('ended').hidden = true;
    $('error').hidden = true;
    $('paused').hidden = true;
    document.body.classList.add('playing');
    hiddenUI = false;
    normalAutoBeforeHide = false;
    $('stage').classList.remove('clean');
    lastChoices = '';
    lastDialog = '';
    lastFrame = performance.now();
    newAudio.setVolume(Number($<HTMLInputElement>('volume').value) / 100);
    let resumeNotice = '';
    if (waitForGesture) newPlayer.setPaused(true);
    if (target?.position && target.position.script !== newPlayer.scriptIdentity) {
      resumeNotice = '剧情内容已更新，上次位置不再适用，已从头播放。';
      newPlayer.tick(0);
    } else if (
      target &&
      (target.position || target.percent !== undefined || target.commandIndex !== undefined)
    ) {
      restoringAudio.restoring = true;
      restoringVideo.restoring = true;
      resumeNotice = await restorePosition(
        newPlayer,
        target,
        signal,
        (fraction) =>
          loadingView.update({
            phase: 'seek',
            message:
              target.commandIndex !== undefined
                ? `正在跳转到第 ${newPlayer!.scheduler.commands[target.commandIndex].line} 行…`
                : target.review
                  ? '正在跳转到所选台词…'
                  : target.percent === undefined
                    ? '正在恢复上次观看位置…'
                    : `正在快进至 ${target.percent}%…`,
            done: Math.floor(fraction * 100),
            total: 100,
          }),
        () => newRenderer!.draw(newPlayer!),
      );
      signal.throwIfAborted();
      restoringVideo.restoring = false;
      restoringAudio.finish();
    } else newPlayer.tick(0);
    newRenderer.draw(newPlayer);
    lastFrame = performance.now();
    scrubbing = false;
    $('playback-seek-status').textContent = resumeNotice;
    player = newPlayer;
    sharedGesturePending = waitForGesture;
    audio = newAudio;
    renderer = newRenderer;
    storyHost = newHost;
    if (isWeb && isMobile) stageFullscreen.enterMobile();
    else if (isMobile && !stageFullscreen.active) await stageFullscreen.toggleWindow();
    newHost = undefined;
    loadingView.update({ phase: 'started', message: '准备完成', done: 1, total: 1 });
    loadingView.close();
    readingShelf.remember(story);
    player.onQuickClickNotice = () => quickNotice.rapidClick();
    quickNotice.start(!player.tutorialRestricted && player.story.isAutoable);
    newPlayer = undefined;
    newAudio = undefined;
    newRenderer = undefined;
    $<HTMLCanvasElement>('canvas').focus();
    // Local-only inspection surface for deterministic browser integration tests.
    (window as unknown as { arkreader: unknown }).arkreader = {
      get player() {
        return player;
      },
      get audio() {
        return audio;
      },
      get renderer() {
        return renderer;
      },
      interfaceAudio,
    };
  } catch (error) {
    if (signal.aborted) return;
    if (isWeb && isMobile) await stageFullscreen.exit();
    const canvas = $<HTMLCanvasElement>('canvas');
    canvas.width = canvas.height = 1;
    $('loading').textContent = String(error);
    if (error instanceof ScriptCompatibilityError) loadingView.incompatible(error.report);
    else loadingView.fail(error, () => void start(target));
    if (!$('player-panel').hidden) {
      $('error').hidden = false;
      $('playback-error-message').textContent = String(error);
    }
  } finally {
    signal.removeEventListener('abort', cancelResources);
    newHost?.dispose();
    newPlayer?.dispose();
    newRenderer?.dispose();
    await newAudio?.close();
    if (loading === request) {
      loading = undefined;
      setDesktopPlaying(!!player);
      $('start').removeAttribute('disabled');
      $('restart').removeAttribute('disabled');
    }
  }
}

function saveReadingProgress(): void {
  if (player) readingShelf.update(player.pack.id, player.viewingProgress.value, player.position);
}
function sync(): void {
  if (!player) return;
  scriptView.update(player);
  saveReadingProgress();
  if (!scrubbing) {
    $<HTMLInputElement>('playback-seek').value = String(player.playbackPercent);
    syncApplicationControl($('playback-seek'));
    $('playback-percent').textContent = `${player.playbackPercent}%`;
  }
  if (storyHost?.homeRequested && (player.atEnd || player.finished)) {
    // The native HOME route leaves AVG. Only the archive's home is available
    // here; keep its real command/trace visible to the route event before release.
    $('stage').dispatchEvent(
      new CustomEvent('story-host-home', { detail: { id: player.pack.id, trace: player.trace } }),
    );
    returnToLibrary();
    return;
  }
  if (storyHost?.canContinueBattle(player) && !hostBoundary.open) {
    cancelGesture();
    hostBoundary.showModal();
  }
  if ($('stage').classList.contains('reader-active') !== player.readerVisible)
    readerSelectable.reset();
  $('stage').classList.toggle('reader-active', player.readerVisible);
  readerView.update(player, hiddenUI);
  historyView.update(player);
  readerButton.hidden =
    player.theaterMode || player.finished || !!player.error || !player.readerAvailable;
  readerButton.disabled = !player.readerMode && !player.canRead;
  readerButton.textContent = player.readerMode ? '退出阅读' : '阅读模式';
  readerButton.setAttribute('aria-label', readerButton.textContent);
  const dialog = player.subtitle.visible
    ? player.subtitle.text
    : player.dialog.name + '：' + player.dialog.text;
  if (dialog !== lastDialog) {
    lastDialog = dialog;
    $('accessible-dialog').textContent = dialog;
  }
  $('position').textContent = player.finished
    ? '播放完成'
    : `${Math.floor(player.time / 60)
        .toString()
        .padStart(2, '0')}:${Math.floor(player.time % 60)
        .toString()
        .padStart(2, '0')}`;
  $('paused').hidden = !player.paused;
  $('paused').querySelector('h2')!.textContent = sharedGesturePending ? '剧情已就绪' : '已暂停';
  setControlLabel($('resume'), sharedGesturePending ? '开始阅读' : '继续播放');
  $('ended').hidden = !player.finished;
  // Native AVGAutoButton only animates in BUTTON mode; QUICK displays OFF.
  const isAuto = player.readerMode ? player.readerPlayback.auto : player.auto && !player.quickPlay;
  readerToolbar.update(player.readerVisible, isAuto, player.readerPlayback.speed);
  normalToolbar.update(!player.readerVisible, isAuto, player.autoSpeedIndex);
  $('stage').style.setProperty('--normal-auto-shift', player.canSkip ? '0cqw' : '10.15625cqw');
  setControlLabel($('pause'), player.paused ? '继续' : '暂停');
  $('auto').setAttribute('aria-pressed', String(isAuto));
  $('auto').textContent = isAuto ? '自动 · 开' : '自动';
  $('auto').setAttribute('aria-label', $('auto').textContent);
  $('auto').hidden = player.theaterMode || (!player.readerMode && !player.story.isAutoable);
  $('auto-speed').hidden = !isAuto || player.quickPlay || player.theaterMode || player.finished;
  $('auto-speed').textContent =
    (player.readerMode ? player.readerPlayback.speed : player.autoSpeedIndex) + 1 + '×';
  // _UpdateLogBtn depends on the Reader feature switch, not per-story eligibility.
  $('hide').hidden = player.theaterMode;
  $('log').hidden = player.theaterMode || player.readerEnabled;
  $('choices').hidden = player.readerMode;
  $('settings').hidden = player.theaterMode;
  $<HTMLButtonElement>('pause').disabled = player.finished || !!player.error;
  $('stage').classList.toggle(
    'playback-stopped',
    player.paused || player.finished || !!player.error,
  );
  $('skip').hidden = !player.canSkip;
  const quickVisible =
    (quickPress.counting || player.quickPlay) &&
    !player.paused &&
    !player.theaterMode &&
    !player.finished;
  quickPanel.update(
    quickVisible,
    player.quickPlay,
    quickPress.side,
    player.quickSpeedIndex,
    quickPress.progress(performance.now()),
    performance.now(),
  );
  const key = JSON.stringify(player.choices);
  if (key !== lastChoices) {
    lastChoices = key;
    renderChoices($('choices'), player.choices, (i) => player?.choose(i));
  }
  readerSelectable.update();
  if (player.error) {
    $('error').hidden = false;
    $('playback-error-message').textContent = player.error;
  }
}
function frame(now: number): void {
  quickNotice.update();
  keyboardQuick.update(now);
  quickPress.update(
    now,
    !!player?.canQuickPlay &&
      !hiddenUI &&
      !keyboardQuick.active &&
      !document.querySelector('dialog[open]') &&
      (!quickPress.active || !!player.quickPlay),
  );
  if (player && renderer && document.body.dataset.desktopPage !== 'audio') {
    const dt = lastFrame ? (now - lastFrame) / 1000 : 0;
    lastFrame = now;
    player.tick(dt);
    renderer.draw(player, hiddenUI);
    sync();
  }
  nativeNavigation.update(now);
  storyBackInput.update();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
$('start').onclick = () => void requestPlayback();
$('restart').onclick = () => void start();
let scrubbing = false;
const playbackSeek = $<HTMLInputElement>('playback-seek');
playbackSeek.oninput = () => {
  scrubbing = true;
  $('playback-percent').textContent = `${playbackSeek.value}%`;
};
playbackSeek.onchange = () => {
  scrubbing = false;
  if (player && !loading)
    void start({ percent: Number(playbackSeek.value), position: player.position });
};
playbackSeek.addEventListener('pointercancel', () => {
  scrubbing = false;
});
function returnToLibrary(): void {
  if (isWeb) document.title = 'ArkReader · 明日方舟剧情播放器';
  scriptView.close();
  cancelPlaybackPrompt();
  const locationUrl = new URL(location.href);
  locationUrl.searchParams.delete('story');
  history.replaceState(null, '', locationUrl);
  loadingView.close();
  void stageFullscreen.exit();
  loading?.abort();
  loading = undefined;
  void releasePlayback();
  const canvas = $<HTMLCanvasElement>('canvas');
  canvas.width = canvas.height = 1;
  $('start').removeAttribute('disabled');
  $('restart').removeAttribute('disabled');
  document.body.classList.remove('playing');
  $('player-panel').hidden = true;
  $('intro').hidden = false;
  $('loading').textContent = '';
  setDesktopPlaying(false);
  document.dispatchEvent(new Event('arkreader-resource-idle'));
}
$('library').onclick = returnToLibrary;
$('leave-story').onclick = () => {
  returnToLibrary();
  document.querySelector<HTMLButtonElement>('[data-story][aria-pressed="true"]')?.focus();
};
function setHiddenUI(hidden: boolean): void {
  if (hidden === hiddenUI) return;
  // Native OnHideuiBtnClicked rejects QUICK_PLAY; the hold owns input until
  // release. Both native modes suspend their own auto controller while hidden.
  if (hidden && (!player || player.quickPlay || player.theaterMode)) return;
  hiddenUI = hidden;
  $('stage').classList.toggle('clean', hidden);
  // EventOnHideAll / EventOnExitHide suspend and restore Reader auto, without
  // treating the revealing click as a story-advance input.
  if (player?.readerMode) {
    if (hidden) player.readerPlayback.pauseAuto();
    else player.readerPlayback.resumeAuto();
  } else if (player) {
    if (hidden) normalAutoBeforeHide = player.pauseAuto();
    else if (normalAutoBeforeHide) {
      normalAutoBeforeHide = false;
      player.resumeAuto();
    }
  }
  sync();
}
function advanceVisibleStory(): void {
  if (sharedGesturePending) {
    void resumeSharedPlayback();
    return;
  }
  if (!player || player.paused || player.finished || player.error || player.theaterMode) return;
  if (hiddenUI) setHiddenUI(false);
  else if (player.readerVisible) readerView.advance();
  else player.pressAdvance();
}
function toggleVisibleAuto(): void {
  if (
    !player ||
    hiddenUI ||
    player.paused ||
    player.finished ||
    player.error ||
    player.theaterMode ||
    player.quickPlay
  )
    return;
  if (player.readerMode) player.readerPlayback.toggleAuto();
  else player.setAuto(!player.auto);
  sync();
}
$('canvas').onclick = (e) => {
  // A touch drag does not generate a click, while a mouse release usually does.
  // AVGButton invokes OnClickPress on release in both cases; dispatch it once.
  if (e.detail !== 0 && performance.now() < suppressPointerClickUntil) return;
  advanceVisibleStory();
};
const gestureCanvas = $<HTMLCanvasElement>('canvas');
function cancelGesture(): void {
  const pointer = pressPointer;
  pressPointer = null;
  quickPress.cancel();
  if (pointer !== null) {
    suppressPointerClickUntil = performance.now() + 500;
    if (gestureCanvas.hasPointerCapture(pointer)) gestureCanvas.releasePointerCapture(pointer);
  }
}
gestureCanvas.addEventListener('pointerdown', (e) => {
  suppressPointerClickUntil = 0;
  if (e.button !== 0 || !player?.canQuickPlay || hiddenUI || keyboardQuick.active) return;
  if (pressPointer !== null) return;
  pressPointer = e.pointerId;
  const point = stagePoint(gestureCanvas, e);
  quickPress.down(e.pointerId, point.x, point.y, point.width, performance.now());
  gestureCanvas.setPointerCapture(e.pointerId);
});
gestureCanvas.addEventListener('pointermove', (e) => {
  if (
    pressPointer === e.pointerId &&
    (e.buttons === 0 || !gestureCanvas.hasPointerCapture(e.pointerId))
  ) {
    cancelGesture();
    return;
  }
  quickPress.move(e.pointerId, stagePoint(gestureCanvas, e).y);
});
gestureCanvas.addEventListener('pointerup', (e) => {
  if (pressPointer !== e.pointerId) return;
  pressPointer = null;
  quickPress.up(e.pointerId);
  if (gestureCanvas.hasPointerCapture(e.pointerId))
    gestureCanvas.releasePointerCapture(e.pointerId);
  suppressPointerClickUntil = performance.now() + 500;
  player?.pressAdvance();
});
gestureCanvas.addEventListener('pointercancel', cancelGesture);
gestureCanvas.addEventListener('lostpointercapture', (e) => {
  if (pressPointer === e.pointerId) cancelGesture();
});
window.addEventListener('blur', cancelGesture);
window.addEventListener('playback-screen-mode', cancelGesture);
window.addEventListener('blur', () => keyboardQuick.cancel());
document.addEventListener('keydown', (event) => keyboardQuick.keydown(event));
document.addEventListener('keyup', (event) => keyboardQuick.keyup(event));
$('auto-speed').onclick = () => {
  if (!player) return;
  if (player.readerMode) {
    player.readerPlayback.cycleSpeed();
    sync();
    return;
  }
  player.cycleAutoSpeed();
  try {
    localStorage.setItem('arkreader.buttonAutoSpeed', String(player.autoSpeedIndex));
  } catch {
    /* Continue in memory. */
  }
  sync();
};
$('auto').onclick = toggleVisibleAuto;
const settings = $<HTMLDialogElement>('reading-settings');
const readerOption = document.createElement('fieldset');
readerOption.innerHTML =
  '<legend>阅读模式</legend><label><input type="checkbox" id="reader-show-characters">显示立绘</label>';
settings.append(readerOption);
const readerFields = [
  ['font', '阅读字号', ['小', '中', '大']],
  ['spacing', '段间距', ['窄', '中', '宽']],
  ['alpha', '背景遮罩', ['25%', '50%', '75%', '100%']],
] as const;
const readerFieldsets = readerFields.map(([key, title, labels]) => {
  const field = document.createElement('fieldset');
  field.innerHTML = /* HTML */ `<legend>${title}</legend>
    ${labels.map((label, i) => `<label><input type="radio" name="reader-${key}" value="${i}">${label}</label>`).join('')}`;
  settings.append(field);
  return field;
});
const readerSettingsView = new ReaderSettingsView(
  settings,
  $('stage').querySelector<HTMLElement>('.viewport')!,
  $('close-settings'),
);
$('settings').onclick = () => {
  if (!player || settings.open || (!player.readerMode && player.quickPlay)) return;
  settingsResumed = false;
  autoBeforeSettings = player.pauseAuto();
  player.readerPlayback.pauseAuto();
  $('desktop-blur').hidden = !renderer?.desktopGraphics;
  $<HTMLInputElement>('high-res-rt').checked = !!renderer?.highResolutionRT;
  $<HTMLInputElement>('quick-skip-decisions').checked = player.skipQuickDecisions;
  volumeSlider?.sync();
  readerOption.hidden = !player.readerMode;
  for (const field of readerFieldsets) field.hidden = !player.readerMode;
  settings
    .querySelector<HTMLInputElement>('input[name="dialog-size"]')!
    .closest('fieldset')!.hidden = player.readerMode;
  for (const [key] of readerFields)
    for (const input of settings.querySelectorAll<HTMLInputElement>(`input[name="reader-${key}"]`))
      input.checked =
        Number(input.value) ===
        player.readerPlayback[
          key === 'font' ? 'fontIndex' : key === 'spacing' ? 'spacingIndex' : 'alphaIndex'
        ];
  $<HTMLInputElement>('reader-show-characters').checked = !player.readerPlayback.pure;
  for (const input of settings.querySelectorAll<HTMLInputElement>('input[name="dialog-size"]'))
    input.checked = Number(input.value) === player.dialog.preset.id;
  readerSettingsView.configure(player.readerMode);
  readerSettingsView.show();
};
settings.onchange = (e) => {
  if (!player || !(e.target instanceof HTMLInputElement)) return;
  if (e.target.id === 'quick-skip-decisions') {
    player.skipQuickDecisions = e.target.checked;
    try {
      localStorage.setItem('arkreader.quickSkipDecisions', e.target.checked ? '1' : '0');
    } catch {}
    return;
  }
  if (e.target.id === 'high-res-rt' && renderer?.desktopGraphics) {
    renderer.highResolutionRT = e.target.checked;
    try {
      localStorage.setItem('arkreader.highResRT', e.target.checked ? '1' : '0');
    } catch {}
    return;
  }
  if (e.target.id === 'reader-show-characters') {
    player.readerPlayback.pure = !e.target.checked;
    try {
      localStorage.setItem('arkreader.readerPure', player.readerPlayback.pure ? '1' : '0');
    } catch {
      /* Continue in memory. */
    }
    return;
  }
  if (e.target.name.startsWith('reader-') && e.target.checked) {
    const key = e.target.name.slice(7),
      value = Number(e.target.value);
    if (key === 'font') player.readerPlayback.setFont(value);
    else if (key === 'spacing') player.readerPlayback.setSpacing(value);
    else if (key === 'alpha') player.readerPlayback.setAlpha(value);
    else return;
    try {
      localStorage.setItem('arkreader.reader.' + key, String(value));
    } catch {
      /* Continue in memory. */
    }
    sync();
    return;
  }
  if (e.target.name !== 'dialog-size' || !e.target.checked) return;
  player.setDialogPreset(Number(e.target.value));
  try {
    localStorage.setItem('arkreader.dialogPreset', String(player.dialog.preset.id));
  } catch {
    /* Continue in memory. */
  }
};
$('close-settings').onclick = () => readerSettingsView.dismiss();
// Close the modal synchronously before requesting fullscreen so the same user
// gesture is retained and the fullscreen element cannot cover an open dialog.
for (const id of ['window-full', 'full'])
  $(id).addEventListener('click', () => readerSettingsView.dismiss(true), { capture: true });
let settingsResumed = false;
function resumeSettingsAuto() {
  if (settingsResumed) return;
  settingsResumed = true;
  player?.readerPlayback.resumeAuto();
  if (autoBeforeSettings && player && !player.finished) player.resumeAuto();
  autoBeforeSettings = false;
}
settings.addEventListener('settings-dismiss', resumeSettingsAuto);
settings.addEventListener('close', resumeSettingsAuto);
const skipView = new SkipView(
  $<HTMLDialogElement>('skip-confirm'),
  $('stage').querySelector<HTMLElement>('.viewport')!,
  sync,
);
$('skip').onclick = () => {
  if (player) skipView.show(player);
};
$('volume').oninput = () => {
  audioLevels.set('player', Number($<HTMLInputElement>('volume').value));
};
$('pause').onclick = () => {
  readerSettingsView.dismiss(true);
  if (sharedGesturePending) {
    void resumeSharedPlayback();
    return;
  }
  player?.setPaused(!player.paused);
  sync();
};
$('resume').onclick = () => void resumeSharedPlayback();
async function resumeSharedPlayback(): Promise<void> {
  const current = player,
    currentAudio = audio;
  if (!current || !currentAudio) return;
  try {
    const unlocked = currentAudio.unlock();
    stageFullscreen.prepareMobile();
    await unlocked;
    if (player !== current) return;
    sharedGesturePending = false;
    current.setPaused(false);
    lastFrame = performance.now();
    sync();
  } catch {
    if (player === current) setControlLabel($('resume'), '点此继续阅读');
  }
}
let shareFeedback: ReturnType<typeof setTimeout> | undefined;
$('share-story').onclick = () => {
  if (!player) return;
  const button = $<HTMLButtonElement>('share-story');
  button.title = storyShareUrl(player.pack.id);
  button.disabled = true;
  clearTimeout(shareFeedback);
  void copyStoryLink(player.pack.id)
    .then(() => setControlLabel(button, '链接已复制'))
    .catch(() => {
      setControlLabel(button, '复制失败');
      button.title = `请检查剪贴板权限，或复制此链接：${button.title}`;
    })
    .finally(() => {
      button.disabled = false;
      shareFeedback = setTimeout(() => setControlLabel(button, '复制剧情链接'), 2200);
    });
};
$('hide').onclick = () => setHiddenUI(!hiddenUI);
$('log').onclick = () => {
  if (player) historyView.show(player);
};
document.addEventListener('keydown', (e) => {
  // These are browser bindings for native actions, not a claim that the
  // original client maps the same physical keys. Respect IME, shortcuts and
  // focused controls; route every consumed key through the visible mode.
  if (
    !player ||
    e.defaultPrevented ||
    e.isComposing ||
    e.ctrlKey ||
    e.altKey ||
    e.metaKey ||
    document.querySelector('dialog[open]')
  )
    return;
  if (
    e.target instanceof HTMLElement &&
    (e.target.isContentEditable ||
      e.target.closest('input,textarea,select,button,a,[role="scrollbar"],#script-panel'))
  )
    return;
  if (['Space', 'Enter', 'ArrowRight'].includes(e.code)) {
    e.preventDefault();
    if (!e.repeat) advanceVisibleStory();
  } else if (e.code === 'KeyA') {
    e.preventDefault();
    if (!e.repeat) {
      $('auto').dispatchEvent(new Event('native-ui-activate', { bubbles: true }));
      toggleVisibleAuto();
    }
  }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    cancelGesture();
    keyboardQuick.cancel();
    player?.setPaused(true);
  }
  lastFrame = performance.now();
});
window.addEventListener('arkreader-native-background', () => {
  cancelGesture();
  keyboardQuick.cancel();
  player?.setPaused(true);
  lastFrame = performance.now();
  sync();
});
window.addEventListener('arkreader-back', (event) => {
  if (!isMobile && !isWeb) return;
  const modal = topNativeDialog() ?? document.querySelector<HTMLDialogElement>('dialog[open]');
  if (modal) {
    event.preventDefault();
    if (modal.dispatchEvent(new Event('cancel', { cancelable: true }))) modal.close();
    return;
  }
  const music = document.getElementById('home-music-panel');
  if (music?.dataset.open === 'true') {
    event.preventDefault();
    music.dispatchEvent(new Event('arkreader-close'));
    return;
  }
  if (document.body.dataset.desktopPage === 'audio') {
    event.preventDefault();
    document.querySelector<HTMLButtonElement>('[data-page="library"]')?.click();
    return;
  }
  if (loading || player || pendingPlayback) {
    event.preventDefault();
    returnToLibrary();
    return;
  }
  if (document.body.dataset.desktopPage !== 'library') {
    event.preventDefault();
    document.querySelector<HTMLButtonElement>('[data-page="library"]')?.click();
    return;
  }
  const catalogTab = document.getElementById('library-tab-catalog');
  if (catalogTab?.getAttribute('aria-selected') !== 'true') {
    event.preventDefault();
    catalogTab?.click();
    return;
  }
  const back = document.getElementById('catalog-back') as HTMLButtonElement | null;
  if (back && !back.hidden) {
    event.preventDefault();
    back.click();
  }
});
const requestedStory = new URLSearchParams(location.search).get('story');
const catalogView = new CatalogView(
  document.querySelector('.story-select')!,
  $<HTMLButtonElement>('start'),
  () => void loadCatalog(),
  () => void requestPlayback(),
);
const readingShelf = new ReadingShelf(
  (id, target) => {
    if (catalogView.select(id)) void start(target);
  },
  (ledger) => catalogView.setReadingProgress(ledger),
);
const storyCache = new StoryCacheView(
  (ids) => catalogView.setCachedStories(ids),
  () => catalogView.cacheScope,
);

document.addEventListener('arkreader-before-close', () => {
  saveReadingProgress();
  readingShelf.flush();
});
let initialCatalog = true,
  catalogGeneration = 0;
let sharedLinkOpened = false;
function openSharedStory(): void {
  if (
    !isWeb ||
    !requestedStory ||
    sharedLinkOpened ||
    initialCatalog ||
    document.documentElement.dataset.arkreaderUi !== 'ready' ||
    document.body.dataset.desktopPage !== 'library'
  )
    return;
  sharedLinkOpened = true;
  if (catalogView.selectedId === requestedStory) void requestPlayback(true);
}
async function loadCatalog(): Promise<void> {
  const generation = ++catalogGeneration;
  catalogView.busy();
  try {
    const response = await fetch('/api/catalog');
    if (!response.ok) throw new Error((await response.json()).detail ?? '资源服务未连接');
    const data: CatalogData = await response.json();
    for (const group of data.groups ?? [])
      if (group.hasCover) group.cover = '/api/catalog-art/' + encodeURIComponent(group.id);
    if (generation !== catalogGeneration) return;
    readingShelf.setCatalog(data);
    catalogView.load(data, initialCatalog ? requestedStory : undefined);
    storyCache.setCatalog(data);
    initialCatalog = false;
    $('connection').textContent = `剧情档案 · ${data.stories.length.toLocaleString()} 段`;
    openSharedStory();
  } catch (error) {
    if (generation === catalogGeneration) {
      catalogView.fail(error);
      $('connection').textContent = '目录未加载';
    }
  }
}
void loadCatalog();
mountMobilePlatform();
function suspendForAudio(): (() => void) | undefined {
  const current = player;
  if (!current) return;
  cancelGesture();
  keyboardQuick.cancel();
  const wasPaused = current.paused;
  current.setPaused(true);
  saveReadingProgress();
  readingShelf.flush();
  document.body.classList.remove('playing');
  return () => {
    if (player !== current) return;
    document.body.classList.add('playing');
    current.setPaused(wasPaused);
    lastFrame = performance.now();
    sync();
    $<HTMLCanvasElement>('canvas').focus({ preventScroll: true });
  };
}
if (isNative || isWeb)
  mountDesktopShell({
    leave: returnToLibrary,
    reload: loadCatalog,
    music: startupMusic,
    suspendForAudio,
    previewUi: () => interfaceAudio.play('shell.default'),
  });
if (isNative || isWeb) await mountApplicationControls();
document.documentElement.dataset.arkreaderUi = 'ready';
document.dispatchEvent(new Event('arkreader-ui-ready'));
openSharedStory();
