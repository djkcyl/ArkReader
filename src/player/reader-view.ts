import { lineAdvance } from '../core/line-breaking';
import type { StoryPlayer } from './runtime';
import type { ReaderCell } from '../core/reader-model';
import { readingMarkup, readingFont } from '../core/sticker-color';
import { layoutDialogText, alignedTextOffset, textCanvasPixelHeight } from './dialog-layout';
import {
  measureReaderCell,
  readerCellText,
  readerVisibleRange,
  READER_LAYOUT as L,
} from './reader-layout';
import { playerMediaUrl } from './resource-urls';
import { ReaderScroll } from '../core/reader-scroll';
import { NativeScrollbar } from './native-scrollbar';
import { NativeSelectableSurface } from './native-selectable';
import { bindReviewJump } from './review-jump';

/** Separate Reader scroll surface. Layout snapshots survive scrolling; only
 * visible rows own DOM/canvas objects, like the native recycle-list adapter. */
export class ReaderView {
  private player: StoryPlayer | undefined;
  private version = -1;
  private choiceLine = -1;
  private wasVisible = false;
  private pointer: { x: number; y: number; dragged: boolean; id: number; dragY: number } | null =
    null;
  private scroll = new ReaderScroll();
  private scrollbar: NativeScrollbar;
  private selectable: NativeSelectableSurface;
  private topButton = document.createElement('button');
  private topIcon = document.createElement('img');
  private gradients = document.createElement('div');
  private lastFrame = 0;
  private appliedScroll = 0;
  private contentHeight = 0;
  private suppressReaderClick = false;
  private content = document.createElement('div');
  private measure = document.createElement('canvas').getContext('2d')!;
  private rows = new Map<number, { key: string; node: HTMLElement }>();
  private keys: string[] = [];
  private tops: number[] = [];
  private heights: number[] = [];
  private scale = 1;
  private settingsKey = '';
  constructor(
    readonly element: HTMLElement,
    private jump?: (cell: ReaderCell) => void,
  ) {
    this.scrollbar = new NativeScrollbar(
      this.scroll,
      () => this.applyScroll(),
      'reader',
      element.id,
      '阅读滚动位置',
    );
    this.scrollbar.track.hidden = true;
    element.after(this.scrollbar.track);
    this.selectable = new NativeSelectableSurface(
      element.parentElement!,
      '.reader-track,.review-jump',
      () => !element.hidden,
      (el) =>
        el.classList.contains('review-jump')
          ? [
              { element: el, pseudo: '::before' },
              ...[...el.querySelectorAll('canvas')].map((element) => ({ element })),
            ]
          : [{ element: this.scrollbar.thumb }],
    );
    this.content.className = 'reader-content';
    element.replaceChildren(this.content);
    this.gradients.className = 'reader-gradients';
    this.gradients.hidden = true;
    this.gradients.setAttribute('aria-hidden', 'true');
    element.after(this.gradients);
    this.topButton.className = 'reader-top';
    this.topButton.hidden = true;
    this.topButton.setAttribute('aria-label', '回到阅读开头');
    // /api/profile publishes Reader sprites during first preparation. Do not
    // request this hidden image while the fresh resource library is still cold.
    this.topIcon.alt = '';
    this.topButton.append(this.topIcon);
    element.after(this.topButton);
    this.topButton.onclick = (e) => {
      e.stopPropagation();
      this.scroll.reset(0);
      this.applyScroll();
    };
    let topPress: { id: number; x: number; y: number } | null = null;
    this.topButton.onpointerdown = (e) => {
      if (e.pointerType === 'touch') topPress = { id: e.pointerId, x: e.clientX, y: e.clientY };
    };
    this.topButton.onpointerup = (e) => {
      const press = topPress;
      topPress = null;
      // Chromium can suppress compatibility click during a touch scroll. Native
      // Unity PointerClick is delivered on release; retain click for keyboard/mouse.
      if (press?.id === e.pointerId && Math.hypot(e.clientX - press.x, e.clientY - press.y) < 8) {
        e.preventDefault();
        e.stopPropagation();
        this.suppressReaderClick = true;
        this.scroll.reset(0);
        this.applyScroll();
      }
    };
    this.topButton.onpointercancel = () => {
      topPress = null;
    };
    element.addEventListener(
      'scroll',
      () => {
        // Native scrollbar/keyboard and external accessibility scrolls remain usable.
        if (Math.abs(element.scrollTop - this.appliedScroll) > 0.5)
          this.scroll.reset(element.scrollTop / this.scale);
        this.applyScroll();
      },
      { passive: true },
    );
    element.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      this.suppressReaderClick = false;
      this.scroll.velocity = 0;
      this.pointer = {
        x: e.clientX,
        y: e.clientY,
        dragY: e.clientY,
        dragged: false,
        id: e.pointerId,
      };
    });
    element.addEventListener('pointermove', (e) => {
      const point = this.pointer;
      if (!point || point.id !== e.pointerId || e.buttons === 0) return;
      if (!point.dragged && Math.hypot(e.clientX - point.x, e.clientY - point.y) > 8) {
        point.dragged = true;
        point.dragY = e.clientY;
        this.scroll.begin();
        this.player?.readerPlayback.stopAuto();
        element.setPointerCapture(e.pointerId);
      }
      if (point.dragged) {
        e.preventDefault();
        this.scroll.drag((e.clientY - point.dragY) / this.scale);
        this.applyScroll();
      }
    });
    const end = (e: PointerEvent) => {
      if (this.pointer?.id !== e.pointerId) return;
      if (e.type === 'pointercancel') this.pointer.dragged = true;
      this.scroll.end();
      if (element.hasPointerCapture(e.pointerId)) element.releasePointerCapture(e.pointerId);
    };
    element.addEventListener('pointerup', end);
    element.addEventListener('pointercancel', end);
    element.addEventListener(
      'wheel',
      (e) => {
        // Native OnScrollWork does not emit Reader's drag-begin message; wheel
        // scrolling preserves auto, unlike a pressed-pointer drag.
        e.preventDefault();
        const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        this.scroll.wheel(
          (delta * (e.deltaMode === 1 ? 24 : e.deltaMode === 2 ? element.clientHeight : 1)) /
            this.scale,
        );
        this.applyScroll();
      },
      { passive: false },
    );
    element.addEventListener('click', (e) => {
      // The top button disappears at the endpoint. A delayed compatibility click
      // may target the newly exposed Reader surface; it must not advance the story.
      if (this.suppressReaderClick) {
        this.suppressReaderClick = false;
        return;
      }
      if ((e.target as HTMLElement).closest('button') || this.pointer?.dragged) return;
      this.advance();
    });
  }
  /** Shared manual input route: native View checks ShouldScrollToEnd before
   * invoking the adapter's click callback. Keyboard/canvas must use it too. */
  advance(): void {
    const player = this.player;
    if (!player || !player.readerVisible || this.element.hidden || player.paused || player.error)
      return;
    if (player.readerShouldScrollToEnd) this.scroll.reset(this.scroll.extent);
    player.pressAdvance();
    this.applyScroll();
  }
  update(player: StoryPlayer, hidden = false): void {
    const visible = player.readerVisible && !hidden;
    this.gradients.hidden = !player.readerVisible;
    this.element.hidden = !visible;
    // Hide All toggles panel_ui, not the Reader dialog itself. Restoring it must
    // not invoke the opening reset and lose the user's position in the history.
    if (!visible) {
      this.wasVisible = hidden && player.readerVisible && this.player === player && this.wasVisible;
      this.topButton.hidden = true;
      this.scrollbar.update(false);
      this.selectable.reset();
      this.lastFrame = 0;
      this.scroll.end();
      this.scroll.velocity = 0;
      return;
    }
    if (!this.topIcon.getAttribute('src'))
      this.topIcon.src = playerMediaUrl('native-reader-top.png');
    const changedPlayer = this.player !== player,
      opening = !this.wasVisible || changedPlayer;
    this.wasVisible = true;
    this.player = player;
    const settings = player.readerPlayback,
      scale = (this.element.parentElement?.clientWidth ?? 1280) / 1280;
    const now = performance.now();
    if (this.lastFrame) this.scroll.tick((now - this.lastFrame) / 1000);
    this.lastFrame = now;
    this.element.style.setProperty('--reader-font', `${settings.font.size / 12.8}cqw`);
    this.element.style.setProperty('--reader-name-font', `${settings.font.nameSize / 12.8}cqw`);
    this.element.style.setProperty('--reader-spacing', `${settings.cellSpacing / 12.8}cqw`);
    const settingsKey = [
      settings.font.size,
      settings.font.nameSize,
      settings.cellSpacing,
      scale,
      devicePixelRatio,
      document.fonts.check('24px ArkNative'),
    ].join('/');
    const settingsChanged = settingsKey !== this.settingsKey;
    const choiceLine = player.choices.length ? (player.scheduler.currentDecision?.line ?? -1) : -1;
    if (
      !opening &&
      !settingsChanged &&
      this.version === player.reader.version &&
      this.choiceLine === choiceLine
    ) {
      this.applyScroll();
      return;
    }
    this.version = player.reader.version;
    this.choiceLine = choiceLine;
    this.scale = scale;
    this.settingsKey = settingsKey;
    if (changedPlayer || settingsChanged) {
      this.keys = [];
      for (const row of this.rows.values()) row.node.remove();
      this.rows.clear();
    }
    const cells = player.reader.cells;
    let top = L.padding;
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i],
        key = JSON.stringify([
          cell.name,
          cell.text,
          cell.decision,
          cell.decisionIndex,
          cell.endtip,
        ]);
      if (this.keys[i] !== key) {
        this.heights[i] = measureReaderCell(
          this.measure,
          cell,
          settings.font.size,
          scale,
          settings.font.nameSize,
          devicePixelRatio || 1,
        );
        this.keys[i] = key;
      }
      this.tops[i] = top;
      top += this.heights[i] + (i < cells.length - 1 ? settings.cellSpacing : 0);
    }
    this.tops.length = this.heights.length = this.keys.length = cells.length;
    const height = (top + L.padding) * scale,
      sizeChanged = this.contentHeight !== height;
    this.contentHeight = height;
    this.content.style.height = height + 'px';
    this.scroll.viewport = this.element.clientHeight / scale;
    this.scroll.extent = Math.max(0, (height - this.element.clientHeight) / scale);
    // _EventOnContentSizeChanged always resets to the latest text.
    if (opening || settingsChanged || sizeChanged) this.scroll.reset(this.scroll.extent);
    this.applyScroll();
  }
  private applyScroll(): void {
    this.element.scrollTop = this.scroll.bounded * this.scale;
    this.appliedScroll = this.element.scrollTop;
    this.content.style.transform = `translateY(${this.appliedScroll - this.scroll.position * this.scale}px)`;
    this.scrollbar.update(this.wasVisible && !this.element.hidden);
    this.selectable.update();
    this.element.style.right = this.scrollbar.track.hidden ? '0px' : '.46875cqw';
    this.topButton.hidden = !this.wasVisible || !this.scroll.showTop;
    this.renderVisible();
  }
  private renderVisible(): void {
    const p = this.player;
    if (!p || !this.wasVisible) return;
    const top = this.scroll.position,
      bottom = top + this.element.clientHeight / this.scale;
    const [first, last] = readerVisibleRange(this.tops, this.heights, top - 150, bottom + 150);
    for (const [i, row] of this.rows)
      if (i < first || i >= last) {
        row.node.remove();
        this.rows.delete(i);
      }
    for (let i = first; i < last; i++) {
      const cell = p.reader.cells[i],
        live = cell.decision && cell.line === this.choiceLine && i === p.reader.cells.length - 1;
      const key = this.keys[i] + '/' + cell.current + '/' + live;
      let row = this.rows.get(i);
      if (!row || row.key !== key) {
        row?.node.remove();
        row = { key, node: this.createRow(cell, i, live) };
        this.rows.set(i, row);
        this.content.append(row.node);
      }
      row.node.style.top = this.tops[i] * this.scale + 'px';
      row.node.style.height = this.heights[i] * this.scale + 'px';
    }
  }
  private textCanvas(
    raw: string,
    width: number,
    size: number,
    lineSpacing: number,
    color: string,
    right = false,
    minSize = size,
  ): HTMLCanvasElement {
    const markup = readingMarkup(raw),
      layout = layoutDialogText(
        this.measure,
        markup?.plain ?? raw,
        markup,
        width,
        size,
        this.scale,
        lineSpacing,
        minSize,
      );
    const canvas = document.createElement('canvas'),
      dpr = devicePixelRatio || 1;
    canvas.width = Math.ceil(width * this.scale * dpr);
    canvas.height = textCanvasPixelHeight(layout, size, this.scale, dpr);
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
  private createRow(cell: ReaderCell, index: number, live: boolean): HTMLElement {
    const p = this.player!,
      settings = p.readerPlayback,
      row = document.createElement('article');
    row.className = 'reader-cell';
    row.dataset.cell = String(index);
    row.dataset.line = String(cell.line);
    row.classList.toggle('current', cell.current);
    const name = document.createElement('span');
    name.className = 'reader-name';
    name.setAttribute('aria-label', cell.name);
    name.append(
      this.textCanvas(cell.name, L.nameWidth, settings.font.nameSize, 0.7, '#929292', true, 24),
    );
    const text = document.createElement('div');
    text.className = 'reader-text';
    if (cell.current) {
      const marker = document.createElement('img');
      marker.className = 'reader-current';
      marker.src = playerMediaUrl('native-reader-current.png');
      marker.alt = '';
      row.append(marker);
    }
    if (cell.endtip) {
      row.classList.add('reader-end');
      text.setAttribute('aria-label', '剧情结束');
      for (const kind of ['line-left', 'end', 'line-right']) {
        const img = document.createElement('img');
        img.alt = '';
        img.className = 'reader-' + kind;
        img.src = playerMediaUrl(
          kind === 'end' ? 'native-reader-end.png' : 'native-reader-line.png',
        );
        text.append(img);
      }
    } else if (live) {
      row.classList.add('reader-live-decision');
      for (const [i, option] of cell.text.split(';').entries()) {
        const button = document.createElement('button');
        button.dataset.readerOption = String(i);
        button.setAttribute('aria-label', option);
        const bg = document.createElement('span');
        bg.className = 'reader-option-bg';
        bg.setAttribute('aria-hidden', 'true');
        button.append(bg);
        const icon = document.createElement('img');
        icon.className = 'reader-option-icon';
        icon.src = playerMediaUrl('native-reader-option-icon.png');
        icon.alt = '';
        button.append(icon);
        button.append(this.textCanvas(option, 720, settings.font.size, 1, 'white'));
        button.onclick = (e) => {
          e.stopPropagation();
          p.choose(i);
        };
        text.append(button);
      }
    } else {
      const raw = readerCellText(cell);
      text.setAttribute('aria-label', readingMarkup(raw)?.plain ?? raw);
      text.append(this.textCanvas(raw, L.textWidth, settings.font.size, 0.9, 'white'));
      if (cell.decision) {
        row.classList.add('reader-decision');
        // Three authored markers; the native view shows only the selected index.
        if (cell.decisionIndex >= 0 && cell.decisionIndex < 3) {
          const arrow = document.createElement('img');
          arrow.className = 'reader-chosen';
          arrow.src = playerMediaUrl('native-reader-chosen.png');
          arrow.alt = '已选择';
          arrow.style.top = (5.5 + 32 * cell.decisionIndex) / 12.8 + 'cqw';
          row.append(arrow);
        }
      }
    }
    row.append(name, text);
    if (this.jump && !cell.current && !cell.endtip && !live && p.reviewPosition(cell))
      bindReviewJump(
        row,
        readerCellText(cell),
        () => this.jump?.(cell),
        () => !!this.pointer?.dragged || this.suppressReaderClick,
      );
    return row;
  }
}
