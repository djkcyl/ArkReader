/** Media events drive command completion; the scene clock controls panel fades. */
export interface VideoPort {
  readonly frame: HTMLVideoElement | null;
  readonly needsGesture?: boolean;
  play(url: string, started: () => void, ended: (error?: string) => void): void;
  pause(paused: boolean): void;
  close(): void;
}
export class StoryVideo implements VideoPort {
  frame: HTMLVideoElement | null = null;
  needsGesture = false;
  private element = document.createElement('video');
  private node: MediaElementAudioSourceNode | null = null;
  private paused = false;
  private revision = 0;
  private failed?: (message: string) => void;
  private sound?: AudioBuffer;
  private soundSource?: AudioBufferSourceNode;
  private soundAnchor?: { time: number; contextTime: number; rate: number };
  private contextChanged = () => this.syncSound();
  constructor(
    private context: AudioContext,
    private output: AudioNode,
    private blocked: () => void,
    private soundtrack: (url: string) => AudioBuffer | undefined = () => undefined,
  ) {}
  play(url: string, started: () => void, ended: (error?: string) => void) {
    this.close();
    const el = this.element;
    this.frame = el;
    this.failed = ended;
    this.sound = this.soundtrack(url);
    el.playsInline = true;
    el.preload = 'auto';
    el.loop = false;
    el.crossOrigin = 'anonymous';
    el.muted = !!this.sound;
    if (this.sound) this.context.addEventListener('statechange', this.contextChanged);
    else {
      this.node ??= this.context.createMediaElementSource(el);
      this.node.connect(this.output);
    }
    let firstPlay = true;
    el.onplaying = () => {
      if (this.frame === el) {
        this.needsGesture = false;
        this.syncSound(true);
        if (firstPlay) {
          firstPlay = false;
          started();
        }
      }
    };
    el.onpause = el.onwaiting = el.onseeking = () => this.syncSound();
    el.onseeked = el.onratechange = () => this.syncSound(true);
    el.ontimeupdate = () => this.syncSound();
    el.onended = () => {
      if (this.frame === el) {
        this.stopSound();
        ended();
      }
    };
    el.onerror = () => {
      if (this.frame === el) {
        this.stopSound();
        ended(el.error?.message || '影片解码失败');
      }
    };
    el.src = url;
    if (!this.paused) this.resume(el);
  }
  private stopSound() {
    const source = this.soundSource;
    this.soundSource = undefined;
    this.soundAnchor = undefined;
    if (!source) return;
    source.onended = null;
    source.stop();
    source.disconnect();
  }
  private syncSound(force = false) {
    const video = this.frame,
      sound = this.sound;
    if (!sound) return;
    if (
      !video ||
      video.paused ||
      video.ended ||
      video.seeking ||
      video.readyState < 3 ||
      this.paused ||
      this.context.state !== 'running' ||
      video.playbackRate <= 0
    ) {
      this.stopSound();
      return;
    }
    const rate = video.playbackRate,
      now = this.context.currentTime,
      anchor = this.soundAnchor;
    if (
      !force &&
      anchor &&
      anchor.rate === rate &&
      Math.abs(anchor.time + (now - anchor.contextTime) * rate - video.currentTime) < 0.12
    )
      return;
    this.stopSound();
    const latency = (this.context.baseLatency ?? 0) + (this.context.outputLatency ?? 0);
    const offset = video.currentTime + latency * rate;
    if (offset >= sound.duration) return;
    const source = this.context.createBufferSource();
    source.buffer = sound;
    source.playbackRate.value = rate;
    source.connect(this.output);
    this.soundSource = source;
    this.soundAnchor = { time: video.currentTime, contextTime: now, rate };
    source.onended = () => {
      if (this.soundSource === source) {
        this.soundSource = undefined;
        this.soundAnchor = undefined;
      }
      source.disconnect();
    };
    source.start(now, Math.max(0, offset));
  }
  private resume(el: HTMLVideoElement) {
    const revision = this.revision;
    void el.play().catch((e: Error) => {
      if (revision !== this.revision || this.frame !== el || this.paused || e.name === 'AbortError')
        return;
      if (e.name === 'NotAllowedError') {
        this.needsGesture = true;
        this.blocked();
      } else this.failed?.(e.message);
    });
  }
  pause(paused: boolean) {
    this.paused = paused;
    const el = this.frame;
    if (!el || el.ended) return;
    if (paused) {
      this.stopSound();
      el.pause();
    } else this.resume(el);
  }
  close() {
    ++this.revision;
    const el = this.frame;
    this.frame = null;
    this.needsGesture = false;
    this.failed = undefined;
    this.stopSound();
    this.sound = undefined;
    this.context.removeEventListener('statechange', this.contextChanged);
    if (el) {
      el.onplaying = null;
      el.onended = null;
      el.onerror = null;
      el.onpause =
        el.onwaiting =
        el.onseeking =
        el.onseeked =
        el.onratechange =
        el.ontimeupdate =
          null;
      el.pause();
      el.removeAttribute('src');
      el.load();
    }
    this.node?.disconnect();
  }
}

/** SofdecMediaPlayer.Play fits the movie to its holder via Scale2DByMaxValue. */
export function nativeMovieRect(w: number, h: number) {
  const scale = Math.min(1, 1280 / w, 720 / h);
  const width = Math.round(w * scale),
    height = Math.round(h * scale);
  return { x: (1280 - width) / 2, y: (720 - height) / 2, width, height };
}
