import type { StickerView } from './stickers';
type DrawText = Pick<
  StickerView,
  | 'text'
  | 'markup'
  | 'revealed'
  | 'alpha'
  | 'size'
  | 'width'
  | 'alignment'
  | 'x'
  | 'y'
  | 'rotation'
  | 'scale'
  | 'renderActive'
>;
const format = (seconds: number) =>
  [Math.floor(seconds / 3600) % 24, Math.floor(seconds / 60) % 60, seconds % 60]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
/** AVGTimerView uses story time for DOFade and whole timestamp seconds for its task. */
export class TimerSticker {
  active = false;
  text = '';
  alpha = 0;
  size = 24;
  width = 1280;
  x = 0;
  y = 0;
  readonly alignment = 'left' as const;
  private index: number | null = null;
  private task: {
    begin: number;
    end: number;
    sample: number | null;
  } | null = null;
  private fade: {
    from: number;
    to: number;
    begin: number;
    duration: number;
    hide: boolean;
  } | null = null;
  constructor(private readonly wallSeconds = () => Math.floor(Date.now() / 1000)) {}
  get revealed() {
    return this.text.length;
  }
  show(
    x: number,
    y: number,
    width: number,
    size: number,
    limit: number,
    from: number,
    to: number,
    duration: number,
    time: number,
    siblings: number,
  ) {
    this.index ??= siblings;
    Object.assign(this, { x, y, width, size });
    if (limit > 0) {
      const begin = this.wallSeconds();
      if (!this.task) this.text = format(0);
      this.task = { begin, end: begin + limit, sample: null };
    }
    // RenderTimer starts the task, then DOKill(complete=true) can finish a pending StopTimer.
    if (this.fade?.hide) this.task = null;
    this.active = true;
    this.alpha = from;
    this.fade = { from, to, begin: time, duration: duration > 1e-5 ? duration : 0.13, hide: false };
  }
  clear(duration: number, time: number) {
    if (this.active)
      this.fade = {
        from: this.alpha,
        to: 0,
        begin: time,
        duration: Math.max(0, duration),
        hide: true,
      };
  }
  update(time: number) {
    if (!this.active) return;
    if (this.task) {
      const now = this.wallSeconds(),
        { begin, end, sample } = this.task;
      if (sample === null || now > sample) {
        this.text = format(Math.max(0, now - begin));
        this.task.sample = now;
        if (now >= end) this.task = null;
      }
    }
    if (!this.fade) return;
    const f = this.fade,
      t = f.duration ? Math.max(0, Math.min(1, (time - f.begin) / f.duration)) : 1;
    this.alpha = f.from + (f.to - f.from) * t * (2 - t);
    if (t === 1) {
      this.fade = null;
      if (f.hide) {
        this.active = false;
        this.task = null;
      }
    }
  }
  views(others: readonly StickerView[]): readonly DrawText[] {
    if (!this.active || this.index === null) return others;
    return [...others.slice(0, this.index), this, ...others.slice(this.index)];
  }
  dispose() {
    this.task = null;
    this.fade = null;
    this.active = false;
    this.index = null;
    this.alpha = 0;
    this.text = '';
  }
}
