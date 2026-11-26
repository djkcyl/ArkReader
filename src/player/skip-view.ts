import { skipProfile as L } from './skip-profile';
import { NativeSelectableSurface } from './native-selectable';
import { playerMediaUrl } from './resource-urls';
import { readingMarkup, readingFont } from '../core/sticker-color';
import { lineAdvance } from '../core/line-breaking';
import { layoutDialogText, alignedTextOffset } from './dialog-layout';
import type { StoryPlayer } from './runtime';
import './skip-view.css';

type Graphic = {
  id: number;
  path: string;
  rect: number[];
  mode: string;
  color: number[];
  sprite?: string;
  border?: number[];
  rotation?: number;
  origin?: number[];
  dynamic?: string;
  text?: string;
  font?: {
    m_FontSize: number;
    m_BestFit: number;
    m_MinSize: number;
    m_MaxSize: number;
    m_LineSpacing: number;
    m_Alignment: number;
  };
};
const logical = (n: number) => n / 12.8 + 'cqw';
function place(el: HTMLElement, r: number[]) {
  [el.style.left, el.style.top, el.style.width, el.style.height] = r.map(logical);
}

/** Original SkipBriefPanel has two layouts, a background cancel button and a
 * raycast-blocking center panel. Scene time continues while auto is paused. */
