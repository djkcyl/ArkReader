import { sampleKeys, type CurveKey } from './particle-math.ts';
import { nativeBoolean, nativeInt } from '../core/values.ts';
import { resourceKey } from '../core/resource-key.ts';
import type { Visual } from './runtime';
import type { InterludeTexture, WaveMaterial } from './interlude-wave';
type Pair = [number, number];
type XY = {
  x: number;
  y: number;
};
export interface InterludeNode {
  id: string;
  name: string;
  active: boolean;
  alpha?: number;
  row?: {
    left: number;
    right: number;
    spacing: number;
  };
  minWidth?: number;
  preferredWidth?: number;
  ignore?: boolean;
  transform: {
    m_AnchorMin: XY;
    m_AnchorMax: XY;
    m_AnchoredPosition: XY;
    m_SizeDelta: XY;
    m_Pivot: XY;
    m_LocalScale: {
      x: number;
      y: number;
      z: number;
    };
    m_LocalRotation?: {
      x: number;
      y: number;
      z: number;
      w: number;
    };
  };
  components: (
    | {
        kind: 'dialog-portrait';
      }
    | {
        kind: 'mesh-mask';
        points: number[][];
        triangles: number[][];
      }
    | {
        kind: 'label';
        size: number;
        color: number[];
      }
    | {
        kind: 'solid';
        color: number[];
      }
    | {
        kind: 'image';
        sprite: string;
        material: string | null;
        color: number[];
        sliced: boolean;
      }
    | {
        kind: 'mask';
        write: number;
        colorMask: number;
      }
    | {
        kind: 'read-mask';
      }
    | {
        kind: 'gradient';
        color: number[];
        points: {
          point: number;
          color: {
            r: number;
            g: number;
            b: number;
            a: number;
          };
        }[];
      }
  )[];
  children: InterludeNode[];
}
export interface InterludeSprite {
  texture: string;
  rect: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  size: Pair;
  offset: Pair;
  border: number[];
  ppu: number;
}
export interface InterludeProfile {
  kind: 'interlude-template-v1';
  name: string;
  dialog?: {
    group: string;
    portrait: string;
    background: string;
  };
  intro?: {
    name: string;
    duration?: number;
    tracks: {
      node: string;
      property: string;
      keys: CurveKey[];
    }[];
  };
  template: InterludeNode;
  font?: {
    url: string;
  };
  deco?: InterludeNode;
  scaleNode: string;
  initialScale?: Pair;
  emptyNode: string;
  selectedNode?: string;
  unselectedNode?: string;
  textures: Record<string, InterludeTexture>;
  sprites: Record<string, InterludeSprite>;
  materials: Record<string, WaveMaterial>;
}
interface Curve {
  start: number;
  duration: number;
  from: number;
  to: number;
  ease: 'linear' | 'outQuad' | 'outCubic';
}
interface Avatar extends Visual {
  fade?: Curve;
}
export interface Picture extends Visual {
  fade?: Curve;
  move?: [Curve, Curve];
  zoom?: [Curve, Curve];
}
export type PictureSlot = 'bg' | 'middle' | 'right' | 'left';
export interface InterludeChannel {
  introStart?: number;
  introDuration?: number;
  introStop?: number;
  label: string;
  pictures: Partial<Record<PictureSlot, Picture>>;
  maskFade?: Curve;
  maskAlpha: number;
  id: number;
  profile: InterludeProfile;
  offset: Pair;
  size: Pair;
  scale: Pair;
  scaleCurves?: [Curve, Curve];
  avatars: Avatar[];
  position: Pair;
  positionCurves?: [Curve, Curve];
  avatarScale: Pair;
  avatarScaleCurves?: [Curve, Curve];
  empty: boolean;
  selected: boolean;
  hideAt?: number;
  decoAlpha: number;
}
const number = (p: Record<string, unknown>, key: string, fallback = 0) => {
  const v = Object.hasOwn(p, key) ? Number(p[key]) : fallback;
  if (!Number.isFinite(v)) throw new Error('无效 Interlude 数值：' + key);
  return v;
};
export function interludeVector(value: unknown): Pair {
  if (value === undefined || value === null || value === '') return [0, 0];
  const parts = String(value).split(',');
  if (
    parts.length < 2 ||
    parts.slice(0, 2).some((x) => x.trim() === '' || !Number.isFinite(Number(x)))
  )
    throw new Error('无效 Interlude 坐标');
  return parts.slice(0, 2).map((x) => Number(x)) as Pair;
}
export function interludeType(value: unknown): number {
  if (value === 'char') return 3;
  if (value === 'uichar') return 1;
  if (value === 'bg') return 2;
  return /^[+-]?\d+$/.test(String(value ?? '')) ? nativeInt(value) : 0;
}
const sample = (c: Curve, time: number) => {
  const t = c.duration <= 0 ? 1 : Math.max(0, Math.min(1, (time - c.start) / c.duration));
  const u = c.ease === 'outQuad' ? 1 - (1 - t) ** 2 : c.ease === 'outCubic' ? 1 - (1 - t) ** 3 : t;
  return c.from + (c.to - c.from) * u;
};
const curves = (
  from: Pair,
  to: Pair,
  start: number,
  duration: number,
  ease: Curve['ease'],
): [Curve, Curve] =>
  [0, 1].map((i) => ({ from: from[i], to: to[i], start, duration, ease })) as [Curve, Curve];
