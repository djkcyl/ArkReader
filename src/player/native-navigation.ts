import {
  NavigationRepeat,
  navigationTarget,
  type NavigationRect,
  type MoveDirection,
} from '../core/ui-navigation';
import { navigationProfile as P } from './navigation-profile';
import { digitalAxis, strongestAxis, NavigationGamepads } from '../core/navigation-input';
import { topNativeDialog } from './native-dialogs';
import { stageRect, stageSize } from './stage-geometry';
export type NavigationEntry = {
  element: HTMLElement;
  rect: NavigationRect;
};
const axisKeys: Record<string, readonly [number, number]> = {
  arrowleft: [-1, 0],
  a: [-1, 0],
  arrowright: [1, 0],
  d: [1, 0],
  arrowup: [0, 1],
  w: [0, 1],
  arrowdown: [0, -1],
  s: [0, -1],
};
function visible(element: HTMLElement): boolean {
  if (!element.isConnected || element.closest('[hidden],.clean') || element.matches(':disabled'))
    return false;
  const style = getComputedStyle(element);
  return (
    style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0
  );
}
/** Resolve serialized Selectable rectangles separately from larger hit areas.
 * Dynamic decision buttons/scrollbars already have their native layout bounds.
 */
export function storyNavigationEntries(stage: HTMLElement): NavigationEntry[] {
  const viewport = stage.querySelector<HTMLElement>('.viewport')!,
    b = stageSize(viewport),
    scale = b.width / 1280;
  const entries: NavigationEntry[] = [];
  const add = (element: HTMLElement | null, rect?: readonly number[]) => {
    if (!element || !visible(element)) return;
    const r = stageRect(element, viewport);
    entries.push({
      element,
      rect: rect
        ? [rect[0] * scale, rect[1] * scale, rect[2] * scale, rect[3] * scale]
        : [r.x, r.y, r.width, r.height],
    });
  };
  const modal = topNativeDialog();
  if (modal) {
    if (modal.id === 'reading-settings') {
      const profile = modal.classList.contains('reader-settings-native')
        ? P.readerSettings
        : P.normalSettings;
      add(modal, profile.backdrop);
      add(modal.querySelector<HTMLElement>('#close-settings'), profile.close);
      for (const input of modal.querySelectorAll<HTMLElement>('[data-native-navigation-rect]'))
        add(input, JSON.parse(input.dataset.nativeNavigationRect!));
    } else if (modal.id === 'skip-confirm') {
      add(modal, [-280, 0, 1840, 720]);
      for (const button of modal.querySelectorAll<HTMLElement>('button')) add(button);
    } else if (modal.id === 'history') {
      add(modal.querySelector('#close-log'), P.history.close);
      add(modal.querySelector('.history-track'));
      for (const row of modal.querySelectorAll<HTMLElement>('.review-jump')) add(row);
    }
    return entries;
  }
  const reader = stage.classList.contains('reader-active'),
    profile = reader ? P.reader : P.normal;
  for (const [id, rect] of Object.entries(profile))
    add(id === 'top' ? stage.querySelector('.reader-top') : stage.querySelector('#' + id), rect);
  for (const element of stage.querySelectorAll<HTMLElement>(
    '.choices button,.reader-live-decision button,.reader-track,.review-jump,[data-quick-speed]',
  ))
    add(element);
  // QuickPlayKnownNotify's Button RectTransform is zero-sized. Its child
  // graphic/hotzone is much larger and must not define its navigation edge.
  for (const element of stage.querySelectorAll<HTMLElement>('.quick-notice-known'))
    if (visible(element)) {
      const r = stageRect(element, viewport);
      entries.push({ element, rect: [r.x + r.width / 2, r.y + r.height / 2, 0, 0] });
    }
  return entries;
}
/** A single unscaled frame clock, independent of operating-system key repeat.
 * Browser Tab/Enter/Space remain accessibility controls, not native key claims.
 */