export class SkipView {
  private player?: StoryPlayer;
  private auto = false;
  private resumed = true;
  private fade?: Animation;
  private closing = false;
  private backgroundPress = false;
  private art = document.createElement('div');
  private blocker = document.createElement('div');
  private cancel = document.createElement('button');
  private confirm = document.createElement('button');
  private selectable: NativeSelectableSurface;
  private images = new Map<number, HTMLElement>();
  private texts: { graphic: Graphic; canvas: HTMLCanvasElement; text: string; rect: number[] }[] =
    [];
  constructor(
    private dialog: HTMLDialogElement,
    private viewport: HTMLElement,
    private sync: () => void,
  ) {
    dialog.className = 'native-skip';
    dialog.setAttribute('aria-label', '跳过剧情');
    this.art.className = 'skip-art';
    this.blocker.className = 'skip-center';
    this.cancel.id = 'cancel-skip';
    this.cancel.setAttribute('aria-label', '继续阅读');
    this.confirm.id = 'confirm-skip';
    this.confirm.setAttribute('aria-label', '确认跳过');
    dialog.replaceChildren(this.art, this.blocker, this.cancel, this.confirm);
    this.blocker.onclick = (e) => e.stopPropagation();
    this.cancel.onclick = () => this.dismiss(false);
    this.confirm.onclick = () => this.dismiss(true);
    dialog.onpointerdown = (e) => {
      this.backgroundPress = e.button === 0 && e.target === dialog;
    };
    dialog.onclick = (e) => {
      if (e.target === dialog && (e.detail === 0 || this.backgroundPress)) this.dismiss(false);
      this.backgroundPress = false;
    };
    dialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      this.dismiss(false);
    });
    dialog.addEventListener('close', () => {
      this.resume();
      this.selectable.reset();
    });
    this.selectable = new NativeSelectableSurface(
      dialog,
      'button',
      () => dialog.open && !this.closing,
      (el) => [{ element: el.querySelector('span')! }],
    );
    new ResizeObserver(() => {
      this.fit();
      this.drawTexts();
    }).observe(viewport);
    window.addEventListener('resize', () => this.fit(), { passive: true });
    window.addEventListener('scroll', () => this.fit(), { passive: true });
  }
  show(player: StoryPlayer): void {
    if (!player.canSkip || this.dialog.open) return;
    this.player = player;
    this.closing = false;
    delete this.dialog.dataset.audioClosing;
    this.fade?.cancel();
    this.backgroundPress = false;
    player.readerPlayback.pauseAuto();
    this.auto = player.pauseAuto();
    this.resumed = false;
    this.render();
    this.fit();
    this.dialog.showModal();
    this.drawTexts();
    this.selectable.update();
    this.animate(0, 1);
  }
  clear() {
    this.fade?.cancel();
    this.resumed = true;
    this.auto = false;
    this.player = undefined;
    this.dialog.close();
    this.selectable.reset();
    this.closing = false;
  }
  private resume() {
    if (this.resumed) return;
    this.resumed = true;
    if (this.player && !this.player.finished) {
      this.player.readerPlayback.resumeAuto();
      if (this.auto) this.player.resumeAuto();
    }
    this.auto = false;
  }
  private dismiss(confirm: boolean) {
    if (!this.dialog.open || this.closing) return;
    this.closing = true;
    this.dialog.dataset.audioClosing = '1';
    this.resume();
    const fade = this.animate(Number(getComputedStyle(this.dialog).opacity), 0);
    // Native hides via tween BEFORE invoking _onConfirm; auto is already restored.
    if (confirm) {
      this.player?.skip();
      this.sync();
    }
    void fade.finished
      .then(() => {
        if (this.fade === fade) {
          this.dialog.close();
          fade.cancel();
          this.closing = false;
        }
      })
      .catch(() => {});
  }
  private animate(from: number, to: number) {
    this.fade?.cancel();
    return (this.fade = this.dialog.animate([{ opacity: from }, { opacity: to }], {
      duration: L.fadeSeconds * 1000,
      easing: 'cubic-bezier(.3333333333333333,.6666666666666666,.6666666666666666,1)',
      fill: 'both',
    }));
  }
  private fit() {
    const r = this.viewport.getBoundingClientRect();
    Object.assign(this.dialog.style, {
      left: r.left + 'px',
      top: r.top + 'px',
      width: r.width + 'px',
      height: r.height + 'px',
    });
  }
  private render() {
    const brief = this.player!.skipBrief,
      mode = brief ? 'brief' : 'none';
    this.dialog.dataset.mode = mode;
    this.art.replaceChildren();
    this.texts = [];
    this.images.clear();
    const targets = L.buttons.filter((b) => b.mode === mode).map((b) => b.target);
    for (const g of L.graphics as Graphic[]) {
      if (g.mode !== 'all' && g.mode !== mode) continue;
      if (g.path === '/panel_brief') {
        this.dialog.style.background = `rgba(0,0,0,${g.color[3]})`;
        continue;
      }
      if (g.font) {
        const canvas = document.createElement('canvas');
        canvas.className = 'skip-text';
        canvas.dataset.nativeId = String(g.id);
        const text = g.dynamic
          ? String((brief as unknown as Record<string, string>)?.[g.dynamic] ?? '')
          : (g.text ?? '');
        canvas.setAttribute('aria-label', readingMarkup(text)?.plain ?? text);
        if (g.dynamic === 'content') canvas.id = 'skip-summary';
        this.art.append(canvas);
        this.texts.push({ graphic: g, canvas, text, rect: g.rect });
      } else {
        const image = document.createElement('span');
        image.className = 'skip-image';
        image.dataset.nativeId = String(g.id);
        place(image, g.rect);
        if (g.rotation) {
          image.style.transform = `rotate(${g.rotation}deg)`;
          image.style.transformOrigin = g.origin!.map((v) => v * 100 + '%').join(' ');
        }
        if (g.sprite) {
          const url = `url("${playerMediaUrl(g.sprite)}")`;
          if (g.border) {
            const [l, b, r, t] = g.border;
            Object.assign(image.style, {
              borderStyle: 'solid',
              borderWidth: [t, r, b, l].map(logical).join(' '),
              borderImageSource: url,
              borderImageSlice: `${t} ${r} ${b} ${l} fill`,
            });
          } else {
            image.style.backgroundImage = url;
            image.style.backgroundSize = '100% 100%';
          }
          image.style.opacity = String(g.color[3]);
        }
        this.images.set(g.id, image);
        if (!targets.includes(g.id)) this.art.append(image);
      }
    }
    place(this.blocker, brief ? L.briefRect : L.nonBriefRect);
    for (const b of L.buttons.filter((b) => b.mode === mode)) {
      const button = b.action === 'confirm' ? this.confirm : this.cancel,
        icon = this.images.get(b.target)!;
      const g = (L.graphics as Graphic[]).find((g) => g.id === b.target)!;
      place(button, b.rect);
      place(icon, [g.rect[0] - b.rect[0], g.rect[1] - b.rect[1], g.rect[2], g.rect[3]]);
      button.replaceChildren(icon);
    }
    this.selectable.reset();
  }
  private drawTexts() {
    if (!this.texts.length) return;
    const scale = this.viewport.clientWidth / 1280,
      dpr = devicePixelRatio || 1;
    const measure = document.createElement('canvas').getContext('2d')!;
    const heading = this.texts.filter((t) =>
      ['chapterName', 'title', 'tag'].includes(t.graphic.dynamic ?? ''),
    );
    if (heading.length) {
      const widths = heading.map((t) => {
        const m = readingMarkup(t.text),
          l = layoutDialogText(
            measure,
            m?.plain ?? t.text,
            m,
            Infinity,
            t.graphic.font!.m_FontSize,
            scale,
            1,
          );
        return Math.max(0, ...l.lines.map(lineAdvance));
      });
      const total = widths.reduce((a, b) => a + b, 0),
        available = L.titleRect[2] - L.titleSpacing * 2,
        ratio = Math.min(1, available / (total || 1));
      let x = L.titleRect[0] + (L.titleRect[2] - (total * ratio + L.titleSpacing * 2)) / 2;
      heading.forEach((t, i) => {
        t.rect = [x, t.graphic.rect[1], widths[i] * ratio, t.graphic.rect[3]];
        x += t.rect[2] + L.titleSpacing;
      });
    }
    for (const t of this.texts) {
      const { canvas, text, rect, graphic: g } = t,
        f = g.font!,
        markup = readingMarkup(text),
        plain = markup?.plain ?? text;
      let size = f.m_FontSize;
      const min = g.dynamic === 'content' ? 1 : f.m_BestFit ? Math.max(1, f.m_MinSize) : size;
      let layout = layoutDialogText(measure, plain, markup, rect[2], size, scale, f.m_LineSpacing);
      while (size > min && layout.height > rect[3])
        layout = layoutDialogText(measure, plain, markup, rect[2], --size, scale, f.m_LineSpacing);
      place(canvas, rect);
      canvas.width = Math.max(1, Math.ceil(rect[2] * scale * dpr));
      canvas.height = Math.max(1, Math.ceil(rect[3] * scale * dpr));
      canvas.dataset.fontSize = String(size);
      const c = canvas.getContext('2d')!;
      c.scale(scale * dpr, scale * dpr);
      c.fontKerning = 'none';
      c.textBaseline = 'alphabetic';
      const align = ['left', 'center', 'right'][f.m_Alignment % 3],
        y = (rect[3] - layout.height) * (Math.floor(f.m_Alignment / 3) / 2);
      layout.lines.forEach((line, i) => {
        const x = alignedTextOffset(rect[2], lineAdvance(line), align, scale);
        for (const glyph of line) {
          c.font = markup
            ? readingFont(markup, glyph.index, layout.fontSize)
            : layout.fontSize + 'px ArkNative';
          c.fillStyle =
            markup?.colors[glyph.index] ??
            `rgba(${g.color
              .slice(0, 3)
              .map((v) => v * 255)
              .join(',')},${g.color[3]})`;
          c.fillText(glyph.char, x + glyph.x, y + layout.baselines[i]);
        }
      });
    }
  }
}
