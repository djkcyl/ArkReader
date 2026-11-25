import { loadFont, loadImage, releaseFont } from './asset-load';
import { CharacterGlitchRenderer, type GlitchTextures } from './character-glitch-renderer';
import { bindImageEffect } from './image-effects';
import { resourceKey } from '../core/resource-key';
import { nativeMovieRect } from './video';
import { panoramaFocusKeys } from './focus-state';
import { tileSize, tileQuads } from '../core/tiled-image';
import { PhotoSlotRenderer } from './photo-slot';
import { readingFont, type ReadingMarkup } from '../core/sticker-color';
import { alignedTextOffset, layoutDialogText, type DialogLines } from './dialog-layout';
import { sceneResources } from '../core/scene-resources';
import { playerMediaUrl, profileUrl } from './package-source';
import { GridTileRenderer } from './grid-tile-renderer';
import { StampRenderer } from './stamps';
import { AnimatedKVRenderer } from './animated-kv';
import { lineAdvance } from '../core/line-breaking';
import { ParticleRenderer } from './particle-renderer';
import { nativeColorUnit } from '../core/color32';
import { NATIVE, type Pack, type Visual, type StoryPlayer } from './runtime';
import { SceneFilters, type FilterProfile } from './filters';
import { parseScript } from '../core/parser';
import { drawCurtains } from './curtains';
import { FocusFilter } from './focus-filter';
import { FocusMask, type AlphaLayer } from './focus-mask';
import { blackMask } from '../core/character-material';
import { SliderBlocker, type BlockerProfile } from './blocker';
import { BackgroundBlur } from './background-blur';
import { InterludeRenderer } from './interlude-renderer';
import { ReaderScene } from './reader-scene';

