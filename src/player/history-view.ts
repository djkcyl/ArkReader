import { lineAdvance } from '../core/line-breaking';
import type { StoryPlayer } from './runtime';
import { historyProfile as L } from './history-profile';
import { ReaderScroll } from '../core/reader-scroll';
import { NativeScrollbar } from './native-scrollbar';
import { readerVisibleRange } from './reader-layout';
import { layoutDialogText, alignedTextOffset } from './dialog-layout';
import { readingMarkup, readingFont } from '../core/sticker-color';
import { playerMediaUrl } from './package-source';
import './history-view.css';
import { NativeSelectableSurface } from './native-selectable';
type Cell = StoryPlayer['history'][number];
const logical = (n: number) => `${n / 12.8}cqw`;
function place(el: HTMLElement, rect: readonly number[]) {
  [el.style.left, el.style.top, el.style.width, el.style.height] = rect.map(logical);
}
function content(cell: Cell): string {
  return cell.decisionIndex === undefined
    ? cell.text
    : cell.text
        .split(';')
        .map((s, i) => (i === cell.decisionIndex ? `<color=#00a0e9>【${s}】</color>` : `【${s}】`))
        .join('\n');
}
/** PlaybackPanel is the legacy view, used when the host disables Reader.
 * PauseAuto does not freeze scene time. Its content-size callback scrolls to
 * the end; simply hiding/reopening the panel preserves the scroll position. */
