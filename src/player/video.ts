/** Media events drive command completion; the scene clock controls panel fades. */
export interface VideoPort {
  readonly frame: HTMLVideoElement | null;
  play(url: string, started: () => void, ended: (error?: string) => void): void;
  pause(paused: boolean): void;
  close(): void;
}
export class StoryVideo implements VideoPort {
  frame: HTMLVideoElement | null = null;
  private node: MediaElementAudioSourceNode | null = null;
  private paused = false;
  constructor(
    private context: AudioContext,
    private output: AudioNode,
  ) {}
  play(url: string, started: () => void, ended: (error?: string) => void) {
    this.close();
    const el = document.createElement('video');
    this.frame = el;
    el.playsInline = true;
    el.preload = 'auto';
    el.loop = false;
    el.crossOrigin = 'anonymous';
    this.node = this.context.createMediaElementSource(el);
    this.node.connect(this.output);
    el.onplaying = () => {
      if (this.frame === el) {
        el.onplaying = null;
        started();
      }
    };
    el.onended = () => {
      if (this.frame === el) ended();
    };
    el.onerror = () => {
      if (this.frame === el) ended(el.error?.message || '影片解码失败');
    };
    el.src = url;
    if (!this.paused) this.resume(el, ended);
  }
  private resume(el: HTMLVideoElement, failed: (message: string) => void) {
    void el.play().catch((e: Error) => {
      if (this.frame === el && !this.paused && e.name !== 'AbortError') failed(e.message);
    });
  }
  pause(paused: boolean) {
    this.paused = paused;
    const el = this.frame;
    if (!el || el.ended) return;
    if (paused) el.pause();
    else this.resume(el, () => el.dispatchEvent(new Event('error')));
  }
  close() {
    const el = this.frame;
    this.frame = null;
    if (el) {
      el.onplaying = null;
      el.onended = null;
      el.onerror = null;
      el.pause();
      el.removeAttribute('src');
      el.load();
    }
    this.node?.disconnect();
    this.node = null;
  }
}

/** SofdecMediaPlayer.Play fits the movie to its holder via Scale2DByMaxValue. */
export function nativeMovieRect(w: number, h: number) {
  const scale = Math.min(1, 1280 / w, 720 / h);
  const width = Math.round(w * scale),
    height = Math.round(h * scale);
  return { x: (1280 - width) / 2, y: (720 - height) / 2, width, height };
}
