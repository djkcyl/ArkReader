import {
  disposeAnimatedKV,
  updateAnimatedKV,
  type AnimatedKV,
  type AnimatedKVProfile,
} from './animated-kv';
import { stampParagraphs } from '../core/stamp-text';

export class SpellStickers {
  readonly views = new Map<string, { kv: AnimatedKV; active: boolean; style: string }>();
  current: string | null = null;
  constructor(
    private prepare: (kv: AnimatedKV) => void,
    private release: (kv: AnimatedKV) => void,
  ) {}
  show(
    id: string,
    style: string,
    profile: AnimatedKVProfile,
    text: string,
    p: Record<string, unknown>,
    time: number,
  ) {
    let view = this.views.get(id);
    if (view && view.style !== style) {
      this.release(view.kv);
      disposeAnimatedKV(view.kv);
      this.views.delete(id);
      view = undefined;
    }
    if (!view) {
      const kv: AnimatedKV = {
        key: style,
        profile: structuredClone(profile),
        born: time,
        x: 0,
        y: 0,
        sx: 1,
        sy: 1,
        entry: 0,
        entryIndex: 0,
        clockEntry: true,
      };
      view = { kv, active: true, style };
      this.views.set(id, view);
    }
    const kv = view.kv,
      root = kv.profile.nodes[0];
    disposeAnimatedKV(kv);
    kv.born = time;
    kv.particleTime = time;
    view.active = true;
    if (p.x !== undefined) root.pos.x = Number(p.x);
    if (p.y !== undefined) root.pos.y = -Number(p.y);
    if (p.xScale !== undefined) root.scale.x = Number(p.xScale);
    if (p.yScale !== undefined) root.scale.y = Number(p.yScale);
    if (p.angle !== undefined) {
      const a = (Number(p.angle) * Math.PI) / 360;
      root.rotation = { z: Math.sin(a), w: Math.cos(a) };
    }
    if (p.alpha !== undefined && root.alpha !== undefined) root.alpha = Number(p.alpha);
    // Unprovided paragraphs retain the prefab/previous input, as FormatAvgSplitContentTextFromData does.
    const paragraphs = stampParagraphs(text) ?? [];
    kv.text = kv.profile.nodes
      .filter((n) => n.text)
      .map((n) => paragraphs[n.text!.slot] ?? kv.text?.[n.text!.slot] ?? n.text!.fallback);
    this.prepare(kv);
    return kv.profile.animations.find((a) => a.name === kv.profile.entries[0]?.name)?.length ?? 0;
  }
  hide(id: string) {
    const view = this.views.get(id);
    if (view) {
      view.active = false;
      disposeAnimatedKV(view.kv);
    }
  }
  advance() {
    if (this.current) this.hide(this.current);
    this.current = null;
  }
  update(time: number) {
    for (const v of this.views.values()) if (v.active) updateAnimatedKV(v.kv, time);
  }
  clear() {
    for (const v of this.views.values()) {
      disposeAnimatedKV(v.kv);
      this.release(v.kv);
    }
    this.views.clear();
    this.current = null;
  }
}
