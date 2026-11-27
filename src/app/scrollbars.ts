import { stagePoint, stageRotated } from '../player/stage-geometry';
import { topNativeDialog } from '../player/native-dialogs';
import './scrollbars.css';

// Reader, LOG and native prompts already have their own authored scrollbars.
const regions = [
  '#intro',
  '#catalog-nav',
  '#catalog-content',
  '.chapter-poster',
  '.chapter-tracks',
  '.shelf-items',
  '.desktop-page',
  '#player-panel',
  '.desktop-rail nav',
  '#home-music-tracks',
  '#home-music-status',
  '.operator-filter-content',
  '.ark-select-options',
  '.loading-card',
  '.loading-content',
  '.loading-card pre',
  '.import-progress pre',
  '.cache-story-list',
  '#cache-task-items',
  '#cache-error',
  '#cache-task-transfers',
  '#cache-queue-panel',
  '.script-list',
].join(',');

class ScrollAxis {
  readonly track = document.createElement('div');
  private thumb = document.createElement('span');
  private extent = 0;
  private viewport = 0;
  private length = 0;
  private handle = 0;
  private press?: { id: number; point: number; scroll: number; thumb: boolean };
  private repeat?: ReturnType<typeof setInterval>;
  constructor(
    private element: HTMLElement,
    private axis: 'x' | 'y',
  ) {
    this.track.className = 'app-scrollbar app-scrollbar-' + axis;
    this.track.setAttribute('role', 'scrollbar');
    this.track.setAttribute('aria-label', axis === 'y' ? '垂直滚动' : '水平滚动');
    this.track.setAttribute('aria-orientation', axis === 'y' ? 'vertical' : 'horizontal');
    this.track.setAttribute('aria-controls', element.id);
    this.track.tabIndex = 0;
    this.thumb.className = 'app-scrollbar-thumb';
    this.track.append(this.thumb);
    this.track.onpointerdown = (event) => {
      if (event.button !== 0 || !event.isPrimary) return;
      event.preventDefault();
      event.stopPropagation();
      element.dispatchEvent(new Event('arkreader-scroll-input'));
      this.track.focus({ preventScroll: true });
      this.press = {
        id: event.pointerId,
        point: this.point(event),
        scroll: this.value,
        thumb: event.target === this.thumb,
      };
      this.track.setPointerCapture(event.pointerId);
      this.track.classList.add('dragging');
      if (!this.press.thumb) {
        this.page();
        this.repeat = setInterval(() => this.page(), 150);
      }
    };
    this.track.onpointermove = (event) => {
      const press = this.press;
      if (!press || event.pointerId !== press.id) return;
      if (!event.buttons) this.cancel();
      else if (press.thumb)
        this.set(
          press.scroll +
            ((this.point(event) - press.point) * this.extent) /
              Math.max(1, this.length - this.handle),
        );
    };
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture'])
      this.track.addEventListener(name, (event) => {
        if ((event as PointerEvent).pointerId === this.press?.id) this.cancel();
      });
    this.track.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
    };
    this.track.onkeydown = (event) => {
      const step = this.viewport * 0.9;
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? this.extent
            : event.key === 'PageUp'
              ? this.value - step
              : event.key === 'PageDown'
                ? this.value + step
                : event.key === (axis === 'y' ? 'ArrowUp' : 'ArrowLeft')
                  ? this.value - 40
                  : event.key === (axis === 'y' ? 'ArrowDown' : 'ArrowRight')
                    ? this.value + 40
                    : undefined;
      if (next !== undefined) {
        event.preventDefault();
        event.stopPropagation();
        element.dispatchEvent(new Event('arkreader-scroll-input'));
        this.set(next);
      }
    };
    this.track.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        event.stopPropagation();
        element.dispatchEvent(new Event('arkreader-scroll-input'));
        const delta = axis === 'x' ? event.deltaX || event.deltaY : event.deltaY;
        this.set(
          this.value +
            delta * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.viewport : 1),
        );
      },
      { passive: false },
    );
  }
  private get value() {
    return this.axis === 'y' ? this.element.scrollTop : this.element.scrollLeft;
  }
  private point(event: PointerEvent) {
    return stagePoint(this.track, event)[this.axis];
  }
  private set(value: number) {
    const next = Math.max(0, Math.min(this.extent, value));
    if (this.axis === 'y') this.element.scrollTop = next;
    else this.element.scrollLeft = next;
    this.paint();
  }
  private page() {
    if (!this.press) return;
    const start = this.extent ? (this.value / this.extent) * (this.length - this.handle) : 0;
    if (this.press.point < start) this.set(this.value - this.viewport * 0.9);
    else if (this.press.point > start + this.handle) this.set(this.value + this.viewport * 0.9);
  }
  cancel() {
    clearInterval(this.repeat);
    this.repeat = undefined;
    const press = this.press;
    this.press = undefined;
    this.track.classList.remove('dragging');
    if (press && this.track.hasPointerCapture(press.id)) this.track.releasePointerCapture(press.id);
  }
  update(viewport: number, total: number, length: number, visible: boolean) {
    this.viewport = viewport;
    this.extent = Math.max(0, total - viewport);
    this.length = length;
    this.handle = Math.min(length, Math.max(24, (length * viewport) / Math.max(1, total)));
    this.track.hidden = !visible;
    if (!visible) this.cancel();
    this.paint();
  }
  private paint() {
    const offset = this.extent
      ? Math.max(0, Math.min(1, this.value / this.extent)) * (this.length - this.handle)
      : 0;
    this.thumb.style[this.axis === 'y' ? 'height' : 'width'] = this.handle + 'px';
    this.thumb.style.transform = `translate${this.axis.toUpperCase()}(${offset}px)`;
    this.track.setAttribute('aria-valuemin', '0');
    this.track.setAttribute('aria-valuemax', String(Math.round(this.extent)));
    this.track.setAttribute('aria-valuenow', String(Math.round(this.value)));
  }
}