export class StageRenderer {
  private loadAbort = new AbortController();
  private disposed = false;
  private dialogFont?: FontFace;
  private readerScene: ReaderScene | null = null;
  private readerMovieCanvas: HTMLCanvasElement | null = null;
  // HGMobileBlurRenderer reads GradingPPSettings.s_highResRT from graphics
  // grading, independently of any FocusParam command in the script.
  readonly desktopGraphics =
    !/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) &&
    !(navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  highResolutionRT = this.desktopGraphics;
  private gridRenderer = new GridTileRenderer();
  private dialogLayouts: {
    speaker: boolean;
    text: string;
    markup?: ReadingMarkup;
    width: number;
    size: number;
    scale: number;
    layout: DialogLines;
  }[] = [];
  private stampRenderer = new StampRenderer();
  private kvRenderer: AnimatedKVRenderer | null = null;
  animatedKVFrames = 0;
  prepareSpell = (kv: import('./animated-kv').AnimatedKV) => {
    if (!this.kvRenderer) throw Error('咒文渲染器未加载');
    this.kvRenderer.prepareSpell(kv);
  };
  releaseSpell = (kv: import('./animated-kv').AnimatedKV) => {
    this.kvRenderer?.releaseSpell(kv);
  };
  private interludeRenderer: InterludeRenderer | null = null;
  interludeFrames = 0;
  interludeWaveFrames = 0;
  private photoRenderer: PhotoSlotRenderer | null = null;
  private images = new Map<string, HTMLImageElement>();
  private stickerLayouts = new Map<string, DialogLines>();
  private shades = new Map<string, HTMLCanvasElement>();
  private glitchRenderer: CharacterGlitchRenderer | null = null;
  private glitchTextures = new Map<string, GlitchTextures>();
  private renderTime = 0;
  glitchFrames = 0;
  private materials = new Map<string, HTMLCanvasElement>();
  private frame: HTMLCanvasElement | null = null;
  private context: CanvasRenderingContext2D;
  private output: CanvasRenderingContext2D;
  private scene: HTMLCanvasElement | null = null;
  private filters: SceneFilters | null = null;
  private focusFilter: FocusFilter | null = null;
  private focusMask: FocusMask | null = null;
  private alphaLayers = new Map<string, AlphaLayer>();
  private drawingFocus = false;
  filterFrames = 0;
  focusFrames = 0;
  blockerFrames = 0;
  private slider: SliderBlocker | null = null;
  private blockerTints = new Map<string, HTMLCanvasElement>();
  private backgroundBlur: BackgroundBlur | null = null;
  private effectCopy: HTMLCanvasElement | null = null;
  backgroundEffectFrames = 0;
  private particleRenderer: ParticleRenderer | null = null;
  particleFrames = 0;
  particleDrawCalls = 0;
  stickerFrames = 0;
  constructor(readonly canvas: HTMLCanvasElement) {
    canvas.width = NATIVE.width;
    canvas.height = NATIVE.height;
    this.context = this.output = canvas.getContext('2d', { alpha: false })!;
  }
  async load(
    pack: Pack,
    externalSignal?: AbortSignal,
    progress?: (resource: string) => void,
  ): Promise<void> {
    const cancel = () => this.loadAbort.abort(externalSignal?.reason);
    if (externalSignal?.aborted) cancel();
    externalSignal?.addEventListener('abort', cancel, { once: true });
    const signal = this.loadAbort.signal;
    try {
      signal.throwIfAborted();
      progress?.('字幕字体、动画与演出材质');
      for (const asset of Object.values(pack.assets))
        if (asset.stamp) await this.stampRenderer.load(asset.stamp, signal);
      for (const asset of Object.values(pack.assets))
        if (asset.animatedKV) {
          signal.throwIfAborted();
          this.kvRenderer ??= new AnimatedKVRenderer();
          await this.kvRenderer.load(asset.animatedKV, signal);
        }
      for (const asset of Object.values(pack.assets))
        if (asset.interlude) {
          signal.throwIfAborted();
          this.interludeRenderer ??= new InterludeRenderer();
          await this.interludeRenderer.load(asset.interlude, signal);
        }
      signal.throwIfAborted();
      const commands = parseScript(pack.script, pack.variables);
      const { focus: hasFocus, filters: hasFilters, slider } = sceneResources(commands);
      const hasGlitch = commands.some(
        (c) => c.name === 'glitchtween' || (c.name === 'charslot' && c.params.glitch !== undefined),
      );
      if (Object.values(pack.assets).some((a) => a.kind === 'effect')) {
        this.backgroundBlur = new BackgroundBlur();
        this.scene = document.createElement('canvas');
        this.effectCopy = document.createElement('canvas');
      }
      for (const asset of Object.values(pack.assets))
        if (
          asset.profile &&
          (asset.profile.kind === 'signal-particles-v1' ||
            asset.profile.kind === 'native-particles-v2')
        ) {
          signal?.throwIfAborted();
          this.particleRenderer ??= new ParticleRenderer();
          await this.particleRenderer.load(asset.profile, signal);
        }
      for (const command of commands)
        if (command.name === 'imgeffect' && command.params.name) {
          const profile = pack.assets[resourceKey(command.params.name)]?.profile,
            texture = pack.assets['imgfx:' + resourceKey(command.params.image)]?.imageEffectTexture;
          if (profile?.kind !== 'native-particles-v2' || !texture)
            throw Error('图像特效预加载缺少纹理或预制体');
          this.particleRenderer ??= new ParticleRenderer();
          await this.particleRenderer.load(bindImageEffect(profile, texture), signal);
        }
      if (commands.some((c) => c.name === 'showitem')) {
        const photo = await PhotoSlotRenderer.load(signal);
        signal.throwIfAborted();
        this.photoRenderer = photo;
      }
      if (slider) {
        const response = await fetch(profileUrl('blocker-profile'), { signal });
        if (!response.ok) throw new Error('无法加载原版转场材质');
        const profile: BlockerProfile = await response.json();
        if (pack.version && profile.version !== pack.version)
          throw new Error('转场材质资源版本不一致');
        const mask = await loadImage(profile.mask.url, signal);
        signal.throwIfAborted();
        if (mask.width !== profile.mask.width || mask.height !== profile.mask.height)
          throw new Error('转场遮罩尺寸不匹配');
        this.slider = new SliderBlocker(profile, mask);
      }
      if (hasFilters || hasFocus) {
        const response = await fetch(profileUrl('filter-profile'), { signal });
        if (!response.ok) throw new Error('无法加载原版滤镜材质参数');
        const profile: FilterProfile = await response.json();
        signal.throwIfAborted();
        if (pack.version && profile.version !== pack.version)
          throw new Error('滤镜与剧情资源版本不同');
        if (hasFilters) this.filters = new SceneFilters(profile);
        if (hasGlitch) {
          if (!profile.glitch) throw Error('缺少官方故障材质配置');
          pack.glitchPresets = profile.glitch;
          this.glitchRenderer = new CharacterGlitchRenderer();
        }
        if (hasFocus) {
          const front = profile.materials.mat_ghost_front?.floats,
            back = profile.materials.mat_ghost_back?.floats,
            blit = profile.materials.mat_blit_ghost?.floats;
          if (
            !front ||
            !back ||
            !blit ||
            ![front._RimScale, front._RimLerp].every(Number.isFinite) ||
            front._EnableRim !== 1 ||
            back._EnableRim !== 0 ||
            front._ColorMask !== 1 ||
            back._ColorMask !== 1 ||
            blit._SrcColor !== 8 ||
            blit._DstColor !== 7 ||
            blit._SrcAlpha !== 0 ||
            blit._DstAlpha !== 1
          )
            throw new Error('未验证的原版失焦材质布局');
          this.focusFilter = new FocusFilter();
          this.focusMask = new FocusMask(front._RimScale, front._RimLerp);
        }
        this.scene = document.createElement('canvas');
      }
      signal?.throwIfAborted();
      await Promise.all(
        Object.entries(pack.assets)
          .filter(([, a]) => a.kind === 'image')
          .map(async ([key, a]) => {
            progress?.('读取画面 · ' + key);
            const img = await loadImage(a.url, signal);
            signal?.throwIfAborted();
            this.images.set(key, img);
            progress?.('已解码画面 · ' + key);
          }),
      );
      if (hasFocus || hasGlitch) {
        const cache = new Map<string, Promise<HTMLImageElement>>();
        const read = (ref: { url: string; width: number; height: number }) => {
          let task = cache.get(ref.url);
          if (!task) {
            task = (async () => {
              const img = await loadImage(ref.url, signal);
              if (img.width !== ref.width || img.height !== ref.height)
                throw new Error('原始透明纹理尺寸不匹配');
              return img;
            })();
            cache.set(ref.url, task);
          }
          return task;
        };
        await Promise.all(
          Object.entries(pack.assets)
            .filter(([, a]) => a.kind === 'image')
            .map(async ([key, a]) => {
              if (a.layout && !a.alphaSources) throw new Error(`立绘缺少原始透明纹理：${key}`);
              if (a.alphaSources) {
                const s = a.alphaSources;
                const layer = {
                  main: await read(s.main),
                  face: s.face ? await read(s.face) : undefined,
                  red: true,
                  faceRect: s.faceRect,
                };
                signal.throwIfAborted();
                this.alphaLayers.set(key, layer);
                if (hasGlitch) {
                  if (!s.colorMain) throw Error('缺少立绘原始颜色纹理');
                  const texture = {
                    main: await read(s.colorMain),
                    alpha: await read(s.main),
                    face: s.colorFace ? await read(s.colorFace) : undefined,
                    faceAlpha: s.face ? await read(s.face) : undefined,
                    split: !!s.split,
                    faceRect: s.faceRect,
                  };
                  signal.throwIfAborted();
                  this.glitchTextures.set(key, texture);
                }
              } else this.alphaLayers.set(key, { main: this.images.get(key)!, red: false });
            }),
        );
      }
      const font = await loadFont('ArkNative', playerMediaUrl('native-dialog.ttf'), signal);
      signal.throwIfAborted();
      this.dialogFont = font;
      const frame = await loadImage(playerMediaUrl('native-dialog-frame.png'), signal);
      signal.throwIfAborted();
      const mask = document.createElement('canvas');
      mask.width = frame.width;
      mask.height = frame.height;
      const ctx = mask.getContext('2d')!;
      ctx.drawImage(frame, 0, 0);
      ctx.globalCompositeOperation = 'source-in';
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, mask.width, mask.height);
      this.frame = mask;
    } catch (error) {
      this.loadAbort.abort(error);
      throw error;
    } finally {
      externalSignal?.removeEventListener('abort', cancel);
    }
  }
  private dialogLines(
    text: string,
    markup: ReadingMarkup | undefined,
    width: number,
    size = 24,
    speaker = false,
  ): DialogLines {
    const pixels = Math.round(this.canvas.clientWidth * Math.min(window.devicePixelRatio || 1, 3));
    const scale = (pixels || this.canvas.width) / 1280;
    const cached = this.dialogLayouts.find(
      (e) =>
        e.speaker === speaker &&
        e.text === text &&
        e.markup === markup &&
        e.width === width &&
        e.size === size &&
        e.scale === scale,
    );
    if (cached) return cached.layout;
    const layout = layoutDialogText(
      this.output,
      text,
      markup,
      width,
      size,
      scale,
      speaker ? 1 : 0.9,
      speaker ? 25 : size,
    );
    if (this.dialogLayouts.length >= 6) this.dialogLayouts.shift();
    this.dialogLayouts.push({ speaker, text, markup, width, size, scale, layout });
    return layout;
  }
  prepareDialog = (dialog: StoryPlayer['dialog']): void => {
    // DialogPanel._TryExpandMessageWidthOnOverflow keeps the added font width
    // until the panel is reset or its reading preset changes.
    const { messageSize, frameHeight } = dialog.preset;
    if (
      dialog.canExpand &&
      dialog.messageWidth === 735 &&
      this.dialogLines(dialog.segment, dialog.segmentMarkup, 735, messageSize).height >=
        89 + frameHeight - 182
    )
      dialog.messageWidth = 735 + messageSize;
  };
  private drawDialogText(dialog: StoryPlayer['dialog']): void {
    this.prepareDialog(dialog);
    const w = dialog.messageWidth;
    const { messageSize, nameSize, frameHeight } = dialog.preset,
      offsetY = frameHeight - 182;
    const message = this.dialogLines(dialog.text, dialog.markup, w, messageSize);
    const segment = this.dialogLines(dialog.segment, dialog.segmentMarkup, w, messageSize);
    const name = this.dialogLines(dialog.name, undefined, 312.3, nameSize, true);
    // The stretched image_frame extends two reference units past either edge.
    this.drawLines(
      name,
      18.75,
      624.9 - offsetY - Math.max(0, name.height - 65),
      312.3,
      'right',
      Infinity,
    );
    this.drawLines(
      message,
      381.4,
      628.5 - offsetY - Math.max(0, segment.height - 89),
      w,
      'left',
      dialog.revealed,
      dialog.markup,
    );
  }
  private drawLines(
    layout: DialogLines,
    x: number,
    y: number,
    width: number,
    alignment: string,
    visible: number,
    markup?: ReadingMarkup,
  ): void {
    const c = this.context;
    c.textBaseline = 'alphabetic';
    c.textAlign = 'left';
    c.fontKerning = 'none';
    for (const [index, line] of layout.lines.entries()) {
      const span = lineAdvance(line);
      const left = x + alignedTextOffset(width, span, alignment, layout.scale);
      for (const glyph of line) {
        if (glyph.end > visible) return;
        c.font = markup
          ? readingFont(markup, glyph.index, layout.fontSize)
          : layout.fontSize + 'px ArkNative';
        c.fillStyle = markup?.colors[glyph.index] ?? '#fff';
        c.fillText(glyph.char, left + glyph.x, y + layout.baselines[index]);
      }
    }
  }
  private drawVisual(
    v: Visual,
    pack: Pack,
    character = false,
    focusAmount = 0,
    gridTile = false,
  ): void {
    const c = this.context,
      img = this.images.get(v.key);
    if (!img || v.alpha <= 0) return;
    const asset = pack.assets[v.key],
      ppu = asset.pixelsPerUnit ?? 100;
    const layout = character ? asset.layout : undefined;
    const w =
        layout?.size.x ?? v.width ?? ((asset.rect?.width ?? asset.width ?? img.width) * 100) / ppu,
      h =
        layout?.size.y ??
        v.height ??
        ((asset.rect?.height ?? asset.height ?? img.height) * 100) / ppu;
    c.save();
    c.globalAlpha = Math.max(0, Math.min(1, v.alpha));
    c.translate(640 + v.x, character ? 720 : 360 - v.y);
    if (v.parent) {
      c.translate(v.parent.x, -v.parent.y);
      c.scale(v.parent.sx, v.parent.sy);
      c.translate(v.parent.shakeX ?? 0, -(v.parent.shakeY ?? 0));
    }
    c.translate(
      layout?.position.x ?? 0,
      character ? -v.y - ((layout?.position.y ?? NATIVE.characterY) - NATIVE.characterY) : 0,
    );
    if (v.rotationZ) c.rotate((-v.rotationZ * Math.PI) / 180);
    c.scale(v.sx * (layout?.scale.x ?? 1), v.sy * (layout?.scale.y ?? 1));
    const left = -w * (v.pivotX ?? layout?.pivot.x ?? 0.5),
      top = -h * (1 - (v.pivotY ?? layout?.pivot.y ?? 0.5));
    const tile = v.tiled
      ? tileSize(
          w,
          h,
          ((asset.rect?.width ?? img.width) * 100) / ppu,
          ((asset.rect?.height ?? img.height) * 100) / ppu,
          asset.tileRepeatUV,
        )
      : null;
    if (tile && (w <= 0 || h <= 0 || tile[0] <= 0 || tile[1] <= 0)) {
      c.restore();
      return;
    }
    if (this.drawingFocus) {
      const px = v.pivotX ?? layout?.pivot.x ?? 0.5,
        py = v.pivotY ?? layout?.pivot.y ?? 0.5;
      let rect: [number, number, number, number] = [-w * px, -h * (1 - py), w, h],
        uv: [number, number, number, number] = [0, 0, 1, 1];
      if (character && asset.textureRect && asset.textureRectOffset && asset.rect) {
        const t = asset.textureRect,
          o = asset.textureRectOffset,
          r = asset.rect;
        rect = [
          rect[0] + (w * o.x) / r.width,
          rect[1] + (h * (r.height - o.y - t.height)) / r.height,
          (w * t.width) / r.width,
          (h * t.height) / r.height,
        ];
        uv = [
          t.x / (asset.width ?? img.width),
          1 - (t.y + t.height) / (asset.height ?? img.height),
          t.width / (asset.width ?? img.width),
          t.height / (asset.height ?? img.height),
        ];
      }
      const matrix = c.getTransform(),
        alpha = this.alphaLayers.get(v.key)!;
      if (tile) {
        for (const quad of tileQuads(left, top, w, h, ...tile))
          this.focusMask!.draw(alpha, { matrix, ...quad }, v.alpha, focusAmount, false);
      } else this.focusMask!.draw(alpha, { matrix, rect, uv }, v.alpha, focusAmount, character);
    }
    // Multiply RGB only, retaining alpha (matching native focusColor).
    const start = v.blackStart ?? 0,
      end = v.blackEnd ?? 0;
    let drawable: CanvasImageSource = img,
      materialKey = v.key;
    if (!v.glitch && start >= 0 && start < end && end <= 1) {
      materialKey += `:${start}:${end}:${!!v.blackInverse}`;
      let material = this.materials.get(materialKey);
      if (!material) {
        material = document.createElement('canvas');
        material.width = img.width;
        material.height = img.height;
        const ctx = material.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        const pixels = ctx.getImageData(0, 0, img.width, img.height);
        for (let y = 0; y < img.height; y++) {
          const factor = blackMask(1 - (y + 0.5) / img.height, start, end, v.blackInverse);
          for (let x = 0; x < img.width; x++) {
            const i = (y * img.width + x) * 4;
            pixels.data[i] *= factor;
            pixels.data[i + 1] *= factor;
            pixels.data[i + 2] *= factor;
          }
        }
        ctx.putImageData(pixels, 0, 0);
        if (this.materials.size >= 32) this.materials.clear();
        this.materials.set(materialKey, material);
      }
      drawable = material;
    }
    const focusColor = nativeColorUnit(v.brightness);
    if (!v.glitch && focusColor < 1) {
      const key = materialKey + ':' + focusColor;
      let tinted = this.shades.get(key);
      if (!tinted) {
        tinted = document.createElement('canvas');
        tinted.width = img.width;
        tinted.height = img.height;
        const t = tinted.getContext('2d')!;
        t.drawImage(drawable, 0, 0);
        // Black source-atop scales premultiplied RGB by focusColor and keeps
        // destination alpha, including the antialiased edge of a black mask.
        t.globalCompositeOperation = 'source-atop';
        t.globalAlpha = 1 - focusColor;
        t.fillStyle = '#000';
        t.fillRect(0, 0, tinted.width, tinted.height);
        if (this.shades.size > 80) this.shades.clear();
        this.shades.set(key, tinted);
      }
      drawable = tinted;
    }
    if (v.glitch) {
      const sources = this.glitchTextures.get(v.key);
      if (!sources || !this.glitchRenderer) throw Error('立绘故障材质未准备');
      let rect: [number, number, number, number] = [left, top, w, h],
        uv: [number, number, number, number] = [0, 1, 1, -1];
      if (asset.textureRect && asset.textureRectOffset && asset.rect) {
        const t = asset.textureRect,
          o = asset.textureRectOffset,
          r = asset.rect;
        rect = [
          left + (w * o.x) / r.width,
          top + (h * (r.height - o.y - t.height)) / r.height,
          (w * t.width) / r.width,
          (h * t.height) / r.height,
        ];
        uv = [
          t.x / sources.main.width,
          (t.y + t.height) / sources.main.height,
          t.width / sources.main.width,
          -t.height / sources.main.height,
        ];
      }
      drawable = this.glitchRenderer.draw(
        sources,
        v.glitch,
        this.renderTime,
        focusColor,
        Math.max(0, Math.min(1, v.alpha)),
        start,
        end,
        !!v.blackInverse,
        c.canvas.width,
        c.canvas.height,
        { matrix: c.getTransform(), rect, uv },
      );
      c.resetTransform();
      c.globalAlpha = 1;
      c.drawImage(drawable, 0, 0);
      this.glitchFrames++;
      c.restore();
      return;
    }
    if (tile && w === tile[0] && h === tile[1]) {
      c.drawImage(drawable, left, top, w, h);
    } else if (
      tile &&
      !asset.tileRepeatUV &&
      c.getTransform().b === 0 &&
      c.getTransform().c === 0
    ) {
      // Packed or clamped sprites are distinct quads in UGUI. Clamp the
      // sampler on each quad and keep partial rows anchored at the bottom.
      for (const { rect, uv } of tileQuads(left, top, w, h, ...tile))
        this.gridRenderer.draw(c, drawable, img.width, img.height, ...rect, uv);
    } else if (tile) {
      // A single filled rectangle avoids antialiasing shared tile edges on a scaled canvas.
      const pattern = c.createPattern(drawable, 'repeat');
      if (!pattern) throw Error('无法平铺剧情图片：' + v.key);
      pattern.setTransform(
        new DOMMatrix([tile[0] / img.width, 0, 0, tile[1] / img.height, left, top + h]),
      );
      c.fillStyle = pattern;
      c.fillRect(left, top, w, h);
    } else if (gridTile)
      this.gridRenderer.draw(c, drawable, img.width, img.height, left, top, w, h);
    else c.drawImage(drawable, left, top, w, h);
    c.restore();
  }
  draw(player: StoryPlayer, hideUI = false): void {
    if (this.readerMovieCanvas) this.readerMovieCanvas.hidden = true;
    this.particleRenderer?.beginFrame();
    this.renderTime = player.time;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 3);
    const width = Math.max(1, Math.round(this.canvas.clientWidth * pixelRatio)),
      height = Math.max(1, Math.round(this.canvas.clientHeight * pixelRatio));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    if (player.finished && player.finishMask === 'loading_white') {
      this.output.save();
      this.output.resetTransform();
      this.output.globalAlpha = 1;
      this.output.fillStyle = '#fff';
      this.output.fillRect(0, 0, width, height);
      this.output.restore();
      return;
    }
    if (player.readerVisible) {
      this.drawReader(player, width, height, hideUI);
      this.drawReaderMovie(player, width, height);
      return;
    }
    if (!player.readerMode) this.readerScene = null;
    const active =
        player.filters.grayscale !== 0 ||
        player.filters.inverse !== 0 ||
        player.filters.chaos !== 0,
      focusActive = player.focus.active,
      bgActive =
        player.bgEffects.active ||
        [...player.displayHolders.values()].some((h) => 'particles' in h);
    this.drawingFocus = focusActive;
    if (active || focusActive || bgActive) {
      if (
        !this.scene ||
        (active && !this.filters) ||
        (focusActive && (!this.focusFilter || !this.focusMask))
      )
        throw new Error('滤镜渲染器未准备');
      if (this.scene.width !== width || this.scene.height !== height) {
        this.scene.width = width;
        this.scene.height = height;
      }
      this.context = this.scene.getContext('2d', { alpha: false })!;
    } else this.context = this.output;
    if (focusActive) this.focusMask!.begin(width, height);
    this.context.setTransform(width / 1280, 0, 0, height / 720, 0, 0);
    let c = this.context;
    c.globalAlpha = 1;
    c.fillStyle = '#000';
    c.fillRect(0, 0, 1280, 720);
    // Geometry queue precedes the scene canvas. The dawn prefab has one
    // coplanar opaque Quad. Its transparent companion passes disable ZTest.
    const opaqueSystems = player.bgEffects.instances
      .filter(
        (e) =>
          e.particles &&
          'materials' in e.profile &&
          Object.hasOwn(e.profile.materials, 'builtin-error'),
      )
      .map((e) => ({ particles: e.particles!, layer: e.layer, order: e.order }));
    if (opaqueSystems.length) {
      if (!this.scene || !this.particleRenderer) throw Error('缺少不透明网格渲染器');
      const result = this.particleRenderer.draw(
        this.scene,
        opaqueSystems,
        player.time,
        player.camera,
        { opaque: true },
      );
      if (result !== this.scene) {
        c.save();
        c.resetTransform();
        c.drawImage(result, 0, 0);
        c.restore();
      }
    }
    const imageSystems = player.bgEffects.instances
      .filter((e) => e.imageEffect && e.particles)
      .map((e) => ({ particles: e.particles!, layer: e.layer, order: e.order }));
    let imageOrder = -Infinity;
    const drawImagesBefore = (order: number) => {
      if (imageSystems.length && imageOrder < order) {
        const result = this.particleRenderer!.draw(
          this.scene!,
          imageSystems,
          player.time,
          player.camera,
          { min: imageOrder, max: order - 1 },
        );
        if (result !== this.scene) {
          c.save();
          c.resetTransform();
          c.drawImage(result, 0, 0);
          c.restore();
        }
        this.particleFrames = this.particleRenderer!.frames;
        this.particleDrawCalls = this.particleRenderer!.drawCalls;
      }
      imageOrder = Math.max(imageOrder, order);
    };
    drawImagesBefore(1);
    c.save();
    c.translate(player.camera.x, -player.camera.y);
    for (const v of player.background)
      this.drawVisual(v, player.pack, false, player.focus.get('bg'));
    drawImagesBefore(2);
    if (player.grid.tiles.length && player.grid.alpha > 0) {
      const { originX, originY, alpha, tiles } = player.grid;
      const { x, y, sx, sy } = player.gridOffset;
      for (const [index, tile] of tiles.entries()) {
        this.drawVisual(
          {
            ...tile,
            x: originX + x + tile.x * sx,
            y: originY + y + tile.y * sy,
            sx,
            sy,
            alpha,
            brightness: 1,
            pivotX: 0,
            pivotY: 1,
          },
          player.pack,
          false,
          player.focus.get(panoramaFocusKeys[index]),
          true,
        );
      }
    }
    const drawDisplaySlot = (slot: string) => {
      const holders = [...player.displayHolders.values()]
        .filter((h) => h.slot === slot)
        .sort((a, b) => a.layer - b.layer || a.order - b.order);
      type ParticleHolder = Extract<(typeof holders)[number], { particles: unknown }>;
      let group: ParticleHolder[] = [];
      const flush = () => {
        if (!group.length) return;
        if (!this.particleRenderer || !this.scene) throw new Error('叠加粒子资源未加载');
        const result = this.particleRenderer.draw(this.scene, group, player.time, player.camera);
        c.save();
        c.resetTransform();
        c.drawImage(result, 0, 0);
        c.restore();
        this.particleFrames = this.particleRenderer.frames;
        this.particleDrawCalls = this.particleRenderer.drawCalls;
        group = [];
      };
      for (const holder of holders) {
        flush();
        drawImagesBefore(
          ({ bgover: 10, charover: 70, cgover: 131 }[slot] ?? 10) + 10 * (holder.layer - 1),
        );
        if ('particles' in holder) {
          group.push(holder);
          continue;
        }
        flush();
        if ('kv' in holder) {
          if (!this.kvRenderer) throw new Error('动画 CG 绘制器未加载');
          this.kvRenderer.draw(c, holder.kv, player.time);
          this.animatedKVFrames = this.kvRenderer.frames;
          continue;
        }
        const image = this.images.get(holder.key);
        if (!image) throw new Error('背景叠加图片未加载：' + holder.key);
        c.save();
        c.globalAlpha = Math.max(0, Math.min(1, holder.alpha));
        c.drawImage(image, 0, 0, 1280, 720);
        c.restore();
      }
      flush();
    };
    if (player.displayHolders.size) drawDisplaySlot('bgover');
    drawImagesBefore(61);
    for (const v of player.characters)
      this.drawVisual(v, player.pack, true, player.focus.get('char'));
    if (player.displayHolders.size) drawDisplaySlot('charover');
    drawImagesBefore(121);
    c.save();
    c.translate(640, 360);
    c.rotate((-player.imageRotation.z * Math.PI) / 180);
    c.translate(-640, -360);
    for (const v of player.image) this.drawVisual(v, player.pack, false, player.focus.get('cg'));
    c.restore();
    if (player.displayHolders.size) drawDisplaySlot('cgover');
    c.restore();
    const drawInterludes = () => {
      if (!player.interludes.channels.length) return;
      if (!this.interludeRenderer) throw new Error('Interlude 资源未加载');
      const focus = this.drawingFocus;
      this.drawingFocus = false;
      this.interludeRenderer.draw(
        this.context,
        player.interludes.channels,
        player.time,
        (v) => this.drawVisual(v, player.pack, true),
        (v) => this.drawVisual(v, player.pack),
        (key, rect) => {
          const image = this.images.get(key);
          if (image) this.context.drawImage(image, rect[0], rect[1], rect[2], rect[3]);
        },
      );
      this.drawingFocus = focus;
      this.interludeFrames = this.interludeRenderer.frames;
      this.interludeWaveFrames = this.interludeRenderer.waveFrames;
    };
    const overlays: { order: number; draw: () => void }[] = [];
    const photo = player.photoItem;
    if (photo)
      overlays.push({
        order: 130,
        draw: () => {
          const image = this.images.get(photo.key),
            asset = player.pack.assets[photo.key];
          if (!this.photoRenderer || !image) throw new Error('道具图片未加载：' + photo.key);
          const scale = 100 / (asset.pixelsPerUnit ?? 100);
          c.save();
          c.translate(player.camera.x, -player.camera.y);
          this.photoRenderer.draw(
            c,
            photo,
            image,
            (asset.rect?.width ?? image.width) * scale,
            (asset.rect?.height ?? image.height) * scale,
          );
          c.restore();
        },
      });
    if (player.cutins.slots.size)
      overlays.push({ order: 180, draw: () => this.drawCharacterCutins(player) });
    if (player.interludes.channels.length) overlays.push({ order: 180, draw: drawInterludes });
    for (const item of player.cgItems) {
      overlays.push({
        order: item.order,
        draw: () => {
          const context = this.context;
          context.save();
          context.translate(player.camera.x, -player.camera.y);
          this.drawVisual(
            { ...item, alpha: item.alpha * item.groupAlpha },
            player.pack,
            false,
            player.focus.get('cgitem:' + item.slotKey),
          );
          context.restore();
        },
      });
    }
    overlays.sort((a, b) => a.order - b.order);
    if (active || focusActive || bgActive) {
      let result = this.scene!;
      const systems = player.bgEffects.instances
        .filter((e) => e.particles)
        .map((e) => ({
          particles: e.particles!,
          layer: e.layer,
          order: e.order,
          minOrder: e.imageEffect ? imageOrder : undefined,
        }));
      const drawParticles = (min?: number, max?: number) => {
        if (!systems.length) return;
        if (!this.particleRenderer) throw new Error('粒子渲染器未准备');
        result = this.particleRenderer.draw(result, systems, player.time, player.camera, {
          min,
          max,
        });
        this.particleFrames = this.particleRenderer.frames;
        this.particleDrawCalls = this.particleRenderer.drawCalls;
      };
      let lower: number | undefined;
      for (const overlay of overlays) {
        if (lower === undefined || lower <= overlay.order) drawParticles(lower, overlay.order);
        this.context = this.scene!.getContext('2d', { alpha: false })!;
        if (result !== this.scene) {
          this.context.setTransform(1, 0, 0, 1, 0, 0);
          this.context.drawImage(result, 0, 0);
        }
        this.context.setTransform(width / 1280, 0, 0, height / 720, 0, 0);
        overlay.draw();
        result = this.scene!;
        lower = overlay.order + 1;
      }
      drawParticles(lower);
      if (focusActive) {
        result = this.focusFilter!.draw(result, this.focusMask!.canvas, player.focus.config);
        this.focusFrames++;
      }
      if (active) {
        result = this.filters!.draw(result, player.filters, player.time);
        this.filterFrames++;
      }
      if (bgActive) {
        if (!this.backgroundBlur || !this.effectCopy) throw new Error('背景预制体渲染器未准备');
        const parameters = player.bgEffects.parameters();
        if (parameters.enabled && parameters.degree > 0)
          for (let i = 0; i < player.bgEffects.cameraCount; i++) {
            if (i) {
              this.effectCopy.width = width;
              this.effectCopy.height = height;
              this.effectCopy.getContext('2d')!.drawImage(result, 0, 0);
              result = this.effectCopy;
            }
            result = this.backgroundBlur.draw(result, parameters, this.highResolutionRT);
            this.backgroundEffectFrames++;
          }
      }
      this.context = c = this.output;
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.globalAlpha = 1;
      c.drawImage(result, 0, 0);
      c.setTransform(width / 1280, 0, 0, height / 720, 0, 0);
    } else for (const overlay of overlays) overlay.draw();
    const originalBlocker = player.blocker,
      blocker = {
        ...originalBlocker,
        r: nativeColorUnit(originalBlocker.r),
        g: nativeColorUnit(originalBlocker.g),
        b: nativeColorUnit(originalBlocker.b),
        a: nativeColorUnit(originalBlocker.a),
      };
    if (blocker.style) {
      if (!this.slider) throw new Error('转场渲染器未准备');
      c.drawImage(this.slider.draw(blocker, width, height), 0, 0, 1280, 720);
      this.blockerFrames++;
    } else if (blocker.image && blocker.a > 0) {
      const image = this.images.get(blocker.image);
      if (!image) throw new Error('转场图片未加载：' + blocker.image);
      const rgb = [blocker.r, blocker.g, blocker.b].map((v) =>
          Math.round(Math.max(0, Math.min(1, v)) * 255),
        ),
        key = blocker.image + ':' + rgb.join(',');
      let tinted = this.blockerTints.get(key);
      if (!tinted) {
        tinted = document.createElement('canvas');
        tinted.width = image.width;
        tinted.height = image.height;
        const t = tinted.getContext('2d')!;
        t.drawImage(image, 0, 0);
        t.globalCompositeOperation = 'multiply';
        t.fillStyle = `rgb(${rgb})`;
        t.fillRect(0, 0, image.width, image.height);
        t.globalCompositeOperation = 'destination-in';
        t.drawImage(image, 0, 0);
        if (this.blockerTints.size >= 32) this.blockerTints.clear();
        this.blockerTints.set(key, tinted);
      }
      c.save();
      c.globalAlpha = Math.max(0, Math.min(1, blocker.a));
      c.translate(640, 360);
      c.scale(blocker.flipX ? -1 : 1, blocker.flipY ? -1 : 1);
      c.drawImage(tinted, -640, -360, 1280, 720);
      c.restore();
    } else {
      c.fillStyle = `rgba(${Math.min(1, Math.max(0, blocker.r)) * 255},${Math.min(1, Math.max(0, blocker.g)) * 255},${Math.min(1, Math.max(0, blocker.b)) * 255},${Math.min(1, Math.max(0, blocker.a))})`;
      c.fillRect(0, 0, 1280, 720);
    }
    for (const stamp of player.stamps) this.stampRenderer.draw(c, stamp, player.time);
    for (const view of player.spells.views.values())
      if (view.active) this.kvRenderer!.draw(c, view.kv, player.time);
    drawCurtains(c, player.curtains.states);
    if (!hideUI && player.dialog.alpha > 0 && !player.atEnd && !player.finished) {
      c.save();
      c.globalAlpha = player.dialog.alpha;
      const frameHeight = player.dialog.preset.frameHeight;
      if (this.frame) c.drawImage(this.frame, -2, 722 - frameHeight, 1284, frameHeight);
      else {
        c.fillStyle = '#000c';
        c.fillRect(-2, 722 - frameHeight, 1284, frameHeight);
      }
      this.drawDialogText(player.dialog);
      if (player.dialog.revealed >= player.dialog.text.length && !player.choices.length) {
        c.fillStyle = '#fff9';
        c.beginPath();
        c.moveTo(1160, 681);
        c.lineTo(1170, 681);
        c.lineTo(1165, 688);
        c.fill();
      }
      c.restore();
    }
    const subtitle = player.subtitle;
    if (!hideUI && subtitle.alpha > 0 && !player.atEnd && !player.finished) {
      c.save();
      c.globalAlpha = subtitle.alpha;
      const layout = this.dialogLines(
        subtitle.text,
        subtitle.markup,
        subtitle.width,
        subtitle.size,
      );
      this.drawLines(
        layout,
        subtitle.x,
        subtitle.y,
        subtitle.width,
        subtitle.alignment,
        subtitle.revealed,
        subtitle.markup,
      );
      c.restore();
    }
    // Native panel_stickers is after subtitle/dialog in the UI canvas and is
    // absent from AVGController._hideObjects, so ordinary Hide UI preserves it.
    if (!player.finished)
      for (const sticker of player.timerSticker.views(player.stickers.views)) {
        if (sticker.renderActive === false || sticker.alpha <= 0 || sticker.revealed <= 0) continue;
        c.save();
        c.globalAlpha = sticker.alpha;
        c.fillStyle = '#fff';
        c.textBaseline = 'alphabetic';
        c.textAlign = 'left';
        c.font = `${sticker.size}px ArkNative`;
        c.fontKerning = 'none';
        c.translate(sticker.x, sticker.y);
        c.rotate((-(sticker.rotation ?? 0) * Math.PI) / 180);
        c.scale(sticker.scale ?? 1, sticker.scale ?? 1);
        c.translate(-sticker.x, -sticker.y);
        const displayed = sticker.markup?.plain ?? sticker.text;
        const scale = width / 1280,
          key = JSON.stringify([sticker.text, sticker.size, sticker.width, scale]);
        let layout = this.stickerLayouts.get(key);
        // Native sticker_text and timer_sticker_text share Text #360, upper-left
        // anchoring and 0.9 line spacing. Generate at the integer raster size.
        if (!layout) {
          layout = layoutDialogText(
            c,
            displayed,
            sticker.markup,
            sticker.width,
            sticker.size,
            scale,
            0.9,
          );
          if (this.stickerLayouts.size >= 64) this.stickerLayouts.clear();
          this.stickerLayouts.set(key, layout);
        }
        for (const [i, line] of layout.lines.entries()) {
          const offset = alignedTextOffset(
            sticker.width,
            lineAdvance(line),
            sticker.alignment,
            scale,
          );
          for (const glyph of line) {
            const offsetInMessage = sticker.markup?.sourceIndex[glyph.index] ?? glyph.index;
            if (sticker.revealed <= offsetInMessage) continue;
            c.fillStyle = sticker.markup?.colors[glyph.index] ?? '#fff';
            c.font = sticker.markup
              ? readingFont(sticker.markup, glyph.index, layout.fontSize)
              : layout.fontSize + 'px ArkNative';
            c.fillText(
              glyph.char.slice(0, sticker.revealed - offsetInMessage),
              sticker.x + offset + glyph.x,
              sticker.y + layout.baselines[i],
            );
          }
        }

        c.restore();
        this.stickerFrames++;
      }
    if (player.atEnd) {
      c.fillStyle = '#ffffffa0';
      c.font = '22px ArkNative';
      c.textAlign = 'center';
      c.fillText('— 点击结束 —', 640, 660);
    }
    this.drawMovie(c, player);
  }
  private drawMovie(c: CanvasRenderingContext2D, player: StoryPlayer): void {
    const movie = player.host.video?.frame;
    if (
      player.video &&
      player.video.alpha > 0 &&
      movie &&
      movie.readyState >= 2 &&
      movie.videoWidth &&
      movie.videoHeight
    ) {
      const rect = nativeMovieRect(movie.videoWidth, movie.videoHeight);
      // The native full-stage holder is transparent; only its centered child has a Graphic.
      c.save();
      c.globalAlpha = player.video.alpha;
      c.drawImage(movie, rect.x, rect.y, rect.width, rect.height);
      c.restore();
    }
  }
  private drawReaderMovie(player: StoryPlayer, width: number, height: number): void {
    if (!player.video || player.video.alpha <= 0 || !player.host.video?.frame) return;
    // VideoCanvas is independent of the Reader state_container. In particular,
    // its held frame/fade survives theater exit and must cover DOM reader text.
    const layer = (this.readerMovieCanvas ??= document.createElement('canvas'));
    if (!layer.isConnected) {
      layer.className = 'reader-movie-layer';
      layer.setAttribute('aria-hidden', 'true');
      this.canvas.after(layer);
    }
    if (layer.width !== width || layer.height !== height) {
      layer.width = width;
      layer.height = height;
    }
    layer.hidden = false;
    const c = layer.getContext('2d')!;
    c.resetTransform();
    c.clearRect(0, 0, width, height);
    c.setTransform(width / 1280, 0, 0, height / 720, 0, 0);
    this.drawMovie(c, player);
  }
  private drawReader(player: StoryPlayer, width: number, height: number, hideUI = false): void {
    const scene = (this.readerScene ??= new ReaderScene()),
      state = player.reader.performance;
    scene.update(state, player.pack, player.time);
    this.context = this.output;
    this.drawingFocus = false;
    const c = this.context;
    c.setTransform(width / 1280, 0, 0, height / 720, 0, 0);
    c.globalAlpha = 1;
    c.fillStyle = '#000';
    c.fillRect(0, 0, 1280, 720);
    if (!state.hiddenForVideo) {
      const { x, y, sx, sy, alpha } = scene.grid;
      for (const tile of scene.tiles)
        this.drawVisual(
          {
            ...tile,
            x: x + (tile.x + tile.width / 2) * sx,
            y: y + (tile.y - tile.height / 2) * sy,
            sx,
            sy,
            alpha,
            brightness: 1,
          },
          player.pack,
          false,
          0,
          true,
        );
      for (const v of [scene.background.back, scene.background.fore])
        if (v) this.drawVisual(v, player.pack);
      // Native Reader CharSlotView hides its slots in Pure mode. Background,
      // image, photo and CG views retain their ordinary reader presentation.
      if (!player.readerPlayback.pure)
        for (const v of scene.characters) this.drawVisual(v, player.pack, true);
      for (const v of [scene.image.back, scene.image.fore]) if (v) this.drawVisual(v, player.pack);
      const photo = scene.photo;
      if (photo) {
        const image = this.images.get(photo.key),
          asset = player.pack.assets[photo.key];
        if (!image || !asset || !this.photoRenderer) throw Error('阅读道具未加载：' + photo.key);
        const scale = 100 / (asset.pixelsPerUnit ?? 100);
        this.photoRenderer.draw(
          c,
          photo,
          image,
          (asset.rect?.width ?? image.width) * scale,
          (asset.rect?.height ?? image.height) * scale,
        );
      }
      for (const v of scene.cgItems) this.drawVisual(v, player.pack);
    }
    // ReaderMainDialog._objToHide includes the full-screen background dimmer,
    // but not its two gradient graphics (drawn above the Reader text in DOM).
    if (!hideUI) {
      c.globalAlpha = Math.min(1, Math.max(0, player.readerPlayback.backgroundAlpha));
      c.fillStyle = '#000';
      c.fillRect(0, 0, 1280, 720);
      c.globalAlpha = 1;
    }
  }
  private drawCharacterCutins(player: StoryPlayer): void {
    const c = this.context,
      focus = this.drawingFocus;
    this.drawingFocus = false;
    for (const slot of player.cutins.slots.values()) {
      if (slot.width <= 0 || slot.alpha <= 0) continue;
      c.save();
      c.translate(slot.x + player.camera.x, -player.camera.y);
      c.beginPath();
      c.rect(640 - slot.width / 2, 0, slot.width, 720);
      c.clip();
      c.globalAlpha = slot.alpha;
      c.fillStyle = '#898989';
      c.fillRect(-640, 0, 2560, 720);
      if (this.frame) {
        c.save();
        c.translate(640, -50);
        c.rotate(Math.PI);
        c.globalAlpha = (slot.alpha * 180) / 255;
        c.drawImage(this.frame, -1280, -200, 2560, 200);
        c.restore();
      }
      for (const face of [slot.back, slot.front]) {
        if (!face || face.key === 'char_empty') continue;
        this.drawVisual(
          {
            key: face.key,
            x: slot.pan,
            y: NATIVE.characterY,
            sx: 1,
            sy: 1,
            alpha: face.alpha * slot.alpha,
            brightness: 1,
          },
          player.pack,
          true,
        );
      }
      c.restore();
    }
    this.drawingFocus = focus;
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.loadAbort.abort();
    if (this.dialogFont) releaseFont(this.dialogFont);
    this.dialogFont = undefined;
    this.dialogLayouts = [];
    this.readerMovieCanvas?.remove();
    this.readerMovieCanvas = null;
    this.readerScene = null;
    this.glitchRenderer?.dispose();
    this.glitchRenderer = null;
    this.glitchTextures.clear();
    this.context = this.output;
    this.frame = null;
    this.scene = null;
    this.effectCopy = null;
    this.photoRenderer = null;
    this.stampRenderer.dispose();
    this.kvRenderer?.dispose();
    this.kvRenderer = null;
    this.interludeRenderer?.dispose();
    this.interludeRenderer = null;
    this.stickerLayouts.clear();
    this.particleRenderer?.dispose();
    this.particleRenderer = null;
    this.backgroundBlur?.dispose();
    this.backgroundBlur = null;
    this.filters?.dispose();
    this.filters = null;
    this.slider?.dispose();
    this.slider = null;
    this.blockerTints.clear();
    this.focusFilter?.dispose();
    this.focusMask?.dispose();
    this.focusFilter = null;
    this.focusMask = null;
    this.alphaLayers.clear();
    this.images.clear();
    this.shades.clear();
    this.materials.clear();
  }
}
