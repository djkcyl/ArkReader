import type { Command } from '../core/scheduler';
import type { ReaderPerformanceState } from '../core/reader-performance';
import { gridLayout, stripLayout, type GridTile } from '../core/grid-background';
import { nativeVector } from '../core/vector';
import { nativeInt } from '../core/values';
import { resourceKey } from '../core/resource-key';
import type { Pack, Visual } from './runtime';

const n = (p: Record<string, unknown>, key: string, fallback: number) =>
  Object.hasOwn(p, key) ? Math.fround(Number(p[key])) : fallback;
const FADE = 0.1;
type ImageLayer = {
  signature: string | null;
  fore: Visual | null;
  back: Visual | null;
  start: number;
  backAlpha: number;
};
const layer = (): ImageLayer => ({
  signature: null,
  fore: null,
  back: null,
  start: 0,
  backAlpha: 0,
});

/** Independent reader presentation, built from authored context, never from the
 * normal scene's animated transforms, filters, blockers or particle systems. */
export class ReaderScene {
  readonly background = layer();
  readonly image = layer();
  characters: Visual[] = [];
  cgItems: Visual[] = [];
  tiles: GridTile[] = [];
  grid = { x: 0, y: 0, sx: 1, sy: 1, alpha: 1 };
  private gridSignature: string | null = null;
  private gridStart = 0;
  private gridFade = 0;
  private gridFrom = 0;
  private gridTo = 1;
  photo: { key: string; x: number; y: number; black: number; alpha: number } | null = null;
  private itemLines = new Set<number>();
  private lastItem: Command | undefined;
  private photoTransition: {
    start: number;
    duration: number;
    hiding: boolean;
    next: Command | undefined;
  } | null = null;
  private showPhoto(command: Command, time: number): void {
    const p = command.params;
    this.photo = {
      key: resourceKey(p.image),
      x: n(p, 'offsetx', 0),
      y: n(p, 'offsety', 0),
      black: n(p, 'black', 0.4),
      alpha: 0,
    };
    this.photoTransition = {
      start: time,
      duration: n(p, 'fadetime', 0.5),
      hiding: false,
      next: undefined,
    };
  }
  private imageVisual(command: Command | undefined, pack: Pack): Visual | null {
    const p = command?.params ?? {},
      key = resourceKey(p.image);
    if (!key) return null;
    const asset = pack.assets[key];
    if (!asset) throw Error('阅读画面缺少图片：' + key);
    const ratio = 100 / (asset.pixelsPerUnit ?? 100);
    let width = (asset.rect?.width ?? asset.width ?? 1280) * ratio * n(p, 'width', 1),
      height = (asset.rect?.height ?? asset.height ?? 720) * ratio * n(p, 'height', 1);
    const adapt = String(p.screenadapt ?? '');
    if (adapt === 'fill') {
      width = 1280;
      height = 720;
    } else if (['width', 'height', 'showall', 'coverall'].includes(adapt)) {
      const factor =
        adapt === 'width'
          ? 1280 / width
          : adapt === 'height'
            ? 720 / height
            : adapt === 'showall'
              ? Math.min(1280 / width, 720 / height)
              : Math.max(1280 / width, 720 / height);
      width *= factor;
      height *= factor;
    }
    return {
      key,
      width,
      height,
      x: n(p, 'x', 0),
      y: n(p, 'y', 0),
      sx: n(p, 'xScale', 1),
      sy: n(p, 'yScale', 1),
      brightness: 1,
      alpha: 1,
    };
  }
  private imageLayer(
    target: ImageLayer,
    command: Command | undefined,
    pack: Pack,
    time: number,
  ): void {
    // _ExecuteIfChanged compares the raw image string with StringComparison.Ordinal.
    // Transform-only updates keep both the existing image and its running tween.
    const signature = String(command?.params.image ?? '');
    if (signature === target.signature) return;
    const next = this.imageVisual(command, pack);
    const old = target.fore ?? target.back;
    target.signature = signature;
    target.back = old;
    target.backAlpha = old?.alpha ?? 0;
    target.fore = next;
    target.start = time;
    if (next) next.alpha = 0;
  }
  private updateGridFade(time: number): void {
    const t =
      this.gridFade > 0 ? Math.min(1, Math.max(0, (time - this.gridStart) / this.gridFade)) : 1;
    this.grid.alpha = this.gridFrom + (this.gridTo - this.gridFrom) * t;
    if (t === 1 && this.gridTo === 0) this.tiles = [];
  }
  update(state: ReaderPerformanceState, pack: Pack, time: number): void {
    const bg = ['largebg', 'verticalbg', 'gridbg'].map((k) => state.commands.get(k)).find(Boolean);
    if (state.commands.has('background') || bg)
      this.imageLayer(this.background, state.commands.get('background'), pack, time);
    if (state.commands.has('image'))
      this.imageLayer(this.image, state.commands.get('image'), pack, time);
    this.updateGridFade(time);
    // LargeBackgroundView only reacts to its three registered commands. An
    // absent command leaves the previous panel intact; an empty group fades it out.
    const signature = bg
      ? String(bg.params.imagegroup ?? '') || String(bg.params.cggroup ?? '')
      : null;
    if (bg && signature !== this.gridSignature) {
      this.gridSignature = signature;
      this.gridStart = time;
      this.gridFade = n(bg.params, 'fadetime', FADE);
      if (!signature) {
        this.gridFrom = this.grid.alpha;
        this.gridTo = 0;
      } else {
        const p = bg.params,
          layout = bg.name === 'gridbg' ? gridLayout(p) : stripLayout(p, bg.name === 'verticalbg');
        if (!layout) throw Error('阅读画面背景拼接参数无效：' + bg.line);
        this.tiles = layout.tiles;
        for (const tile of this.tiles)
          if (!pack.assets[tile.key]) throw Error('阅读画面缺少拼接图片：' + tile.key);
        this.grid = {
          x: layout.originX + n(p, 'x', 0),
          y: layout.originY + n(p, 'y', 0),
          sx: n(p, 'xScale', 1),
          sy: n(p, 'yScale', 1),
          alpha: 0,
        };
        this.gridFrom = 0;
        this.gridTo = 1;
      }
    }
    this.updateGridFade(time);
    this.characters = [];
    const add = (
      slot: string,
      key: unknown,
      p: Record<string, unknown>,
      start: string,
      end: string,
    ) => {
      const portrait = resourceKey(key);
      if (!portrait || portrait === 'char_empty') return;
      if (!pack.assets[portrait]) throw Error('阅读画面缺少立绘：' + portrait);
      const scale = state.scales.get(slot) ?? { x: 1, y: 1 };
      this.characters.push({
        key: portrait,
        slot,
        x: slot === 'left' ? -200 : slot === 'right' ? 200 : 0,
        y: 202.999267578125,
        sx: 1,
        sy: 1,
        parent: { x: 0, y: 0, sx: scale.x, sy: scale.y },
        alpha: 1,
        brightness: 1,
        blackStart: n(p, start, 0),
        blackEnd: n(p, end, 0),
      });
    };
    const legacy = state.commands.get('character');
    if (legacy) {
      const p = legacy.params;
      if (p.name2) {
        add('left', p.name, p, 'blackstart', 'blackend');
        add('right', p.name2, p, 'blackstart2', 'blackend2');
      } else add('middle', p.name, p, 'blackstart', 'blackend');
    } else
      for (const slot of ['left', 'right', 'middle']) {
        const command = state.characters.get(slot);
        if (command) add(slot, command.params.name, command.params, 'bstart', 'bend');
      }
    const entries = [...state.cgItems].sort(
      ([ak, a], [bk, b]) =>
        nativeInt(a.params.layer ?? 0) - nativeInt(b.params.layer ?? 0) ||
        (a.line > 0 ? a.line : 2147483647) - (b.line > 0 ? b.line : 2147483647) ||
        (ak < bk ? -1 : ak > bk ? 1 : 0),
    );
    this.cgItems = entries.flatMap(([, command]) => {
      const p = command.params,
        key = resourceKey(p.image);
      if (!key) return [];
      if (!pack.assets[key]) throw Error('阅读画面缺少 CG：' + key);
      // _BuildCgItemRenderCommand deliberately drops rotation/scale/alpha curves
      // and replaces position with pto, when a valid vector was authored.
      const pos =
        p.pto === undefined || !String(p.pto ?? '').trim() ? [0, 0] : nativeVector(p.pto, 'posto');
      const width = nativeInt(p.width ?? 0),
        height = nativeInt(p.height ?? 0);
      return [
        {
          key,
          x: pos[0],
          y: pos[1],
          sx: 1,
          sy: 1,
          alpha: 1,
          brightness: 1,
          ...(width > 0 && height > 0 ? { width, height } : {}),
        },
      ];
    });
    for (const target of [this.background, this.image]) {
      const t = Math.min(1, Math.max(0, (time - target.start) / FADE));
      if (target.fore) target.fore.alpha = t;
      else if (target.back) target.back.alpha = target.backAlpha * (1 - t);
      if (t === 1) target.back = null;
    }
    const show = state.commands.get('showitem'),
      hide = state.commands.get('hideitem');
    const item = !show
      ? hide
      : !hide
        ? show
        : show.line > 0 && (hide.line <= 0 || hide.line < show.line)
          ? show
          : hide;
    if (!item) {
      this.photo = null;
      this.photoTransition = null;
      this.itemLines.clear();
      this.lastItem = undefined;
    } else if (item.line > 0 ? !this.itemLines.has(item.line) : item !== this.lastItem) {
      this.lastItem = item;
      if (item.line > 0) this.itemLines.add(item.line);
      if (this.photo) {
        this.photo.alpha = 1;
        this.photoTransition = {
          start: time,
          duration: n(item.params, 'fadetime', 0.5),
          hiding: true,
          next: item.name === 'showitem' ? item : undefined,
        };
      } else if (item.name === 'showitem') this.showPhoto(item, time);
    }
    const fade = this.photoTransition;
    if (this.photo && fade) {
      const t =
          fade.duration > 0 ? Math.min(1, Math.max(0, (time - fade.start) / fade.duration)) : 1,
        alpha = 1 - (1 - t) ** 2;
      this.photo.alpha = fade.hiding ? 1 - alpha : alpha;
      if (t === 1) {
        this.photoTransition = null;
        if (fade.hiding) {
          this.photo = null;
          if (fade.next) this.showPhoto(fade.next, time);
        }
      }
    }
  }
}