export class HistoryView {
  private player?: StoryPlayer;
  private scroll = new ReaderScroll();
  private content = document.createElement('div');
  private scrollbar: NativeScrollbar;
  private track: HTMLElement;
  private thumb: HTMLElement;
  private measure = document.createElement('canvas').getContext('2d')!;
  private rows = new Map<
    number,
    {
      key: string;
      node: HTMLElement;
    }
  >();
  private tops: number[] = [];
  private heights: number[] = [];
  private keys: string[] = [];
  private scale = 1;
  private clock = 0;
  private appliedScroll = 0;
  private signature = '';
  private typography = '';
  private fade?: Animation;
  private closing = false;
  private pointer: {
    id: number;
    y: number;
    start: number;
    dragged: boolean;
  } | null = null;
  private resume = false;
  private selectable: NativeSelectableSurface;
  constructor(
    private dialog: HTMLDialogElement,
    private viewport: HTMLElement,
    private list: HTMLElement,
    back: HTMLElement,
  ) {
    dialog.classList.add('native-history');
    dialog.setAttribute('aria-label', '剧情回顾');
    this.content.className = 'history-content';
    list.replaceChildren(this.content);
    place(list, L.viewport);
    this.content.style.left = logical(L.content[0] - L.viewport[0]);
    this.content.style.width = logical(L.content[2]);
    place(back, L.backHit);
    back.textContent = '';
    back.setAttribute('aria-label', '返回剧情');
    const icon = document.createElement('img');
    icon.src = playerMediaUrl('native-playback-back.png');
    icon.alt = '';
    place(icon, [L.back[0] - L.backHit[0], L.back[1] - L.backHit[1], L.back[2], L.back[3]]);
    back.append(icon);
    this.scrollbar = new NativeScrollbar(
      this.scroll,
      () => this.render(),
      'history',
      list.id,
      '回顾滚动位置',
    );
    this.track = this.scrollbar.track;
    this.thumb = this.scrollbar.thumb;
    place(this.track, L.track);
    dialog.append(this.track);
    this.selectable = new NativeSelectableSurface(
      dialog,
      '#close-log,.history-track',
      () => dialog.open,
      (el) => [{ element: el === back ? icon : this.thumb }],
    );
    back.onclick = () => this.dismiss();
    dialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      this.dismiss();
    });
    dialog.addEventListener('close', () => {
      this.resumeAuto();
      this.scrollbar.update(false);
      this.clock = 0;
      this.scroll.end();
      this.pointer = null;
      this.selectable.update();
    });
    // PlaybackPanel.OnPointerClick is a no-op. Background clicks never dismiss.
    list.addEventListener('pointerdown', (e) => {
      if (e.button === 0) {
        this.scroll.velocity = 0;
        this.pointer = { id: e.pointerId, y: e.clientY, start: e.clientY, dragged: false };
      }
    });
    list.addEventListener('pointermove', (e) => {
      const p = this.pointer;
      if (!p || p.id !== e.pointerId || e.buttons === 0) return;
      if (!p.dragged && Math.abs(e.clientY - p.start) > 8) {
        p.dragged = true;
        p.y = e.clientY;
        this.scroll.begin();
        list.setPointerCapture(e.pointerId);
      }
      if (p.dragged) {
        e.preventDefault();
        this.scroll.drag((e.clientY - p.y) / this.scale);
        this.render();
      }
    });
    const end = (e: PointerEvent) => {
      if (this.pointer?.id !== e.pointerId) return;
      this.scroll.end();
      this.pointer = null;
      if (list.hasPointerCapture(e.pointerId)) list.releasePointerCapture(e.pointerId);
    };
    list.addEventListener('pointerup', end);
    list.addEventListener('pointercancel', end);
    list.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.scroll.wheel(
          ((Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) *
            (e.deltaMode === 1 ? 24 : e.deltaMode === 2 ? list.clientHeight : 1)) /
            this.scale,
        );
        this.render();
      },
      { passive: false },
    );
    list.addEventListener(
      'scroll',
      () => {
        if (Math.abs(list.scrollTop - this.appliedScroll) > 0.5) {
          this.scroll.reset(list.scrollTop / this.scale);
          this.render();
        }
      },
      { passive: true },
    );
    new ResizeObserver(() => {
      this.fit();
      if (this.player) this.update(this.player);
    }).observe(viewport);
    window.addEventListener('scroll', () => this.fit(), { passive: true });
    window.addEventListener('resize', () => this.fit(), { passive: true });
  }
  show(player: StoryPlayer): void {
    if (
      this.dialog.open ||
      player.quickPlay ||
      player.readerEnabled ||
      player.readerMode ||
      player.theaterMode ||
      player.finished ||
      player.error
    )
      return;
    this.resume = player.pauseAuto();
    this.closing = false;
    this.fade?.cancel();
    this.fit();
    this.dialog.showModal();
    this.update(player);
    this.animate(0, 1);
  }
  dismiss(): void {
    if (!this.dialog.open || this.closing) return;
    this.closing = true;
    this.scrollbar.cancel(true);
    this.resumeAuto();
    const fade = this.animate(Number(getComputedStyle(this.dialog).opacity), 0);
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
  private resumeAuto() {
    if (this.resume) {
      this.resume = false;
      if (this.player && !this.player.finished) this.player.resumeAuto();
    }
  }
  private animate(from: number, to: number) {
    this.fade?.cancel();
    return (this.fade = this.dialog.animate([{ opacity: from }, { opacity: to }], {
      duration: 0.16 * 1000,
      easing: 'cubic-bezier(.3333333333333333,.6666666666666666,.6666666666666666,1)',
      fill: 'forwards',
    }));
  }
  private fit() {
    const b = this.viewport.getBoundingClientRect();
    Object.assign(this.dialog.style, {
      left: b.left + 'px',
      top: b.top + 'px',
      width: b.width + 'px',
      height: b.height + 'px',
    });
  }
  update(player: StoryPlayer): void {
    if (!this.dialog.open) return;
    this.selectable.update();
    const changed = this.player !== player;
    this.player = player;
    const scale = this.viewport.clientWidth / 1280,
      cells = player.history,
      last = cells.at(-1);
    const signature = JSON.stringify([
      cells.length,
      last,
      scale,
      devicePixelRatio,
      document.fonts.check('24px ArkNative'),
    ]);
    if (changed || signature !== this.signature) {
      const typography = JSON.stringify([
        scale,
        devicePixelRatio,
        document.fonts.check('24px ArkNative'),
      ]);
      const resized = typography !== this.typography;
      this.typography = typography;
      this.scale = scale;
      this.signature = signature;
      if (changed || resized) {
        this.keys = [];
        for (const row of this.rows.values()) row.node.remove();
        this.rows.clear();
      }
      let top = L.padding[0];
      for (let i = 0; i < cells.length; i++) {
        const cell = cells[i],
          key = JSON.stringify(cell);
        if (this.keys[i] !== key) {
          const raw = content(cell),
            markup = readingMarkup(raw);
          const speakerMarkup = readingMarkup(cell.name);
          this.heights[i] = Math.max(
            layoutDialogText(
              this.measure,
              speakerMarkup?.plain ?? cell.name,
              speakerMarkup,
              L.name[2],
              30,
              scale,
              0.7,
            ).height,
            layoutDialogText(this.measure, markup?.plain ?? raw, markup, L.text[2], 24, scale, 0.9)
              .height + L.contentPadding,
          );
          this.keys[i] = key;
        }
        this.tops[i] = top;
        top += this.heights[i] + (i < cells.length - 1 ? L.spacing : 0);
      }
      this.tops.length = this.heights.length = this.keys.length = cells.length;
      const height = top + L.padding[2],
        sizeChanged = this.scroll.extent !== Math.max(0, height - L.viewport[3]);
      this.content.style.height = height * scale + 'px';
      this.scroll.viewport = L.viewport[3];
      this.scroll.extent = Math.max(0, height - this.scroll.viewport);
      if (changed || sizeChanged) this.scroll.reset(this.scroll.extent);
    }
    const now = performance.now();
    if (this.clock) this.scroll.tick((now - this.clock) / 1000);
    this.clock = now;
    this.render();
  }
  private render() {
    if (!this.player) return;
    this.list.scrollTop = this.scroll.bounded * this.scale;
    this.appliedScroll = this.list.scrollTop;
    this.content.style.transform = `translateY(${this.appliedScroll - this.scroll.position * this.scale}px)`;
    this.scrollbar.update(this.dialog.open);
    const [first, last] = readerVisibleRange(
      this.tops,
      this.heights,
      this.scroll.position - 100,
      this.scroll.position + this.scroll.viewport + 100,
    );
    for (const [i, r] of this.rows)
      if (i < first || i >= last) {
        r.node.remove();
        this.rows.delete(i);
      }
    for (let i = first; i < last; i++) {
      const cell = this.player.history[i],
        current =
          i === this.player.history.length - 1 &&
          cell.decisionIndex === undefined &&
          !(
            this.player.choices.length && cell.line === this.player.scheduler.currentDecision?.line
          ),
        key = this.keys[i] + '/' + current;
      let row = this.rows.get(i);
      if (!row || row.key !== key) {
        row?.node.remove();
        row = { key, node: this.row(cell, current) };
        this.rows.set(i, row);
        this.content.append(row.node);
      }
      row.node.style.top = this.tops[i] * this.scale + 'px';
      row.node.style.height = this.heights[i] * this.scale + 'px';
    }
  }
  private text(raw: string, width: number, size: number, color: string, right = false) {
    const markup = readingMarkup(raw),
      layout = layoutDialogText(
        this.measure,
        markup?.plain ?? raw,
        markup,
        width,
        size,
        this.scale,
        right ? 0.7 : 0.9,
        right ? 24 : size,
      );
    const canvas = document.createElement('canvas'),
      dpr = devicePixelRatio || 1;
    canvas.width = Math.ceil(width * this.scale * dpr);
    canvas.height = Math.ceil(Math.max(layout.height + 5, size) * this.scale * dpr);
    canvas.style.width = width * this.scale + 'px';
    canvas.style.height = canvas.height / dpr + 'px';
    canvas.setAttribute('aria-hidden', 'true');
    const ctx = canvas.getContext('2d')!;
    ctx.scale(this.scale * dpr, this.scale * dpr);
    ctx.fontKerning = 'none';
    ctx.textBaseline = 'alphabetic';
    layout.lines.forEach((line, y) => {
      const offset = alignedTextOffset(
        width,
        lineAdvance(line),
        right ? 'right' : 'left',
        this.scale,
      );
      for (const glyph of line) {
        ctx.font = markup
          ? readingFont(markup, glyph.index, layout.fontSize)
          : layout.fontSize + 'px ArkNative';
        ctx.fillStyle = markup?.colors[glyph.index] ?? color;
        ctx.fillText(glyph.char, offset + glyph.x, layout.baselines[y]);
      }
    });
    return canvas;
  }
  private row(cell: Cell, current: boolean) {
    const row = document.createElement('article');
    row.dataset.line = String(cell.line);
    row.className = 'history-cell';
    const name = document.createElement('span');
    name.className = 'history-name';
    name.setAttribute('aria-label', cell.name);
    name.append(this.text(cell.name, L.name[2], 30, '#929292', true));
    const raw = content(cell),
      text = document.createElement('div');
    text.className = 'history-text';
    text.setAttribute('aria-label', readingMarkup(raw)?.plain ?? raw);
    text.append(this.text(raw, L.text[2], 24, 'white'));
    text.style.left = logical(L.text[0]);
    text.style.top = logical(L.text[1]);
    const marker = (file: string, rect: readonly number[], label: string) => {
      const img = document.createElement('img');
      img.src = playerMediaUrl(file);
      img.alt = label;
      place(img, rect);
      row.append(img);
    };
    if (current) {
      row.classList.add('current');
      marker('native-playback-current.png', L.current, '当前记录');
    }
    if (cell.decisionIndex !== undefined) {
      row.dataset.decisionIndex = String(cell.decisionIndex);
      if (cell.decisionIndex >= 0 && cell.decisionIndex < 3)
        marker('native-playback-chosen.png', L.chosen[cell.decisionIndex], '已选择');
    }
    row.append(name, text);
    return row;
  }
}
