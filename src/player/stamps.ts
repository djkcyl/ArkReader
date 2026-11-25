import { sampleKeys, type CurveKey } from './particle-math';
import { loadFont, loadImage, releaseFont } from './asset-load';

type Vec = { x: number; y: number };
interface StampNode {
  path: string;
  active: boolean;
  min: Vec;
  max: Vec;
  pos: Vec;
  size: Vec;
  pivot: Vec;
  scale: Vec;
  rotation: { x: number; y: number; z: number; w: number };
  alpha?: number;
  color?: number[];
  spacing?: number;
  slot?: number;
  fontSize?: number;
  font?: string;
  alignment?: number;
  sprite?: string;
  border?: number[];
}
interface Track {
  path: string;
  property: string;
  keys: CurveKey[];
}
export interface StampProfile {
  nodes: StampNode[];
  clips: Record<string, Track[]>;
  animation: string;
  media: Record<string, { url: string; kind?: string }>;
}
export interface Stamp {
  profile: StampProfile;
  born: number;
  id: string;
  pos: number[];
  style: string;
  text: string[];
}
interface Box {
  w: number;
  h: number;
  pivot: Vec;
  matrix: DOMMatrix;
  alpha: number;
}
let fontSerial = 0;
function sliced(
  c: CanvasRenderingContext2D,
  img: HTMLImageElement,
  b: number[],
  w: number,
  h: number,
) {
  const [l, bt, r, t] = b,
    fx = Math.min(1, w / (l + r)),
    fy = Math.min(1, h / (t + bt));
  const sx = [0, l, img.width - r, img.width],
    sy = [0, t, img.height - bt, img.height];
  const dx = [0, l * fx, w - r * fx, w],
    dy = [0, t * fy, h - bt * fy, h];
  for (let y = 0; y < 3; y++)
    for (let x = 0; x < 3; x++) {
      const dw = dx[x + 1] - dx[x],
        dh = dy[y + 1] - dy[y];
      if (dw > 0 && dh > 0)
        c.drawImage(img, sx[x], sy[y], sx[x + 1] - sx[x], sy[y + 1] - sy[y], dx[x], dy[y], dw, dh);
    }
}

