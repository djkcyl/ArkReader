import { loadWidgetProfile, type Graphic, type WidgetProfile } from '../player/native-widgets';
import { playerMediaUrl } from '../player/package-source';
import './native-controls.css';
import './native-application.css';

interface Control {
  input: HTMLInputElement | HTMLSelectElement;
  sync(): void;
  dispose(): void;
}
const controls = new WeakMap<Element, Control>();
export function syncApplicationControl(input: Element): void {
  controls.get(input)?.sync();
}
function span(cls: string): HTMLSpanElement {
  const node = document.createElement('span');
  node.className = cls;
  node.setAttribute('aria-hidden', 'true');
  return node;
}
function paint(g: Graphic): HTMLElement {
  const node = span('ark-widget-art');
  if (g.sprite) node.style.backgroundImage = `url("${playerMediaUrl(g.sprite)}")`;
  else
    node.style.backgroundColor = `rgba(${g.color.slice(0, 3).map((n) => n * 255)},${g.color[3]})`;
  node.style.opacity = String(g.color[3]);
  return node;
}
function rect(node: HTMLElement, values: number[], unit = 'px'): void {
  [node.style.left, node.style.top, node.style.width, node.style.height] = values.map(
    (n) => `${n}${unit}`,
  );
}

/** Keep the visible button face aligned with its hit area. The authored sprites
 * include different transparent gutters and shadows for each selected state. */
