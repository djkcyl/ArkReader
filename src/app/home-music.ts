import { StoryAudio } from '../player/audio';
import { resourceRequest } from './resource-api';
import { transferSpeed } from './transfer-labels';
import './home-music.css';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isDesktop } from './platform';

import {
  musicSettings,
  saveMusicSettings,
  prepareMusic,
  type MusicCatalog,
} from './home-music-source';
import type { PreparedStartupMusic } from './home-music-boot';
interface Pending {
  id: string;
  abort: AbortController;
  audio?: StoryAudio;
}

export class HomeMusic {
  private enabled = true;
  private volume = 0.25;
  private selected = '';
  private storyActive = false;
  private disposed = false;
  private startupPrepared = false;
  private minimized = false;
  private backgrounded = false;
  private windowRevision = 0;
  private unlisten: (() => void)[] = [];
  private state = 'loading';
  private detail = '读取曲目…';
  private catalog?: MusicCatalog;
  private catalogPending?: Promise<void>;
  private pending?: Pending;
  private current?: { id: string; audio: StoryAudio };
  private audioState = Promise.resolve();
  private selectionTimer?: ReturnType<typeof setTimeout>;
  private button = document.createElement('button');
  private panel = document.createElement('section');
  constructor(header: HTMLElement, prepared?: PreparedStartupMusic) {
    this.startupPrepared = !!prepared;
    const settings = musicSettings();
    this.enabled = settings.enabled;
    this.volume = settings.volume;
    this.selected = settings.track;
    this.button.id = 'home-music-button';
    this.button.type = 'button';
    this.button.title = '主页音乐';
    this.button.setAttribute('aria-label', '主页音乐');
    this.button.setAttribute('aria-controls', 'home-music-panel');
    this.button.setAttribute('aria-expanded', 'false');
    this.button.setAttribute('popovertarget', 'home-music-panel');
    this.button.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 17V5l11-2v12M9 9l11-2"/><ellipse cx="6" cy="18" rx="3" ry="2"/><ellipse cx="17" cy="16" rx="3" ry="2"/></svg><span>主页音乐</span>';
    header.insertBefore(this.button, header.querySelector('.window-controls'));
    this.panel.id = 'home-music-panel';
    this.panel.setAttribute('popover', 'auto');
    this.panel.setAttribute('aria-labelledby', 'home-music-title');
    this.panel.innerHTML =
      '<header><h2 id="home-music-title">主页音乐</h2><button id="home-music-close" type="button" aria-label="关闭音乐面板">×</button></header><label class="home-music-switch"><span>播放音乐</span><input id="home-music-enabled" type="checkbox"></label><label class="home-music-volume" for="home-music-volume"><span>音量</span><output id="home-music-volume-value"></output><input id="home-music-volume" type="range" min="0" max="100" aria-label="主页音乐音量"></label><p id="home-music-status" role="status"></p><progress id="home-music-progress" max="1" value="0" hidden></progress><button id="home-music-retry" type="button" hidden>重试</button><div id="home-music-tracks" role="radiogroup" aria-label="主页音乐曲目"></div>';
    document.getElementById('app')!.append(this.panel);
    this.el('home-music-close').onclick = () => this.panel.hidePopover();
    this.panel.addEventListener('toggle', () => {
      const open = this.panel.matches(':popover-open');
      this.button.setAttribute('aria-expanded', String(open));
      if (open && !this.catalog) void this.loadCatalog();
      if (open)
        this.panel
          .querySelector<HTMLInputElement>('input[name=home-music-track]:checked')
          ?.scrollIntoView({ block: 'nearest' });
    });
    this.el<HTMLInputElement>('home-music-enabled').onchange = (event) => {
      this.enabled = (event.target as HTMLInputElement).checked;
      this.save();
      if (this.enabled && !this.catalog) void this.loadCatalog();
      else this.reconcile();
    };
    this.el<HTMLInputElement>('home-music-volume').oninput = (event) => {
      this.volume = Number((event.target as HTMLInputElement).value) / 100;
      this.save();
      this.current?.audio.setVolume(this.wanted ? this.volume : 0);
      this.render();
    };
    this.el('home-music-retry').onclick = () => {
      if (this.catalog?.tracks.length) this.reconcile();
      else void this.loadCatalog();
    };
    document.addEventListener('arkreader-playback-state', (event) => {
      this.storyActive = (event as CustomEvent).detail.playing;
      if (this.storyActive && this.panel.matches(':popover-open')) this.panel.hidePopover();
      this.reconcile();
    });
    document.addEventListener('visibilitychange', () => this.reconcile());
    window.addEventListener('arkreader-native-background', () => {
      this.backgrounded = true;
      this.reconcile();
    });
    window.addEventListener('arkreader-native-foreground', () => {
      this.backgrounded = false;
      this.reconcile();
    });
    document.addEventListener('arkreader-before-close', () => this.dispose());
    window.addEventListener('pagehide', () => this.dispose());
    document.addEventListener('arkreader-resource-idle', () => {
      if (this.enabled && !this.catalog?.tracks.length && !this.disposed) void this.loadCatalog();
    });
    if (isDesktop) {
      const appWindow = getCurrentWindow();
      const syncWindow = async () => {
        const revision = ++this.windowRevision;
        try {
          const minimized = await appWindow.isMinimized();
          if (this.disposed || revision !== this.windowRevision) return;
          if (this.minimized !== minimized) {
            this.minimized = minimized;
            this.reconcile();
          }
        } catch (error) {
          console.warn('Home music window state:', error);
        }
      };
      for (const listener of [
        appWindow.onResized(() => void syncWindow()),
        appWindow.onFocusChanged(() => void syncWindow()),
      ])
        void listener
          .then((stop) => {
            if (this.disposed) stop();
            else this.unlisten.push(stop);
          })
          .catch((error) => console.warn(error));
      void syncWindow();
    }
    if (prepared?.catalog) this.catalog = prepared.catalog;
    if (prepared?.audio && prepared.pack && this.enabled) {
      prepared.audio.music(prepared.pack.intro, prepared.pack.loop, prepared.pack.volume, 0.025, 0);
      this.current = { id: prepared.pack.id, audio: prepared.audio };
    }
    if (this.catalog) {
      this.renderTracks();
      this.reconcile();
    } else if (this.enabled) {
      this.render();
      void this.loadCatalog();
    } else {
      this.state = 'off';
      this.render();
    }
  }
  private el<T extends HTMLElement = HTMLElement>(id: string) {
    return this.panel.querySelector<T>('#' + id)!;
  }
  private get wanted() {
    return (
      !this.disposed &&
      this.enabled &&
      !this.storyActive &&
      !this.minimized &&
      !this.backgrounded &&
      !document.hidden
    );
  }
  private save() {
    saveMusicSettings({ enabled: this.enabled, volume: this.volume, track: this.selected });
  }
  private async loadCatalog() {
    if (this.catalogPending) return this.catalogPending;
    this.catalogPending = (async () => {
      this.state = 'loading';
      this.detail = '读取曲目…';
      this.render();
      try {
        this.catalog = await resourceRequest<MusicCatalog>('/api/home-music');
        if (this.disposed) return;
        if (!this.catalog.tracks.some((t) => t.id === this.selected)) {
          this.selected = this.catalog.default ?? '';
          this.save();
        }
        this.renderTracks();
        this.reconcile();
      } catch (error) {
        if (!this.disposed) {
          this.state = 'error';
          this.detail = '主页音乐暂时不可用，请重试。';
          console.warn('Home music catalog:', error);
          this.render();
        }
      }
    })();
    try {
      await this.catalogPending;
    } finally {
      this.catalogPending = undefined;
    }
  }
  private cancel() {
    const pending = this.pending;
    this.pending = undefined;
    pending?.abort.abort();
    void pending?.audio?.close().catch(() => {});
  }
  private release() {
    const previous = this.current;
    this.current = undefined;
    void previous?.audio.close().catch(() => {});
  }
  private reconcile() {
    if (this.disposed) return;
    if (!this.wanted) {
      this.cancel();
      if (!this.enabled) this.release();
      else this.updateAudioState();
      this.state = this.enabled ? 'paused' : 'off';
      this.render();
      return;
    }
    if (!this.catalog?.tracks.length) {
      this.state = 'empty';
      this.detail = this.catalog ? '暂无可用曲目' : '读取曲目…';
      this.render();
      return;
    }
    if (this.current?.id === this.selected) {
      this.state = 'playing';
      this.updateAudioState();
      this.render();
      return;
    }
    if (this.pending?.id === this.selected) return;
    this.cancel();
    this.release();
    const pending = { id: this.selected, abort: new AbortController() };
    this.pending = pending;
    this.state = 'loading';
    this.detail = '准备音乐…';
    this.render();
    void this.load(pending);
  }
  private async load(pending: Pending) {
    const signal = pending.abort.signal;
    try {
      const pack = await prepareMusic(pending.id, signal, (value) => {
        if (this.pending !== pending || signal.aborted) return;
        const t = value.transfers,
          name = this.catalog?.tracks.find((track) => track.id === pending.id)?.name ?? '主页音乐';
        this.detail =
          name +
          ' · ' +
          value.message +
          (t?.totalFiles
            ? ` ${t.readyFiles}/${t.totalFiles} · ${transferSpeed(t.bytesPerSecond)}`
            : '');
        const progress = this.el<HTMLProgressElement>('home-music-progress');
        progress.hidden = false;
        progress.value = value.overallProgress ?? 0;
        this.render();
      });
      signal.throwIfAborted();
      const audio = new StoryAudio();
      pending.audio = audio;
      audio.setVolume(0);
      this.detail = '准备播放…';
      this.render();
      await audio.load(pack, signal);
      signal.throwIfAborted();
      if (this.pending !== pending || !this.wanted) throw new DOMException('已取消', 'AbortError');
      audio.music(pack.intro, pack.loop, pack.volume, 0.025, 0);
      this.current = { id: pending.id, audio };
      this.pending = undefined;
      this.state = 'playing';
      this.updateAudioState();
      this.render();
      document.dispatchEvent(new Event('arkreader-cache-finished'));
    } catch (error) {
      if (!signal.aborted && this.pending === pending) {
        this.pending = undefined;
        this.state = 'error';
        this.detail = '音乐暂时未能播放，请重试。';
        console.warn('Home music:', error);
        this.render();
      }
    } finally {
      if (this.pending === pending) this.pending = undefined;
      if (pending.audio && this.current?.audio !== pending.audio)
        await pending.audio.close().catch(() => {});
    }
  }
  private updateAudioState() {
    const audio = this.current?.audio;
    if (!audio) return;
    if (!this.wanted) audio.setVolume(0);
    this.audioState = this.audioState
      .then(async () => {
        if (this.current?.audio !== audio || this.disposed) return;
        const active = this.wanted;
        audio.setVolume(active ? this.volume : 0);
        await (active ? audio.context.resume() : audio.context.suspend());
        this.render();
      })
      .catch((error) => {
        if (this.current?.audio === audio && !this.disposed) {
          this.state = 'error';
          this.detail = '音乐未能播放，请关闭后重新开启。';
          console.warn(error);
          this.render();
        }
      });
  }
  private render() {
    this.button.dataset.state = this.state;
    this.button.hidden = this.storyActive;
    this.el<HTMLInputElement>('home-music-enabled').checked = this.enabled;
    this.el<HTMLInputElement>('home-music-volume').value = String(Math.round(this.volume * 100));
    this.el('home-music-volume-value').textContent = Math.round(this.volume * 100) + '%';
    const name = this.catalog?.tracks.find((t) => t.id === this.selected)?.name;
    this.el('home-music-status').textContent =
      this.state === 'playing'
        ? `正在播放 · ${name}`
        : this.state === 'off'
          ? '音乐已关闭'
          : this.state === 'paused'
            ? '音乐已暂停'
            : this.detail;
    this.el('home-music-progress').hidden = this.state !== 'loading' || !this.pending;
    this.el('home-music-retry').hidden = this.state !== 'error';
    this.button.title = name ? `主页音乐 · ${name}` : '主页音乐';
  }
  private renderTracks() {
    const list = this.el('home-music-tracks');
    list.replaceChildren();
    for (const track of this.catalog?.tracks ?? []) {
      const label = document.createElement('label');
      label.className = 'home-music-track';
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'home-music-track';
      radio.value = track.id;
      radio.checked = track.id === this.selected;
      radio.setAttribute('aria-label', track.name);
      const text = document.createElement('span'),
        title = document.createElement('strong'),
        background = document.createElement('small');
      title.textContent = track.name;
      background.textContent = track.backgrounds.join(' / ');
      text.append(title, background);
      radio.onchange = () => {
        if (!radio.checked) return;
        this.selected = track.id;
        this.save();
        clearTimeout(this.selectionTimer);
        this.cancel();
        this.release();
        this.state = this.enabled ? 'loading' : 'off';
        this.detail = '准备音乐…';
        this.render();
        this.selectionTimer = setTimeout(() => this.reconcile(), 120);
      };
      label.append(radio, text);
      list.append(label);
    }
    if (!list.childElementCount) {
      const empty = document.createElement('p');
      empty.textContent = '暂无可用曲目';
      list.append(empty);
    }
  }
  dispose() {
    this.disposed = true;
    clearTimeout(this.selectionTimer);
    for (const stop of this.unlisten) stop();
    this.unlisten = [];
    this.cancel();
    this.release();
  }
  /** Local inspection for native audio/lifecycle verification. */
  get snapshot() {
    return {
      enabled: this.enabled,
      volume: this.volume,
      selected: this.selected,
      state: this.state,
      storyActive: this.storyActive,
      startupPrepared: this.startupPrepared,
      pending: this.pending?.id,
      context: this.current?.audio.context.state,
      buffers: this.current?.audio.buffers.size ?? 0,
      time: this.current?.audio.context.currentTime ?? 0,
      gain: this.current?.audio.master.gain.value ?? 0,
    };
  }
}