export class StampRenderer {
  private images = new Map<string, HTMLImageElement>();
  private fonts = new Map<string, { face: FontFace; url: string; family: string }>();
  dispose() {
    for (const font of this.fonts.values()) releaseFont(font.face);
    this.fonts.clear();
    this.images.clear();
  }
  async load(profile: StampProfile, signal?: AbortSignal) {
    for (const [name, resource] of Object.entries(profile.media)) {
      if (resource.kind === 'font' || /\.(?:ttf|otf|woff2?)(?:$|\?)/i.test(resource.url)) {
        const previous = this.fonts.get(name);
        if (previous?.url === resource.url) continue;
        const family = previous?.family ?? 'ArkStampFont' + ++fontSerial;
        const font = await loadFont(family, resource.url, signal);
        signal?.throwIfAborted();
        if (previous) releaseFont(previous.face);
        this.fonts.set(name, { face: font, url: resource.url, family });
      } else {
        if (!this.images.has(resource.url)) {
          const image = await loadImage(resource.url, signal);
          signal?.throwIfAborted();
          this.images.set(resource.url, image);
        }
      }
    }
  }
  draw(c: CanvasRenderingContext2D, stamp: Stamp, time: number) {
    const { profile } = stamp,
      age = time - stamp.born;
    const bindings = new Map<string, Map<string, number>>();
    for (const clip of [profile.clips[stamp.style] ?? [], profile.clips[profile.animation]]) {
      for (const track of clip) {
        const values = bindings.get(track.path) ?? new Map<string, number>();
        values.set(track.property, sampleKeys(track.keys, age));
        bindings.set(track.path, values);
      }
    }
    const value = (n: StampNode, key: string, fallback: number) =>
      bindings.get(n.path)?.get(key) ?? fallback;
    const font = (n: StampNode) =>
      `${n.fontSize}px ${this.fonts.get(n.font ?? '')?.family ?? 'ArkNative'}`;
    const isActive = (n: StampNode) => !!value(n, 'm_IsActive', Number(n.active));
    c.save();
    const lines = profile.nodes.filter((n) => n.slot !== undefined && isActive(n));
    const metrics = new Map(
      lines.map((n) => {
        c.font = font(n);
        return [n.path, c.measureText(stamp.text[n.slot!] ?? '')];
      }),
    );
    const preferred = Math.max(0, ...Array.from(metrics.values(), (m) => m.width));
    const boxes = new Map<string, Box>();
    let nextLineTop = 0;
    c.translate(640, 360);
    const root: Box = {
      w: 1280,
      h: 720,
      pivot: { x: 0.5, y: 0.5 },
      matrix: c.getTransform(),
      alpha: 1,
    };
    for (const n of profile.nodes) {
      const parent = n.path
        ? boxes.get(n.path.slice(0, Math.max(0, n.path.lastIndexOf('/'))))
        : root;
      if (!parent || !isActive(n)) continue;
      const anchor = (axis: keyof Vec) =>
        n.min[axis] + (n.max[axis] - n.min[axis]) * n.pivot[axis] - parent.pivot[axis];
      let w = parent.w * (n.max.x - n.min.x) + value(n, 'm_SizeDelta.x', n.size.x);
      const h = parent.h * (n.max.y - n.min.y) + value(n, 'm_SizeDelta.y', n.size.y);
      let x = n.path
        ? parent.w * anchor('x') + value(n, 'm_AnchoredPosition.x', n.pos.x)
        : stamp.pos[0];
      let y = n.path
        ? parent.h * anchor('y') + value(n, 'm_AnchoredPosition.y', n.pos.y)
        : stamp.pos[1];
      if (n.spacing !== undefined) {
        w = preferred;
        nextLineTop =
          (lines.reduce((sum, line) => sum + line.size.y, 0) +
            Math.max(0, lines.length - 1) * n.spacing) /
          2;
      }
      if (n.slot !== undefined) {
        w = metrics.get(n.path)!.width;
        x = w * n.pivot.x;
        y = nextLineTop - h * (1 - n.pivot.y);
        const layout = profile.nodes.find((group) => group.spacing !== undefined)!;
        nextLineTop -= h + layout.spacing!;
      }
      c.setTransform(parent.matrix);
      c.translate(x, -y);
      c.rotate(
        -2 * Math.atan2(value(n, 'rotation.z', n.rotation.z), value(n, 'rotation.w', n.rotation.w)),
      );
      c.scale(value(n, 'scale.x', n.scale.x), value(n, 'scale.y', n.scale.y));
      const alpha = parent.alpha * value(n, 'm_Alpha', n.alpha ?? 1);
      boxes.set(n.path, { w, h, pivot: n.pivot, matrix: c.getTransform(), alpha });
      c.globalAlpha = Math.min(1, Math.max(0, alpha * value(n, 'm_Color.a', n.color?.[3] ?? 1)));
      c.translate(-w * n.pivot.x, -h * (1 - n.pivot.y));
      if (n.sprite && w > 0 && h > 0) {
        const img = this.images.get(profile.media[n.sprite].url)!;
        if (n.border?.some((v) => v > 0)) sliced(c, img, n.border, w, h);
        else c.drawImage(img, 0, 0, w, h);
      }
      if (n.slot !== undefined) {
        const m = metrics.get(n.path)!;
        c.font = font(n);
        c.fillStyle = 'white';
        c.textAlign = 'left';
        c.textBaseline = 'alphabetic';
        c.fillText(
          stamp.text[n.slot] ?? '',
          m.actualBoundingBoxLeft,
          n.alignment === 6 ? h - m.actualBoundingBoxDescent : m.actualBoundingBoxAscent,
        );
      }
    }
    c.restore();
  }
}