export class NativeNavigation {
  private keys = new Set<string>();
  private downKeys = new Set<string>();
  private repeat = new NavigationRepeat();
  private pads = new NavigationGamepads();
  private foreground = true;
  private previousFrame = 0;
  private frameDelta = 0;
  private registered: HTMLElement[] = [];
  constructor(
    private stage: HTMLElement,
    private enabled: () => boolean,
  ) {
    topNativeDialog();
    document.addEventListener(
      'keydown',
      (e) => {
        const key = e.key.toLowerCase();
        if (
          !axisKeys[key] ||
          e.defaultPrevented ||
          e.isComposing ||
          e.ctrlKey ||
          e.altKey ||
          e.metaKey
        )
          return;
        if (!this.current()) return;
        e.preventDefault();
        e.stopPropagation();
        if (e.repeat) return;
        this.keys.add(key);
        this.downKeys.add(key);
      },
      true,
    );
    document.addEventListener(
      'keyup',
      (e) => {
        if (!this.keys.delete(e.key.toLowerCase())) return;
        e.preventDefault();
      },
      true,
    );
    window.addEventListener('blur', () => {
      this.foreground = false;
      this.clear();
    });
    window.addEventListener('focus', () => {
      this.foreground = true;
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.clear();
    });
  }
  private current(): NavigationEntry | undefined {
    if (!this.enabled()) return;
    return storyNavigationEntries(this.stage).find((x) => x.element === document.activeElement);
  }
  private ordered(entries: NavigationEntry[]): NavigationEntry[] {
    const active = new Map(entries.map((e) => [e.element, e]));
    // Selectable.OnDisable fills its removed slot with the last active entry.
    for (let i = 0; i < this.registered.length;)
      if (!active.has(this.registered[i])) {
        this.registered[i] = this.registered.at(-1)!;
        this.registered.pop();
      } else i++;
    for (const e of entries)
      if (!this.registered.includes(e.element)) this.registered.push(e.element);
    return this.registered.map((el) => active.get(el)!);
  }
  /** Called once per unscaled UI frame. Edge sampling continues without a
   * selected control, so a held button cannot activate a newly opened dialog. */
  update(time: number): void {
    this.frameDelta = this.previousFrame ? (time - this.previousFrame) / 1000 : 0;
    this.previousFrame = time;
    let devices: readonly (Gamepad | null)[] = [];
    try {
      devices = navigator.getGamepads?.() ?? [];
    } catch {
      /* Browser policy may deny gamepad access. */
    }
    const pad = this.pads.sample(devices);
    const down = this.downKeys;
    this.downKeys = new Set();
    const current = this.current();
    if (!current || document.hidden || !this.foreground) {
      this.keys.clear();
      this.repeat.release();
      return;
    }
    const updated = new Event('native-navigation-update', { cancelable: true });
    current.element.dispatchEvent(updated);
    if (updated.defaultPrevented) return;
    const has = (a: string, b: string) =>
      this.keys.has(a) || this.keys.has(b) || down.has(a) || down.has(b);
    let x = strongestAxis([digitalAxis(has('arrowleft', 'a'), has('arrowright', 'd')), pad.x]);
    let y = strongestAxis([digitalAxis(has('arrowdown', 's'), has('arrowup', 'w')), pad.y]);
    if ([...down].some((key) => axisKeys[key][0])) x = Math.sign(x);
    if ([...down].some((key) => axisKeys[key][1])) y = Math.sign(y);
    const direction = this.repeat.poll(time / 1000, x, y);
    if (direction && this.move(current, direction)) return;
    // Selectable.OnMove changes selection without consuming BaseEventData.
    // Submit and Cancel use the current selection again, in that order.
    if (pad.submit) this.submit();
    if (pad.cancel) this.current()?.element.dispatchEvent(new Event('native-navigation-cancel'));
  }
  private move(current: NavigationEntry, direction: MoveDirection): boolean {
    const candidates = this.ordered(storyNavigationEntries(this.stage)).filter(
      (e) => e.element !== current.element,
    );
    // Scrollbar's automatic navigation suppresses neighbor search along its
    // own axis; OnMove changes the value even if another control is above it.
    const scroll =
      current.element.getAttribute('role') === 'scrollbar' &&
      (direction === 'up' || direction === 'down');
    const index = scroll
      ? -1
      : navigationTarget(
          current.rect,
          candidates.map((e) => e.rect),
          direction,
        );
    let used = false;
    if (index >= 0) candidates[index].element.focus({ preventScroll: true });
    else
      used = !current.element.dispatchEvent(
        new CustomEvent('native-navigation-move', { detail: direction, cancelable: true }),
      );
    this.stage.dispatchEvent(
      new CustomEvent('native-navigation', {
        detail: {
          rect: current.rect,
          candidates: candidates.map((e) => e.rect),
          direction,
          index,
          scroll,
        },
      }),
    );
    return used;
  }
  private submit(): void {
    const element = this.current()?.element;
    if (!element) return;
    const reader = this.stage.classList.contains('reader-active'),
      modal = element.closest('dialog');
    // UIButton.OnSubmit is the native empty function at 0x18051DF60.
    // Browser accessibility activation remains independent of native Submit.
    const custom =
      modal?.id === 'reading-settings'
        ? element.id !== 'close-settings' || modal.classList.contains('reader-settings-native')
        : element.matches('.reader-live-decision button,.reader-top,#reader-mode') ||
          (reader && element.matches('#hide,#settings'));
    const button =
      (element instanceof HTMLButtonElement && !custom) ||
      element.matches('.review-jump') ||
      (modal?.id === 'skip-confirm' && element === modal);
    this.stage.dispatchEvent(
      new CustomEvent('native-navigation-submit', {
        detail: { id: element.id, custom, button: !!button },
      }),
    );
    if (!button) return;
    element.dispatchEvent(new Event('native-ui-activate', { bubbles: true }));
    element.click();
    if (visible(element))
      element.dispatchEvent(
        new CustomEvent('native-submit-feedback', {
          bubbles: true,
          detail: { delta: this.frameDelta },
        }),
      );
  }
  clear(): void {
    this.keys.clear();
    this.downKeys.clear();
    this.repeat.release();
  }
}
