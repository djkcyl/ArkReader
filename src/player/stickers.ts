import { stickerColorText, type StickerColorText } from '../core/sticker-color.ts';
import { nativeBoolean } from '../core/values.ts';
import { StickerTweens } from './sticker-tween';
export interface StickerView {
  id: string;
  text: string;
  markup?: StickerColorText;
  terminalSteps?: number;
  revealed: number;
  typing: boolean;
  multi: boolean;
  x: number;
  y: number;
  width: number;
  size: number;
  alignment: 'left' | 'center' | 'right';
  alpha: number;
  hidden: boolean;
  renderActive?: boolean;
  rotation?: number;
  scale?: number;
  duration: number;
  delay: number;
  buffer: number;
  lastTime: number;
  fade: {
    start: number;
    duration: number;
    from: number;
    to: number;
    complete?: boolean;
  };
}
const originDelay = 0.04,
  defaultFade = 0.15;
const number = (p: Record<string, unknown>, key: string, fallback: number) => {
  const n = Object.hasOwn(p, key) ? Number(p[key]) : fallback;
  if (!Number.isFinite(n)) throw new Error('无效 Sticker 数值：' + key);
  return n;
};
const boolean = (p: Record<string, unknown>, key: string, fallback: boolean) =>
  Object.hasOwn(p, key) ? nativeBoolean(p[key]) : fallback;
export class Stickers {
  readonly tweens = new StickerTweens();
  readonly views: StickerView[] = [];
  private active = new Map<string, StickerView>();
  private pool: StickerView[] = [];
  current: StickerView | null = null;
  private ended: (length: number) => void;
  constructor(ended: (length: number) => void) {
    this.ended = ended;
  }
  private finish(v: StickerView) {
    if (!v.typing) return;
    v.typing = false;
    v.revealed = v.text.length;
    this.ended(v.text.length);
  }
  finishCurrent() {
    if (this.current) this.finish(this.current);
  }
  private hide(v: StickerView, duration: number, time: number) {
    this.tweens.killLast(v);
    v.duration = duration > 1e-5 ? duration : defaultFade;
    v.hidden = true;
    v.fade = { start: time, duration: v.duration, from: v.alpha, to: 0 };
    if (v.alpha <= 0.01) {
      v.alpha = 0;
      v.typing = false;
      v.renderActive = false;
    }
  }
  execute(
    p: Record<string, unknown>,
    text: string,
    time: number,
    controllerDelay: number,
  ): {
    block: boolean;
    action: string;
  } {
    const id = String(p.id ?? '');
    if (!id) return { block: false, action: 'empty-id' };
    const old = this.active.get(id),
      multi = boolean(p, 'multi', false);
    if (old) {
      this.current = old;
      const block = boolean(p, 'block', false);
      if (multi) {
        if (!old.multi) {
          old.text = '';
          old.revealed = 0;
        }
        old.multi = true;
        old.text += text;
        old.markup = stickerColorText(old.text);
        old.terminalSteps = 0;
        old.typing = true;
        old.buffer = 0;
        old.lastTime = time;
        return { block, action: 'append' };
      }
      this.finish(old);
      this.hide(old, number(p, 'duration', 0), time);
      this.active.delete(id);
      this.pool.push(old);
      this.ended(0);
      return { block, action: 'hide' };
    }
    const x = number(p, 'x', 0),
      y = number(p, 'y', 0);
    if (!text || x < 0 || x > 1280 || y < 0 || y > 720)
      return { block: false, action: 'rejected-layout-or-text' };
    const block = boolean(p, 'block', true);
    let view = this.pool.shift();
    if (!view) {
      if (this.views.length >= 20) return { block, action: 'native-pool-limit' };
      view = {
        id: '',
        text: '',
        revealed: 0,
        typing: false,
        multi: false,
        x: 0,
        y: 0,
        width: 1280,
        size: 24,
        alignment: 'left',
        alpha: 0,
        hidden: true,
        duration: defaultFade,
        delay: originDelay,
        buffer: 0,
        lastTime: time,
        fade: { start: time, duration: 0, from: 0, to: 0 },
      };
      this.views.push(view);
    }
    const duration = number(p, 'duration', -1);
    if (!multi || duration >= 0) view.duration = duration >= 0 ? duration : defaultFade;
    Object.assign(view, {
      id,
      text,
      markup: stickerColorText(text),
      terminalSteps: 0,
      revealed: 0,
      typing: true,
      multi,
      x,
      y,
      width: Math.min(number(p, 'width', 1280), 1280 - x),
      size: Math.trunc(number(p, 'size', 24)),
      alignment: p.alignment === 'center' ? 'center' : p.alignment === 'right' ? 'right' : 'left',
      alpha: view.duration <= 0 ? 1 : 0,
      hidden: false,
      delay: (number(p, 'delay', 1) / originDelay) * controllerDelay,
      buffer: 0,
      lastTime: time,
      fade: { start: time, duration: view.duration, from: 0, to: 1 },
    });
    view.renderActive = true;
    this.tweens.resetView(view);
    this.active.set(id, view);
    this.current = view;
    return { block, action: 'show' };
  }
  tween(p: Record<string, unknown>, time: number, ratio = 1) {
    const view = this.active.get(String(p.id ?? ''));
    if (!view) return false;
    this.tweens.execute(view, p, time, ratio);
    return nativeBoolean(p.block) && nativeBoolean(p.isend);
  }
  clear(p: Record<string, unknown>, time: number): boolean {
    for (const v of this.active.values()) {
      v.rotation = 0;
      v.scale = 1;
      this.hide(v, 0, time);
      this.pool.push(v);
    }
    this.active.clear();
    this.current = null;
    return boolean(p, 'block', false);
  }
  update(time: number) {
    for (const v of this.views) {
      const elapsed = Math.max(0, time - v.fade.start),
        t = v.fade.duration <= 0 ? 1 : Math.min(1, elapsed / v.fade.duration);
      if (!v.fade.complete) {
        v.alpha = v.fade.from + (v.fade.to - v.fade.from) * (1 - (1 - t) * (1 - t));
        if (t >= 1) v.fade.complete = true;
      }
      if (v.hidden && t >= 1) {
        v.alpha = 0;
        v.typing = false;
        v.renderActive = false;
      }
      if (v.typing) {
        v.buffer += Math.max(0, time - v.lastTime);
        const delay = v.delay < 0 ? originDelay : v.delay;
        while (v.typing && v.buffer > delay) {
          v.buffer -= delay;
          if (v.revealed < v.text.length)
            v.revealed = v.markup?.tagEnd.get(v.revealed) ?? v.revealed + 1;
          else v.terminalSteps = (v.terminalSteps ?? 0) + 1;
          // The markup iterator yields the final raw message once, then MoveNext returns false.
          if (v.revealed >= v.text.length && (!v.markup || v.terminalSteps === 2)) this.finish(v);
        }
      }
      v.lastTime = time;
    }
    this.tweens.update(time);
  }
  dispose() {
    this.tweens.clear();
    this.views.length = 0;
    this.pool = [];
    this.active.clear();
    this.current = null;
  }
}
