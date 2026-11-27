import { ReaderScroll } from '../core/reader-scroll';
import { stagePoint, stageRect, stageSize } from './stage-geometry';
import {
  clampScrollbar,
  scrollbarPage,
  scrollbarDrag,
  scrollbarStartsDrag,
} from '../core/native-scrollbar';
/** Pointer adapter for the original vertical Scrollbar shared by both views.
 * Repetition retains the press point (not the latest pointer position). */
export class NativeScrollbar {
  readonly track = document.createElement('div');
  readonly thumb = document.createElement('div');
  private press?: {
    id: number;
    x: number;
    y: number;
    dragged: boolean;
    offset: number;
  };
  private frame = 0;
  private cancelledPointer: number | undefined;
  constructor(
    private scroll: ReaderScroll,
    private changed: () => void,
    prefix: string,
    controls: string,
    label: string,
  ) {
    this.track.className = prefix + '-track';
    this.thumb.className = prefix + '-thumb';
    this.track.append(this.thumb);
    this.track.tabIndex = 0;
    this.track.setAttribute('role', 'scrollbar');
    this.track.setAttribute('aria-label', label);
    this.track.setAttribute('aria-controls', controls);
    this.track.setAttribute('aria-orientation', 'vertical');
    this.track.onpointerdown = (e) => {
      if (e.button !== 0 || this.press || this.track.hidden) return;
      e.preventDefault();
      e.stopPropagation();
      this.track.focus({ preventScroll: true });
      const point = stagePoint(this.track, e);
      this.press = { id: e.pointerId, x: point.x, y: point.y, dragged: false, offset: 0 };
      this.track.setPointerCapture(e.pointerId);
      this.page();
      this.frame = requestAnimationFrame(() => this.repeat());
    };
    this.track.onpointermove = (e) => {
      const p = this.press;
      if (!p || p.id !== e.pointerId) return;
      const point = stagePoint(this.track, e);
      if (
        !p.dragged &&
        scrollbarStartsDrag((point.x - p.x) * devicePixelRatio, (point.y - p.y) * devicePixelRatio)
      ) {
        p.dragged = true;
        cancelAnimationFrame(this.frame);
        this.frame = 0;
        const h = stageRect(this.thumb, this.track);
        // OnBeginDrag tests the ORIGINAL press point against the CURRENT handle.
        p.offset =
          p.x >= h.x && p.x <= h.x + h.width && p.y >= h.y && p.y <= h.y + h.height
            ? h.y + h.height / 2 - p.y
            : 0;
      }
      if (p.dragged) {
        e.preventDefault();
        const height = stageSize(this.track).height;
        const value = scrollbarDrag(height - point.y, p.offset, height, this.size);
        if (value !== undefined) this.setValue(value);
      }
    };
    const release = (e: PointerEvent) => {
      if (this.press?.id === e.pointerId) this.cancel();
    };
    this.track.onpointerup = release;
    this.track.onpointercancel = release;
    this.track.onlostpointercapture = release;
    window.addEventListener('playback-screen-mode', () => this.cancel(true));
    this.track.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
    };
    this.track.addEventListener('native-navigation-move', (e) => {
      const direction = (e as CustomEvent<string>).detail;
      if (direction === 'up' || direction === 'down')
        this.setValue(clampScrollbar(this.value + (direction === 'up' ? 0.1 : -0.1)));
    });
    // Deactivating a captured touch target must not send its compatibility click
    // to the newly exposed story canvas (which would reveal UI/advance text).
    window.addEventListener(
      'pointerdown',
      () => {
        this.cancelledPointer = undefined;
      },
      true,
    );
    window.addEventListener(
      'click',
      (e) => {
        if (e instanceof PointerEvent && e.detail !== 0 && e.pointerId === this.cancelledPointer) {
          this.cancelledPointer = undefined;
          e.preventDefault();
          e.stopImmediatePropagation();
        }
      },
      true,
    );
    this.track.onkeydown = (e) => {
      let value: number | undefined;
      // Native continuous Scrollbar step is .1. Home/End/Page keys are retained
      // browser accessibility bindings, not claimed original physical key maps.
      if (e.key === 'ArrowUp') value = this.value + 0.1;
      else if (e.key === 'ArrowDown') value = this.value - 0.1;
      else if (e.key === 'Home') value = 1;
      else if (e.key === 'End') value = 0;
      else if (e.key === 'PageUp' || e.key === 'PageDown')
        value = scrollbarPage(this.value, this.size, e.key === 'PageUp');
      if (value !== undefined) {
        e.preventDefault();
        e.stopPropagation();
        this.setValue(clampScrollbar(value));
      }
    };
    window.addEventListener('blur', () => this.cancel(true));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.cancel(true);
    });
  }
  private get size() {
    const s = this.scroll;
    return clampScrollbar(
      (s.viewport - Math.abs(s.position - s.bounded)) / (s.extent + s.viewport || 1),
    );
  }
  private get value() {
    return clampScrollbar(this.scroll.normalized);
  }
  private setValue(value: number) {
    if (value === this.value) return;
    const position = (1 - value) * this.scroll.extent;
    // UIWrappedScrollRect.SetNormalizedPosition ignores <= .01 logical pixel.
    if (Math.abs(position - this.scroll.position) <= 0.01) return;
    this.scroll.reset(position);
    this.changed();
  }
  private page() {
    const p = this.press;
    if (!p || p.dragged) return;
    const h = stageRect(this.thumb, this.track);
    if (p.x >= h.x && p.x <= h.x + h.width && p.y >= h.y && p.y <= h.y + h.height) return;
    this.setValue(scrollbarPage(this.value, this.size, p.y < h.y + h.height / 2));
  }
  private repeat() {
    this.frame = 0;
    if (!this.press || this.press.dragged || this.track.hidden) return;
    this.page();
    this.frame = requestAnimationFrame(() => this.repeat());
  }
  cancel(suppressClick = false): void {
    const p = this.press;
    this.press = undefined;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    if (p && suppressClick) this.cancelledPointer = p.id;
    if (p && this.track.hasPointerCapture(p.id)) this.track.releasePointerCapture(p.id);
  }
  update(visible = true): void {
    const s = this.scroll;
    this.track.hidden = !visible || s.extent <= 0.01;
    if (this.track.hidden) {
      this.cancel(true);
      if (document.activeElement === this.track) this.track.blur();
    }
    this.thumb.style.height = this.size * 100 + '%';
    this.thumb.style.top = (1 - this.value) * (1 - this.size) * 100 + '%';
    this.track.setAttribute('aria-valuemin', '0');
    this.track.setAttribute('aria-valuemax', String(s.extent));
    this.track.setAttribute('aria-valuenow', String(s.bounded));
  }
}
