import { playerMediaUrl } from '../player/package-source';
import { audioLevels } from './audio-levels';

interface Cue {
  key: string;
  url: string;
  volume: number;
  pitch: number;
}
interface AudioProfile {
  cues: Record<string, Cue>;
  bindings: Record<string, { cue: string | null; source: string }>;
}
/** Unscaled UI audio has its own lifetime and bus; story pause, stop and seeking
 * must neither suspend a confirmation click nor replay earlier UI sounds. */
export class InterfaceAudio {
  context?: AudioContext;
  master?: GainNode;
  private profile?: AudioProfile;
  private buffers = new Map<string, AudioBuffer>();
  private pending?: Promise<void>;
  private sources = new Set<AudioBufferSourceNode>();
  private volume = 1;
  constructor() {
    this.volume = audioLevels.get('ui') / 100;
    const unlisten = audioLevels.subscribe((channel, value) => {
      if (channel === 'ui') this.setVolume(value / 100);
    });
    window.addEventListener('blur', () => this.stop());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.stop();
    });
    window.addEventListener('pagehide', () => {
      unlisten();
      this.stop();
      void this.context?.close();
    });
  }
  async load(): Promise<void> {
    if (this.profile) return;
    if (this.pending) return this.pending;
    this.pending = (async () => {
      const response = await fetch(playerMediaUrl('native-ui-audio.json'));
      if (!response.ok) throw Error('原版交互音效尚未准备好');
      const profile = (await response.json()) as AudioProfile;
      this.context ??= new AudioContext();
      this.master ??= this.context.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.context.destination);
      await Promise.all(
        Object.entries(profile.cues).map(async ([name, cue]) => {
          const response = await fetch(playerMediaUrl(cue.url.split('/').at(-1)!));
          if (!response.ok) throw Error('交互音效加载失败：' + cue.key);
          this.buffers.set(name, await this.context!.decodeAudioData(await response.arrayBuffer()));
        }),
      );
      this.profile = profile;
    })();
    try {
      await this.pending;
    } finally {
      this.pending = undefined;
    }
  }
  unlock() {
    if (this.context?.state === 'suspended') void this.context.resume().catch(() => {});
  }
  setVolume(value: number) {
    this.volume = Math.max(0, Math.min(1, value));
    if (this.master) this.master.gain.setValueAtTime(this.volume, this.context!.currentTime);
  }
  play(role: string) {
    this.unlock();
    const name = role.startsWith('shell.') ? role.slice(6) : this.profile?.bindings[role]?.cue;
    const cue = name ? this.profile?.cues[name] : undefined,
      buffer = name ? this.buffers.get(name) : undefined;
    if (!cue || !buffer || !this.context || this.context.state === 'closed' || document.hidden)
      return;
    const source = this.context.createBufferSource(),
      gain = this.context.createGain();
    source.buffer = buffer;
    source.playbackRate.value = cue.pitch;
    gain.gain.value = cue.volume;
    source.connect(gain);
    gain.connect(this.master!);
    this.sources.add(source);
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
      this.sources.delete(source);
    };
    source.start();
    document.dispatchEvent(
      new CustomEvent('arkreader-ui-audio', {
        detail: { role, cue: name, key: cue.key, volume: cue.volume * this.volume },
      }),
    );
  }
  stop() {
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {}
    }
  }
}