function buttonFace(role: string, image: HTMLImageElement): void {
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('无法读取原版控件尺寸');
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let peak = 0;
  for (let i = 3; i < pixels.length; i += 4) peak = Math.max(peak, pixels[i]);
  let left = canvas.width,
    top = canvas.height,
    right = -1,
    bottom = -1;
  for (let y = 0; y < canvas.height; y++)
    for (let x = 0; x < canvas.width; x++) {
      if (!peak || pixels[(y * canvas.width + x) * 4 + 3] < peak * 0.98) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  if (right < left || bottom < top) throw new Error('原版控件贴图为空');
  const width = right - left + 1,
    height = bottom - top + 1;
  for (const [name, value] of Object.entries({
    left: (-left / width) * 100,
    top: (-top / height) * 100,
    width: (canvas.width / width) * 100,
    height: (canvas.height / height) * 100,
  }))
    document.documentElement.style.setProperty(`--ark-${role}-${name}`, `${value}%`);
}

class AppRange implements Control {
  readonly root = span('ark-range');
  private track: HTMLElement;
  private handle: HTMLElement;
  private value = span('ark-range-value');
  private size = new ResizeObserver(() => this.sync());
  private pointer: number | null = null;
  private offset = 0;
  private began = '';
  private scale = 0.72;
  constructor(
    readonly input: HTMLInputElement,
    private profile: WidgetProfile['volume'],
  ) {
    this.root.removeAttribute('aria-hidden');
    input.before(this.root);
    this.track = paint(profile.track);
    this.handle = paint(profile.handle);
    this.root.append(this.track, this.handle, this.value, input);
    input.classList.add('ark-range-input');
    this.root.classList.toggle('ark-range-compact', input.id === 'playback-seek');
    if (input.id === 'playback-seek') this.scale = 0.38;
    input.addEventListener('input', this.sync);
    input.addEventListener('change', this.sync);
    this.root.addEventListener('pointerdown', (event) => {
      if (input.disabled || event.button !== 0 || !event.isPrimary || this.pointer !== null) return;
      const box = this.root.getBoundingClientRect();
      const center = this.center();
      const local = event.clientX - box.left;
      this.offset = Math.abs(local - center) < 30 * this.scale ? local - center : 0;
      this.began = input.value;
      this.pointer = event.pointerId;
      event.preventDefault();
      event.stopPropagation();
      input.focus({ preventScroll: true });
      this.root.setPointerCapture(event.pointerId);
      this.setAt(local - this.offset);
    });
    this.root.addEventListener('pointermove', (event) => {
      if (event.pointerId !== this.pointer) return;
      if (!event.buttons) this.release();
      else this.setAt(event.clientX - this.root.getBoundingClientRect().left - this.offset);
    });
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      this.root.addEventListener(name, (event) => {
        if ((event as PointerEvent).pointerId === this.pointer) this.release();
      });
    }
    // Labels otherwise forward a second click after a captured range gesture.
    this.root.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    window.addEventListener('blur', this.release);
    this.size.observe(this.root);
    this.sync();
  }
  private fraction(): number {
    const min = Number(this.input.min || 0),
      max = Number(this.input.max || 100);
    return max > min ? Math.max(0, Math.min(1, (Number(this.input.value) - min) / (max - min))) : 0;
  }
  private travel(): number {
    return Math.max(
      1,
      this.root.clientWidth - (this.baseWidth() - this.profile.area[2]) * this.scale,
    );
  }
  private shiftX(): number {
    return -Math.min(0, this.profile.hotspot[0], this.profile.handle.rect[0]);
  }
  private shiftY(): number {
    return -Math.min(
      0,
      this.profile.hotspot[1],
      this.profile.handle.rect[1],
      this.profile.label.rect[1],
      this.profile.track.rect[1],
    );
  }
  private baseWidth(): number {
    const p = this.profile;
    return (
      this.shiftX() +
      p.area[2] +
      Math.max(
        p.size[0] - p.area[2],
        p.handle.rect[0] + p.handle.rect[2],
        p.hotspot[0] + p.hotspot[2],
      )
    );
  }
  private startCenter(): number {
    const r = this.profile.label.rect;
    return (this.shiftX() + r[0] + r[2] / 2) * this.scale;
  }
  private center(): number {
    return this.startCenter() + this.travel() * this.fraction();
  }
  private setAt(x: number): void {
    const min = Number(this.input.min || 0),
      max = Number(this.input.max || 100);
    this.input.value = String(
      min + Math.max(0, Math.min(1, (x - this.startCenter()) / this.travel())) * (max - min),
    );
    this.input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  private release = (): void => {
    const id = this.pointer;
    this.pointer = null;
    if (id !== null) {
      if (this.root.hasPointerCapture(id)) this.root.releasePointerCapture(id);
      if (this.input.value !== this.began)
        this.input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  };
  sync = (): void => {
    const p = this.profile,
      s = this.scale,
      shift = this.travel() * this.fraction();
    const moved = (r: number[]) => [
      (r[0] + this.shiftX()) * s,
      (r[1] + this.shiftY()) * s,
      r[2] * s,
      r[3] * s,
    ];
    rect(this.track, [
      (p.track.rect[0] + this.shiftX()) * s,
      (p.track.rect[1] + this.shiftY()) * s,
      Math.max(0, this.root.clientWidth - (this.baseWidth() - p.track.rect[2]) * s),
      p.track.rect[3] * s,
    ]);
    rect(this.handle, moved(p.handle.rect));
    rect(this.value, moved(p.label.rect));
    this.handle.style.translate = this.value.style.translate = `${shift}px 0`;
    this.value.style.fontSize = `${p.label.fontSize! * s}px`;
    this.value.textContent = String(Math.round(Number(this.input.value)));
    this.root.classList.toggle('ark-disabled', this.input.disabled);
  };
  dispose(): void {
    this.release();
    this.size.disconnect();
    window.removeEventListener('blur', this.release);
    this.input.removeEventListener('input', this.sync);
    this.input.removeEventListener('change', this.sync);
  }
}

class AppSwitch implements Control {
  readonly root = span('ark-switch');
  private bar: HTMLElement;
  private on: HTMLElement;
  private disabled: HTMLElement;
  constructor(
    readonly input: HTMLInputElement,
    private profile: WidgetProfile['settings']['toggle'],
  ) {
    this.root.removeAttribute('aria-hidden');
    input.before(this.root);
    const p = profile;
    const make = (g: Graphic, label?: string) => {
      const node = label ? span('ark-switch-label') : paint(g);
      rect(
        node,
        g.rect.map((n) => (n / p.size[0]) * 100),
        'cqw',
      );
      if (label) {
        node.textContent = label;
        node.style.fontSize = `${(g.fontSize! / p.size[0]) * 100}cqw`;
      }
      return node;
    };
    this.bar = make(p.bar);
    this.on = make(p.on_mask);
    this.disabled = make(p.unavailable_mask);
    const nodes: Record<string, HTMLElement> = {
      button_bar: this.bar,
      on_mask: this.on,
      unavailable_mask: this.disabled,
      open: make(p.open, '开'),
      close: make(p.close, '关'),
    };
    this.root.append(make(p.background), ...p.order.map((n) => nodes[n]), input);
    input.classList.add('ark-switch-input');
    input.setAttribute('role', 'switch');
    input.addEventListener('change', this.sync);
    this.sync();
  }
  sync = (): void => {
    const p = this.profile;
    const state =
      p.states[
        (this.input.disabled ? 'unavailable_' : '') +
          (this.input.checked ? p.checkedState : p.uncheckedState)
      ];
    this.bar.style.translate = `${(state.barOffset / p.size[0]) * 100}cqw 0`;
    this.on.hidden = !state.on_mask;
    this.disabled.hidden = !state.unavailable_mask;
    this.root.classList.toggle('ark-disabled', this.input.disabled);
  };
  dispose(): void {
    this.input.removeEventListener('change', this.sync);
  }
}

let selectId = 0;
class AppSelect implements Control {
  private root = document.createElement('span');
  private button = document.createElement('button');
  private list = document.createElement('div');
  private supportsPopover = typeof this.list.showPopover === 'function';
  private label = document.createElement('span');
  private options: HTMLButtonElement[] = [];
  private observer = new MutationObserver(() => {
    this.sync();
    if (this.open) this.populate();
  });
  private search = '';
  private searchedAt = 0;
  constructor(readonly input: HTMLSelectElement) {
    this.root.className = 'ark-select';
    input.before(this.root);
    input.classList.add('ark-select-source');
    input.tabIndex = -1;
    input.setAttribute('aria-hidden', 'true');
    this.button.type = 'button';
    this.button.className = 'ark-select-button';
    this.button.setAttribute('role', 'combobox');
    this.button.setAttribute('aria-haspopup', 'listbox');
    const label =
      input.getAttribute('aria-label') ||
      input.labels?.[0]?.firstChild?.textContent?.trim() ||
      '选择';
    this.button.setAttribute('aria-label', label);
    this.list.id = `ark-select-${++selectId}`;
    this.list.className = 'ark-select-options';
    if (this.supportsPopover) this.list.setAttribute('popover', 'auto');
    else this.list.hidden = true;
    this.list.setAttribute('role', 'listbox');
    this.list.setAttribute('aria-label', label);
    this.button.setAttribute('aria-controls', this.list.id);
    this.button.append(this.label, span('ark-select-arrow'));
    this.root.append(input, this.button);
    (this.supportsPopover ? this.root : document.body).append(this.list);
    this.button.onclick = (event) => {
      event.preventDefault();
      this.open ? this.close() : this.show();
    };
    this.button.onkeydown = (event) => {
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        this.show();
        this.move(
          event.key === 'End'
            ? this.options.length - 1
            : event.key === 'Home'
              ? 0
              : this.options.findIndex((b) => b.getAttribute('aria-selected') === 'true'),
        );
      } else this.typeAhead(event);
    };
    this.list.onkeydown = (event) => {
      const at = this.options.indexOf(document.activeElement as HTMLButtonElement);
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? this.options.length - 1
            : event.key === 'ArrowDown'
              ? at + 1
              : event.key === 'ArrowUp'
                ? at - 1
                : null;
      if (next !== null) {
        event.preventDefault();
        this.move(next);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        this.close(true);
      } else if (event.key === 'Tab') this.close(true);
      else this.typeAhead(event);
    };
    this.list.addEventListener('toggle', () =>
      this.button.setAttribute('aria-expanded', String(this.open)),
    );
    input.addEventListener('change', this.sync);
    this.observer.observe(input, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['disabled', 'selected', 'label', 'value'],
    });
    window.addEventListener('resize', this.closeOnLayout);
    document.addEventListener('scroll', this.closeOnScroll, true);
    document.addEventListener('pointerdown', this.closeOutside, true);
    this.sync();
  }
  private get open(): boolean {
    return this.supportsPopover ? this.list.matches(':popover-open') : !this.list.hidden;
  }
  private closeOutside = (event: PointerEvent): void => {
    if (
      !this.supportsPopover &&
      !this.list.contains(event.target as Node) &&
      !this.button.contains(event.target as Node)
    )
      this.close();
  };
  private closeOnLayout = () => this.close();
  private closeOnScroll = (e: Event) => {
    if (!this.list.contains(e.target as Node)) this.close();
  };
  private close(focus = false): void {
    if (this.open) {
      if (this.supportsPopover) this.list.hidePopover();
      else this.list.hidden = true;
    }
    this.button.setAttribute('aria-expanded', 'false');
    if (focus) this.button.focus();
  }
  private populate(): void {
    this.options = [...this.input.options]
      .filter((o) => !o.hidden)
      .map((option) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.setAttribute('role', 'option');
        button.textContent = option.label;
        button.disabled =
          option.disabled ||
          (option.parentElement instanceof HTMLOptGroupElement && option.parentElement.disabled);
        button.setAttribute('aria-selected', String(option.selected));
        button.tabIndex = -1;
        button.onclick = () => {
          this.input.value = option.value;
          this.input.dispatchEvent(new Event('change', { bubbles: true }));
          this.close(true);
        };
        return button;
      });
    this.list.replaceChildren(...this.options);
  }
  private show(): void {
    if (this.input.disabled || this.open) return;
    this.populate();
    const box = this.button.getBoundingClientRect();
    const below = innerHeight - box.bottom - 12,
      above = box.top - 12,
      height = Math.min(280, Math.max(below, above));
    this.list.style.width = `${Math.min(Math.max(box.width, 180), innerWidth - 24)}px`;
    this.list.style.maxHeight = `${height}px`;
    this.list.style.left = `${Math.max(12, Math.min(box.left, innerWidth - Math.max(box.width, 180) - 12))}px`;
    this.list.style.top =
      below >= Math.min(280, this.options.length * 40 + 8) || below >= above
        ? `${box.bottom + 4}px`
        : 'auto';
    this.list.style.bottom =
      this.list.style.top === 'auto' ? `${innerHeight - box.top + 4}px` : 'auto';
    if (this.supportsPopover) this.list.showPopover();
    else this.list.hidden = false;
    this.button.setAttribute('aria-expanded', 'true');
    this.move(
      Math.max(
        0,
        this.options.findIndex((b) => b.getAttribute('aria-selected') === 'true'),
      ),
    );
  }
  private move(index: number): void {
    const enabled = this.options.filter((b) => !b.disabled);
    const candidate = this.options[Math.max(0, Math.min(index, this.options.length - 1))];
    (candidate && !candidate.disabled ? candidate : enabled[0])?.focus({ preventScroll: true });
    (document.activeElement as HTMLElement)?.scrollIntoView({ block: 'nearest' });
  }
  private typeAhead(event: KeyboardEvent): void {
    if (
      event.key.length !== 1 ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.key === ' '
    )
      return;
    const now = performance.now();
    this.search = (now - this.searchedAt > 700 ? '' : this.search) + event.key.toLocaleLowerCase();
    this.searchedAt = now;
    const found = [...this.input.options].find(
      (o) => !o.disabled && o.label.toLocaleLowerCase().startsWith(this.search),
    );
    if (!found) return;
    event.preventDefault();
    if (this.open) this.move(this.options.findIndex((b) => b.textContent === found.label));
    else {
      this.input.value = found.value;
      this.input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }
  sync = (): void => {
    this.label.textContent = this.input.selectedOptions[0]?.label ?? '';
    this.button.disabled = this.input.disabled;
    this.button.setAttribute('aria-expanded', String(this.open));
    if (this.input.disabled) this.close();
  };
  dispose(): void {
    this.close();
    this.observer.disconnect();
    this.input.removeEventListener('change', this.sync);
    window.removeEventListener('resize', this.closeOnLayout);
    document.removeEventListener('scroll', this.closeOnScroll, true);
    document.removeEventListener('pointerdown', this.closeOutside, true);
    if (!this.supportsPopover) this.list.remove();
  }
}