interface Region {
  group: HTMLElement;
  x: ScrollAxis;
  y: ScrollAxis;
}

/** DOM handles over native scrolling content; no wrappers, synthetic scrolling
 * model or changes to wheel/touch handling in the content panes. */
export function mountScrollbars(): void {
  const overlay = document.createElement('div');
  if (typeof overlay.showPopover !== 'function') return;
  overlay.id = 'app-scrollbars';
  overlay.setAttribute('popover', 'manual');
  document.body.append(overlay);
  const known = new Map<HTMLElement, Region>();
  let frame = 0,
    serial = 0,
    host: Element = document.body;
  const own = (node: Node) =>
    node instanceof Element && !!node.closest('#app-scrollbars,#prts-cursor');
  const request = () => {
    if (!frame) frame = requestAnimationFrame(update);
  };
  const size = new ResizeObserver(request);
  function scan() {
    for (const [element, region] of known)
      if (!element.isConnected) {
        region.x.cancel();
        region.y.cancel();
        region.group.remove();
        known.delete(element);
      }
    for (const element of document.querySelectorAll<HTMLElement>(regions)) {
      if (known.has(element)) continue;
      element.id ||= 'app-scroll-region-' + ++serial;
      const group = document.createElement('div');
      group.className = 'app-scrollbar-pair';
      group.dataset.scrollFor = element.id;
      const x = new ScrollAxis(element, 'x'),
        y = new ScrollAxis(element, 'y');
      group.append(x.track, y.track);
      overlay.append(group);
      known.set(element, { group, x, y });
      element.classList.add('app-scroll-region');
    }
    size.disconnect();
    for (const element of known.keys()) {
      size.observe(element);
      if (element.firstElementChild) size.observe(element.firstElementChild);
      if (element.lastElementChild) size.observe(element.lastElementChild);
    }
  }
  function foreground(): Element {
    const modal = topNativeDialog();
    const popover = [...document.querySelectorAll<HTMLElement>('[popover]:popover-open')]
      .filter((element) => element !== overlay && element.id !== 'prts-cursor')
      .at(-1);
    if (popover && (!modal || modal.contains(popover))) return popover;
    return modal ?? document.fullscreenElement ?? document.body;
  }
  function update() {
    frame = 0;
    const next = foreground();
    if (next !== host) {
      if (overlay.matches(':popover-open')) overlay.hidePopover();
      host = next;
      host.append(overlay);
    }
    let visible = false;
    for (const [element, region] of known) {
      const style = getComputedStyle(element),
        rect = element.getBoundingClientRect();
      const y =
        /auto|scroll/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 1;
      const x =
        /auto|scroll/.test(style.overflowX) && element.scrollWidth > element.clientWidth + 1;
      const shown =
        (x || y) &&
        host.contains(element) &&
        !!element.getClientRects().length &&
        style.visibility !== 'hidden' &&
        rect.width > 0 &&
        rect.height > 0;
      region.group.hidden = !shown;
      if (!shown) {
        region.x.cancel();
        region.y.cancel();
        continue;
      }
      const rotated = stageRotated(element);
      const scale = (rotated ? rect.height : rect.width) / element.offsetWidth;
      const width = element.clientWidth * scale,
        height = element.clientHeight * scale;
      const left = rotated
        ? rect.right - element.clientTop * scale
        : rect.left + element.clientLeft * scale;
      const top = rect.top + (rotated ? element.clientLeft : element.clientTop) * scale;
      // Clip to ancestor viewports, so nested panes cannot paint over fixed headers.
      let l = 0,
        t = 0,
        r = innerWidth,
        b = innerHeight;
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        const css = getComputedStyle(parent);
        const box = parent.getBoundingClientRect();
        if (stageRotated(parent)) {
          if (css.overflowY !== 'visible') {
            l = Math.max(l, box.left);
            r = Math.min(r, box.right);
          }
          if (css.overflowX !== 'visible') {
            t = Math.max(t, box.top);
            b = Math.min(b, box.bottom);
          }
        } else {
          if (css.overflowX !== 'visible') {
            l = Math.max(l, box.left);
            r = Math.min(r, box.right);
          }
          if (css.overflowY !== 'visible') {
            t = Math.max(t, box.top);
            b = Math.min(b, box.bottom);
          }
        }
        if (css.position === 'fixed' || parent.matches(':fullscreen')) break;
      }
      const inset = rotated
        ? [
            Math.max(0, left - r),
            Math.max(0, top + width - b),
            Math.max(0, l - (left - height)),
            Math.max(0, t - top),
          ]
        : [
            Math.max(0, t - top),
            Math.max(0, left + width - r),
            Math.max(0, top + height - b),
            Math.max(0, l - left),
          ];
      region.group.dataset.stageRotated = String(rotated);
      Object.assign(region.group.style, {
        left: left + 'px',
        top: top + 'px',
        width: width + 'px',
        height: height + 'px',
        transform: rotated ? 'rotate(90deg)' : 'none',
        clipPath: `inset(${inset.map((n) => n + 'px').join(' ')})`,
      });
      region.y.track.style.bottom = x ? '12px' : '0';
      region.x.track.style.right = y ? '12px' : '0';
      region.y.update(
        element.clientHeight,
        element.scrollHeight,
        Math.max(0, height - (x ? 12 : 0)),
        y,
      );
      region.x.update(
        element.clientWidth,
        element.scrollWidth,
        Math.max(0, width - (y ? 12 : 0)),
        x,
      );
      visible = true;
    }
    if (visible && !overlay.matches(':popover-open')) overlay.showPopover();
    else if (!visible && overlay.matches(':popover-open')) overlay.hidePopover();
  }
  const observer = new MutationObserver((records) => {
    const external = records.filter((record) => !own(record.target));
    const childrenChanged = external.some(
      (record) =>
        record.type === 'childList' &&
        [...record.addedNodes, ...record.removedNodes].some(
          (node) => node instanceof Element && !own(node),
        ),
    );
    if (childrenChanged) scan();
    if (
      childrenChanged ||
      external.some(
        (record) =>
          record.target instanceof HTMLElement &&
          (record.target === document.body ||
            record.target.matches(
              regions + ',dialog,.library-panel,.story-cache-panel,#playback-surface',
            )),
      )
    )
      request();
  });
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['class', 'hidden', 'open', 'style'],
  });
  const cancel = () => {
    known.forEach((r) => {
      r.x.cancel();
      r.y.cancel();
    });
    request();
  };
  document.addEventListener('scroll', request, { capture: true, passive: true });
  document.addEventListener(
    'toggle',
    (event) => {
      if (!own(event.target as Node)) {
        cancel();
      }
    },
    true,
  );
  document.addEventListener('fullscreenchange', cancel);
  window.addEventListener('resize', cancel);
  window.addEventListener('playback-screen-mode', cancel);
  window.addEventListener('blur', cancel);
  window.visualViewport?.addEventListener('resize', cancel);
  window.addEventListener(
    'pagehide',
    () => {
      observer.disconnect();
      size.disconnect();
      cancelAnimationFrame(frame);
      known.forEach((r) => {
        r.x.cancel();
        r.y.cancel();
      });
    },
    { once: true },
  );
  scan();
  request();
}