interface Target {
  element: HTMLElement;
  role: string;
  disabledAudio?: boolean;
}
function targetFor(target: EventTarget | null): Target | undefined {
  if (!(target instanceof Element) || target.closest('[inert],[hidden]')) return;
  const settings = document.getElementById('reading-settings') as HTMLDialogElement | null;
  const mode = settings?.open
    ? settings.classList.contains('reader-settings-native')
      ? 'reader'
      : 'normal'
    : document.getElementById('stage')?.classList.contains('reader-active')
      ? 'reader'
      : 'normal';
  const skip = target.closest<HTMLDialogElement>('#skip-confirm');
  if (skip?.open && !skip.dataset.audioClosing)
    return {
      element: target.closest<HTMLButtonElement>('button') ?? skip,
      role: target.closest('#confirm-skip') ? 'normal.skip-confirm' : 'normal.skip-cancel',
    };
  let element = target.closest<HTMLElement>('button,input,[role="tab"],#script-panel summary');
  const label = target.closest('label');
  if (label?.control instanceof HTMLInputElement) element = label.control;
  if (!element) {
    if (target === settings && settings.open && !settings.dataset.audioClosing)
      return { element: settings, role: mode + '.settings-background' };
    return;
  }
  if (element.closest('[data-audio-closing]')) return;
  let role: string | undefined;
  const id = element.id;
  if (['settings', 'auto', 'auto-speed', 'skip', 'hide', 'reader-mode'].includes(id))
    role = mode + '.' + id;
  else if (id === 'close-settings') role = mode + '.settings-close';
  else if (id === 'log') role = 'normal.log';
  else if (id === 'close-log') role = 'normal.log-back';
  else if (element.closest('#choices'))
    return { element, role: 'normal.choice', disabledAudio: true };
  else if (element.closest('.reader-live-decision')) role = 'reader.choice';
  else if (element.matches('.reader-top')) role = 'reader.top';
  else if (element.matches('[data-quick-speed]')) role = 'normal.quick-speed';
  else if (element.matches('input[name="dialog-size"]')) role = 'normal.font';
  else if (element.matches('input[name="reader-font"]')) role = 'reader.font';
  else if (element.matches('input[name="reader-spacing"]')) role = 'reader.spacing';
  else if (element.matches('input[name="reader-alpha"]')) role = 'reader.alpha';
  else if (id === 'reader-show-characters') role = 'reader.pure';
  else if (['native-story-settings-tab', 'native-playback-settings-tab'].includes(id))
    role = 'settings.tab';
  else if (['high-res-rt', 'quick-skip-decisions'].includes(id)) role = 'settings.toggle';
  else if (['pause', 'window-full', 'full'].includes(id)) role = 'settings.action';
  else if (id === 'resume') role = 'prompt.ok';
  else if (id === 'script-close') role = 'shell.cancel';
  else if (id === 'script-toggle' || element.closest('#script-panel')) role = 'shell.tab';
  else if (
    [
      'restart',
      'error-retry',
      'host-continue',
      'resume-continue',
      'action-confirm-accept',
    ].includes(id)
  )
    role = 'prompt.confirm';
  else if (
    ['library', 'error-library', 'host-leave', 'resume-restart', 'action-confirm-cancel'].includes(
      id,
    )
  )
    role = 'prompt.cancel';
  else if (['leave-story', 'catalog-back', 'load-cancel', 'cache-cancel'].includes(id))
    role = 'shell.cancel';
  else if (
    element.matches('input[type="checkbox"],input[type="radio"]') &&
    element.closest('#story-cache-view,#home-music-panel,#operator-filter-dialog')
  )
    role = 'shell.checkbox';
  else if (element.matches('[role="tab"],[data-page]')) role = 'shell.tab';
  else if (
    element.matches('button') &&
    element.closest(
      '#intro,.desktop-page,.desktop-rail,#app-loading,#home-music-panel,#home-music-button,#operator-filter-dialog,.ark-select-options',
    )
  )
    role = 'shell.default';
  return role ? { element, role } : undefined;
}

export function mountInterfaceSounds(audio: InterfaceAudio) {
  const presses = new WeakMap<HTMLElement, number>();
  const play = (item: Target | undefined) => {
    if (item && (!item.element.matches(':disabled') || item.disabledAudio)) audio.play(item.role);
  };
  document.addEventListener(
    'pointerdown',
    (event) => {
      if (!event.isTrusted || !event.isPrimary) return;
      audio.unlock();
      const item = targetFor(event.target);
      if (item && (event.button === 0 || item.disabledAudio)) {
        presses.set(item.element, performance.now());
        play(item);
      }
    },
    true,
  );
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.isTrusted) {
        audio.unlock();
        const item = targetFor(event.target);
        if (item && ['Enter', ' '].includes(event.key)) presses.delete(item.element);
      }
    },
    true,
  );
  document.addEventListener(
    'click',
    (event) => {
      if (!event.isTrusted || event.detail !== 0) return;
      const item = targetFor(event.target);
      if (item && performance.now() - (presses.get(item.element) ?? -Infinity) > 500) play(item);
    },
    true,
  );
  document.addEventListener('native-ui-activate', (event) => play(targetFor(event.target)), true);
  document.addEventListener(
    'cancel',
    (event) => {
      const dialog = event.target;
      if (!(dialog instanceof HTMLDialogElement) || !dialog.open || dialog.dataset.audioClosing)
        return;
      if (dialog.id === 'skip-confirm') audio.play('normal.skip-cancel');
      if (dialog.id === 'reading-settings')
        audio.play(
          (dialog.classList.contains('reader-settings-native') ? 'reader' : 'normal') +
            '.settings-close',
        );
      if (dialog.id === 'history') audio.play('normal.log-back');
      if (dialog.id === 'resume-prompt') audio.play('prompt.cancel');
    },
    true,
  );
}