export async function mountApplicationControls(): Promise<void> {
  const [profile, response] = await Promise.all([
    loadWidgetProfile(new AbortController().signal),
    fetch(playerMediaUrl('native-app-widgets.json')),
  ]);
  if (!response.ok) throw new Error('应用界面资源未能加载');
  const application = (await response.json()) as Record<
    string,
    { sprite: string; border: number[]; width: number; height: number }
  >;
  const images = Object.entries(application).map(async ([role, g]) => {
    const img = new Image();
    img.src = playerMediaUrl(g.sprite);
    await img.decode();
    document.documentElement.style.setProperty(`--ark-${role}`, `url("${img.src}")`);
    if (role === 'back') buttonFace(role, img);
    if (g.border.some((n) => n > 0))
      document.documentElement.style.setProperty(
        `--ark-${role}-slice`,
        [g.border[3], g.border[2], g.border[1], g.border[0]].join(' '),
      );
  });
  const buttonImages = Object.entries({
    action: profile.settings.action.background.sprite!,
    'tab-off': profile.settings.tabs.game.off.background.sprite!,
    'tab-on': profile.settings.tabs.game.on.background.sprite!,
    primary: profile.dialogs.judge.controls.confirm.background.sprite!,
  }).map(async ([role, file]) => {
    const image = new Image();
    image.src = playerMediaUrl(file);
    await image.decode();
    buttonFace(role, image);
    document.documentElement.style.setProperty(`--ark-${role}-image`, `url("${image.src}")`);
  });
  const font = new FontFace('ArkNative', `url("${playerMediaUrl('native-dialog.ttf')}")`);
  await Promise.all([
    ...images,
    ...buttonImages,
    font.load().then((loaded) => document.fonts.add(loaded)),
  ]);
  const known = new Set<Control>();
  const scan = () => {
    for (const control of known)
      if (!control.input.isConnected) {
        control.dispose();
        known.delete(control);
      }
    for (const input of document.querySelectorAll<HTMLInputElement>(
      '#desktop-audio input[type=range],#home-music-volume,#playback-seek,#home-music-enabled',
    )) {
      if (controls.has(input)) continue;
      const control: Control =
        input.type === 'range'
          ? new AppRange(input, profile.volume)
          : new AppSwitch(input, profile.settings.toggle);
      controls.set(input, control);
      known.add(control);
    }
    for (const input of document.querySelectorAll<HTMLSelectElement>(
      '#intro select,.desktop-page select',
    )) {
      if (controls.has(input)) continue;
      const control = new AppSelect(input);
      controls.set(input, control);
      known.add(control);
    }
    for (const button of document.querySelectorAll<HTMLButtonElement>(
      '#intro button,.desktop-page button,#operator-filter-dialog button,#app-loading button,#home-music-panel button,.playback-heading button,#version-notice button',
    )) {
      if (
        button.closest('.ark-select') ||
        button.matches(
          '.archive-card,.story-track,#catalog-nav button,.shelf-story,.shelf-restart,.filter-unlimited,[data-unlimited],#operator-filter-reset',
        )
      )
        continue;
      button.classList.add('ark-action');
      if (button.matches('.library-tabs>button,.cache-tabs>button'))
        button.classList.add('ark-tab');
      if (button.matches('#start,#cache-start,[data-action=apply],#load-retry'))
        button.classList.add('ark-primary');
      if (button.matches('#catalog-back,#leave-story')) button.classList.add('ark-back');
      if (button.matches('#home-music-close,#operator-filter-dialog>header>button'))
        button.classList.add('ark-close');
    }
  };
  scan();
  document.body.classList.add('app-native-ui');
  let queued = false;
  const observer = new MutationObserver((records) => {
    if (
      records.some(
        (r) =>
          r.type === 'childList' &&
          [...r.addedNodes, ...r.removedNodes].some((n) => n instanceof Element),
      )
    ) {
      if (!queued) {
        queued = true;
        queueMicrotask(() => {
          queued = false;
          scan();
        });
      }
    }
    for (const record of records)
      if (record.type === 'attributes') controls.get(record.target as Element)?.sync();
  });
  observer.observe(document.getElementById('app')!, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['disabled'],
  });
  window.addEventListener(
    'pagehide',
    () => {
      observer.disconnect();
      known.forEach((c) => c.dispose());
    },
    { once: true },
  );
}