export class Interludes {
  readonly channels: InterludeChannel[] = [];
  private callbacks: {
    at: number;
    done: () => void;
    channel: InterludeChannel;
  }[] = [];
  execute(
    p: Record<string, unknown>,
    time: number,
    profile: InterludeProfile | undefined,
    checkAsset: (key: string) => void,
    done: () => void,
  ) {
    // _ExecuteInterlude validates default channel=0, then _GenCutinParam uses -1.
    const id = Object.hasOwn(p, 'channel') ? nativeInt(p.channel) : -1,
      block = nativeBoolean(p.block ?? false),
      clear = nativeBoolean(p.clear ?? false);
    const style = nativeInt(p.style ?? 0),
      duration = Math.max(0, number(p, 'tsduration'));
    let ch = this.channels.find((c) => c.id === id);
    if (clear) {
      const closing =
        id >= 0 ? (ch ? [ch] : []) : p.channel === undefined ? [...this.channels] : [];
      if (!closing.length) {
        done();
        return;
      }
      let remaining = closing.length;
      for (const channel of closing) {
        channel.hideAt = time;
        const dialog = !!channel.profile.dialog;
        if (dialog) channel.introStop = time;
        if (!dialog && (style === 0 || style === 2))
          channel.scaleCurves = curves(
            channel.scale,
            interludeVector(p.tsto),
            time,
            duration,
            'outQuad',
          );
        const closeTime = dialog
          ? 0.5
          : style === 0
            ? duration
            : Math.max(0, number(p, 'aduration'));
        if (dialog || style !== 0)
          channel.maskFade = {
            start: time,
            duration: closeTime,
            from: channel.maskAlpha,
            to: dialog ? 0 : Math.max(0, number(p, 'ato', -1)),
            ease: 'outQuad',
          };
        this.callbacks = this.callbacks.filter((c) => c.channel !== channel);
        this.callbacks.push({
          at: time + closeTime,
          channel,
          done: () => {
            const index = this.channels.indexOf(channel);
            if (index >= 0) this.channels.splice(index, 1);
            if (--remaining === 0 && block) done();
          },
        });
      }
      if (!block) done();
      return;
    }
    if (id < 0) {
      done();
      return;
    }
    if (!ch) {
      if (!profile) throw new Error('Interlude 通道缺少原版遮罩预制体');
      const size = interludeVector(p.size),
        to = interludeVector(p.tsto),
        from = interludeVector(p.tsfrom);
      ch = {
        id,
        profile,
        label: String(p.char ?? ''),
        offset: interludeVector(p.offset),
        size:
          Math.hypot(...size) >= 1e-5
            ? size
            : [profile.template.transform.m_SizeDelta.x, profile.template.transform.m_SizeDelta.y],
        scale: profile.initialScale ? [...profile.initialScale] : [1, 1],
        pictures: {},
        maskAlpha: 1,
        avatars: [],
        position: [0, 0],
        avatarScale: [1, 1],
        empty: !p.name || resourceKey(p.name) === 'char_empty',
        selected: nativeBoolean(p.switch ?? false),
        decoAlpha: 1,
      };
      if (profile.dialog) {
        ch.size = [
          profile.template.transform.m_SizeDelta.x,
          profile.template.transform.m_SizeDelta.y,
        ];
        if (style === 3 && profile.intro) {
          ch.introStart = time;
          ch.introDuration = Math.max(0, number(p, 'duration'));
        }
        this.channels.push(ch);
        this.updateDialog(ch, p, checkAsset);
        if (block && (ch.introDuration ?? 0) > 0)
          this.callbacks.push({ at: time + ch.introDuration!, channel: ch, done });
        else done();
        return;
      }
      const fadeMask = style === 1 || style === 2;
      if (fadeMask) {
        ch.maskAlpha = 0;
        ch.maskFade = { start: time, duration: 3, from: 0, to: 1, ease: 'outQuad' };
      }
      if (style === 3 && profile.intro) ch.introStart = time;
      else if (style === 1) ch.scale = [1, 1];
      else if (to.some((v) => v > 1e-5)) {
        ch.scale = from;
        ch.scaleCurves = curves(from, to, time, duration, 'outQuad');
      }
      this.channels.push(ch);
      // The template's completion sequence contains a fixed 1-second interval;
      // its scale tween is independent, not joined to that sequence.
      if (block && ch.introStart === undefined)
        this.callbacks.push({ at: time + (fadeMask ? 3 : 1), channel: ch, done });
      else done();
      return;
    }
    if (ch.profile.dialog) {
      this.updateDialog(ch, p, checkAsset);
      done();
      return;
    }
    if (p.char) ch.label = String(p.char);
    if (p.name) ch.empty = resourceKey(p.name) === 'char_empty';
    ch.selected = nativeBoolean(p.switch ?? false);
    const type = interludeType(p.type);
    if (type === 1 || type === 2) {
      const slot = String(p.slot ?? '');
      const target: PictureSlot =
        type === 2
          ? 'bg'
          : ['right', 'r'].includes(slot)
            ? 'right'
            : ['left', 'l'].includes(slot)
              ? 'left'
              : 'middle';
      // CutinChannel owns a sequence for background and one for all UI portraits.
      for (const [name, img] of Object.entries(ch.pictures)) {
        if ((name === 'bg') === (target === 'bg')) {
          img.move = undefined;
          img.zoom = undefined;
          img.fade = undefined;
        }
      }
      const image = ch.pictures[target] ?? {
        key: '',
        x: target === 'right' ? -140 : 0,
        y: target === 'right' ? 63 : 0,
        sx: 1,
        sy: 1,
        alpha: 1,
        brightness: 1,
      };
      ch.pictures[target] = image;
      const key = resourceKey(p.name);
      let end = 0;
      if (key) {
        checkAsset(key);
        image.key = key;
        const from = number(p, 'afrom', -1),
          to = number(p, 'ato', -1),
          d = Math.max(0, number(p, 'aduration'));
        image.fade = {
          start: time,
          duration: d,
          from: from < 0 ? 0 : from,
          to: to < 0 ? 1 : to,
          ease: 'outQuad',
        };
        end = d;
      }
      if (String(p.pfrom ?? '') !== '' && String(p.pto ?? '') !== '') {
        const d = Math.max(0, number(p, 'duration'));
        image.move = curves(interludeVector(p.pfrom), interludeVector(p.pto), time, d, 'outQuad');
        end = Math.max(end, d);
      }
      if (String(p.sfrom ?? '') !== '' && String(p.sto ?? '') !== '') {
        const d = Math.max(0, number(p, 'sduration'));
        image.zoom = curves(interludeVector(p.sfrom), interludeVector(p.sto), time, d, 'outQuad');
        end = Math.max(end, d);
      }
      if (block) this.callbacks.push({ at: time + end, channel: ch, done });
      else done();
    } else if (type === 3) {
      ch.positionCurves = undefined;
      ch.avatarScaleCurves = undefined;
      const key = resourceKey(p.name),
        fadeDuration = Math.max(0, number(p, 'aduration'));
      if (key) {
        ch.empty = key === 'char_empty';
        if (!ch.empty) checkAsset(key);
        const previous = ch.avatars.at(-1);
        ch.avatars = previous ? [previous] : [];
        if (previous)
          previous.fade = {
            start: time,
            duration: fadeDuration,
            from: previous.alpha,
            to: 0,
            ease: 'linear',
          };
        if (!ch.empty) {
          const from = Math.max(0, number(p, 'afrom', -1)),
            to = number(p, 'ato', -1) < 0 ? 1 : number(p, 'ato');
          ch.avatarScale = [1, 1];
          ch.avatars.push({
            key,
            x: 0,
            y: 202.999267578125,
            sx: 1,
            sy: 1,
            alpha: from,
            brightness: 1,
            fade: { start: time, duration: fadeDuration, from, to, ease: 'linear' },
          });
        }
      }
      const position = String(p.pfrom ?? '') !== '' && String(p.pto ?? '') !== '';
      const scale = String(p.sfrom ?? '') !== '' && String(p.sto ?? '') !== '';
      if (position) {
        ch.position = interludeVector(p.pfrom);
        ch.positionCurves = curves(
          ch.position,
          interludeVector(p.pto),
          time,
          Math.max(0, number(p, 'duration')),
          'outCubic',
        );
      }
      if (scale) {
        ch.avatarScale = interludeVector(p.sfrom);
        ch.avatarScaleCurves = curves(
          ch.avatarScale,
          interludeVector(p.sto),
          time,
          Math.max(0, number(p, 'sduration')),
          'outQuad',
        );
      }
      const end = Math.max(
        key ? fadeDuration : 0,
        position ? Math.max(0, number(p, 'duration')) : 0,
        scale ? Math.max(0, number(p, 'sduration')) : 0,
      );
      if (block) this.callbacks.push({ at: time + end, channel: ch, done });
      else done();
    } else done();
    this.update(time);
  }
  private updateDialog(
    ch: InterludeChannel,
    p: Record<string, unknown>,
    checkAsset: (key: string) => void,
  ) {
    const type = interludeType(p.type),
      key = resourceKey(p.name);
    if (type === 1 || type === 3) {
      if (String(p.icharpos ?? '') !== '') ch.position = interludeVector(p.icharpos);
      if (String(p.icharscale ?? '') !== '') ch.avatarScale = interludeVector(p.icharscale);
      if (key) {
        ch.empty = key === 'char_empty';
        ch.avatars = [];
        if (!ch.empty) {
          checkAsset(key);
          ch.avatars = [{ key, x: 0, y: 0, sx: 1, sy: 1, alpha: 1, brightness: 1 }];
        }
      }
    } else if (type === 2 && key) {
      checkAsset(key);
      ch.pictures.bg = { key, x: 0, y: 0, sx: 1, sy: 1, alpha: 1, brightness: 1 };
    }
  }
  update(time: number) {
    for (const ch of this.channels) {
      if (ch.scaleCurves) ch.scale = ch.scaleCurves.map((c) => sample(c, time)) as Pair;
      if (ch.positionCurves) ch.position = ch.positionCurves.map((c) => sample(c, time)) as Pair;
      if (ch.avatarScaleCurves)
        ch.avatarScale = ch.avatarScaleCurves.map((c) => sample(c, time)) as Pair;
      if (ch.maskFade) ch.maskAlpha = sample(ch.maskFade, time);
      for (const img of Object.values(ch.pictures)) {
        if (img.fade) img.alpha = sample(img.fade, time);
        if (img.move) {
          img.x = sample(img.move[0], time);
          img.y = sample(img.move[1], time);
        }
        if (img.zoom) {
          img.sx = sample(img.zoom[0], time);
          img.sy = sample(img.zoom[1], time);
        }
      }
      ch.decoAlpha =
        ch.hideAt === undefined
          ? 1
          : sample({ start: ch.hideAt, duration: 0.5, from: 1, to: 0, ease: 'outQuad' }, time);
      for (const v of ch.avatars) {
        if (v.fade) v.alpha = sample(v.fade, time);
        v.parent = {
          x: ch.position[0],
          y: ch.position[1],
          sx: ch.avatarScale[0],
          sy: ch.avatarScale[1],
        };
      }
      ch.avatars = ch.avatars.filter(
        (v) => v.alpha > 0 || v.fade?.to !== 0 || time < v.fade.start + v.fade.duration,
      );
    }
    const due = this.callbacks.filter((c) => time >= c.at);
    this.callbacks = this.callbacks.filter((c) => time < c.at);
    for (const c of due) c.done();
  }
  dispose() {
    this.channels.length = 0;
    this.callbacks = [];
  }
}
export function interludeNodeScale(ch: InterludeChannel, node: InterludeNode, time: number): Pair {
  const scale: Pair =
    node.id === ch.profile.scaleNode
      ? [...ch.scale]
      : [node.transform.m_LocalScale.x, node.transform.m_LocalScale.y];
  if (ch.introStart !== undefined)
    for (const t of ch.profile.intro?.tracks ?? [])
      if (t.node === node.id && ['scale.x', 'scale.y'].includes(t.property))
        scale[t.property === 'scale.x' ? 0 : 1] = sampleKeys(t.keys, interludeIntroTime(ch, time));
  return scale;
}
export function interludeIntroTime(ch: InterludeChannel, time: number): number {
  const elapsed = Math.max(0, (ch.introStop ?? time) - (ch.introStart ?? time));
  if (ch.profile.dialog) {
    const length = ch.profile.intro?.duration ?? 0;
    return ch.introDuration ? Math.min(length, (elapsed * length) / ch.introDuration) : length;
  }
  return elapsed;
}
export function interludeNodeValue(
  ch: InterludeChannel,
  node: InterludeNode,
  property: string,
  fallback: number,
  time: number,
): number {
  if (ch.introStart === undefined) return fallback;
  const track = ch.profile.intro?.tracks.find((t) => t.node === node.id && t.property === property);
  return track ? sampleKeys(track.keys, interludeIntroTime(ch, time)) : fallback;
}
