import { nativeBoolean } from '../core/values';
import { resourceKey } from '../core/resource-key';
type Props = Record<string, unknown>;
interface Face {
  key: string;
  alpha: number;
}
export interface CutinSlot {
  id: string;
  x: number;
  width: number;
  pan: number;
  alpha: number;
  style: 'fade' | 'horiz_expand_center';
  front: Face;
  back?: Face;
}
interface Animation {
  start: number;
  duration: number;
  sample: (linear: number, eased: number) => void;
  finish: () => void;
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export class CharacterCutins {
  readonly slots = new Map<string, CutinSlot>();
  private animations: Animation[] = [];
  execute(params: Props, time: number, requireAsset: (key: string) => void, done: () => void) {
    const id = String(params.widgetID ?? ''),
      key = resourceKey(params.name);
    const slot = this.slots.get(id),
      block = nativeBoolean(params.block ?? false);
    if (!id || (!key && !slot)) {
      done();
      return;
    }
    const duration = Math.max(0, Number(params.fadetime ?? 0.4));
    let sample: Animation['sample'],
      finish = () => {};
    if (!key && slot) {
      const width = slot.width,
        alpha = slot.alpha;
      sample = (_, eased) => {
        if (slot.style === 'fade') slot.alpha = lerp(alpha, 0, eased);
        else {
          slot.alpha = 1;
          slot.width = lerp(width, 0, eased);
        }
      };
      finish = () => this.slots.delete(id);
    } else if (!slot) {
      if (key !== 'char_empty') requireAsset(key);
      const width = Math.trunc(Number(params.width ?? 200));
      const created: CutinSlot = {
        id,
        x: Number(params.offsetx ?? 0),
        pan: -Number(params.povX ?? 0),
        width,
        alpha: 1,
        style: params.fadestyle === 'horiz_expand_center' ? 'horiz_expand_center' : 'fade',
        front: { key, alpha: 1 },
      };
      this.slots.set(id, created);
      sample = (_, eased) => {
        if (created.style === 'fade') created.alpha = eased;
        else created.width = lerp(0, width, eased);
      };
    } else {
      if (key !== 'char_empty') requireAsset(key);
      const startWidth = Math.trunc(slot.width),
        endWidth = Math.trunc(Number(params.width ?? startWidth));
      const startX = slot.x,
        endX = Number(params.offsetx ?? startX);
      const startPan = slot.pan,
        endPan = -Number(params.povX ?? startPan);
      const previous = slot.front,
        changed = previous.key !== key;
      const next = changed ? { key, alpha: 0 } : previous,
        previousAlpha = previous.alpha;
      if (changed) {
        slot.back = previous;
        slot.front = next;
      }
      sample = (linear, eased) => {
        slot.width = lerp(startWidth, endWidth, eased);
        slot.x = lerp(startX, endX, eased);
        slot.pan = lerp(startPan, endPan, eased);
        if (changed) {
          previous.alpha = lerp(previousAlpha, 0, linear);
          next.alpha = linear;
        }
      };
      finish = () => {
        if (changed && slot.back === previous) slot.back = undefined;
      };
    }
    const finishAnimation = () => {
      finish();
      if (block) done();
    };
    // Show/SlotUpdate/Hide attach OnComplete and Play even for duration zero.
    // The scheduler sees that completion on the following tween update.
    sample(0, 0);
    this.animations.push({ start: time, duration, sample, finish: finishAnimation });
    if (!block) done();
  }
  update(time: number) {
    for (const a of this.animations.slice()) {
      const t =
        a.duration === 0 || time >= a.start + a.duration
          ? 1
          : Math.max(0, (time - a.start) / a.duration);
      a.sample(t, 1 - (1 - t) * (1 - t));
      if (t === 1) {
        this.animations.splice(this.animations.indexOf(a), 1);
        a.finish();
      }
    }
  }
  dispose() {
    this.animations.length = 0;
    this.slots.clear();
  }
}
