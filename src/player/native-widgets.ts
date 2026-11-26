import { playerMediaUrl } from './resource-urls';
import { NativeSelectableSurface } from './native-selectable';
import { NativeScrollbar } from './native-scrollbar';
import { ReaderScroll } from '../core/reader-scroll';
import './native-widgets.css';

export type Rect = [number, number, number, number];
export interface Graphic {
  path: string;
  rect: Rect;
  color: number[];
  sprite?: string;
  sliced?: boolean;
  border?: number[];
  fontSize?: number;
  align?: number;
}
interface Control {
  rect: Rect;
  background: Graphic;
  icon: Graphic;
  text: Graphic;
}
interface PromptProfile {
  background: Graphic;
  content: Graphic;
  controls: { confirm: Control; cancel?: Control };
}
interface VolumeProfile {
  size: number[];
  track: Graphic;
  handle: Graphic;
  label: Graphic;
  area: Rect;
  hotspot: Rect;
  tintHandle: boolean;
}
export interface WidgetProfile {
  dialogs: { ok: PromptProfile; judge: PromptProfile };
  volume: VolumeProfile;
  settings: import('./native-settings-widgets').SettingsProfile;
}
const unit = (n: number) => `${n / 12.8}cqw`;
const color = (c: number[]) =>
  `rgba(${c
    .slice(0, 3)
    .map((n) => n * 255)
    .join(',')},${c[3]})`;
export function place(el: HTMLElement, r: Rect) {
  [el.style.left, el.style.top, el.style.width, el.style.height] = r.map(unit);
}
export function graphic(g: Graphic, rect = g.rect): HTMLElement {
  const el = document.createElement('span');
  el.className = 'native-widget-art';
  el.dataset.nativeSource = g.path;
  el.setAttribute('aria-hidden', 'true');
  place(el, rect);
  el.style.setProperty('--native-base-alpha', String(g.color[3]));
  if (g.sprite) {
    el.style.backgroundImage = `url("${playerMediaUrl(g.sprite)}")`;
    el.style.opacity = String(g.color[3]);
    if (g.color[0] === g.color[1] && g.color[1] === g.color[2] && g.color[0] !== 1)
      el.style.filter = `brightness(${g.color[0]})`;
  } else el.style.background = color(g.color);
  return el;
}

/** The original UIOKDialog/UIJudgeDialog graphics and button rectangles. Text
 * is supplied by this host; native layout groups center it in the content area. */
export class NativePrompt {
  private selectable: NativeSelectableSurface;
  constructor(
    root: HTMLElement,
    profile: PromptProfile,
    content: HTMLElement,
    confirm: HTMLButtonElement,
    cancel?: HTMLButtonElement,
  ) {
    root.classList.add('native-prompt');
    root.setAttribute('role', 'dialog');
    const background = graphic(profile.background);
    root.replaceChildren(background, content);
    content.classList.add('native-prompt-content');
    const [x, y, w, h] = profile.background.rect,
      contentWidth = profile.content.rect[2];
    place(content, [x + (w - contentWidth) / 2, y, contentWidth, h]);
    content.style.fontSize = unit(profile.content.fontSize!);
    content.style.color = color(profile.content.color);
    content.id ||= root.id + '-content';
    const inner = document.createElement('div');
    inner.className = 'native-prompt-text';
    inner.append(...content.childNodes);
    content.append(inner);
    const scroll = new ReaderScroll();
    const bar = new NativeScrollbar(
      scroll,
      () => {
        content.scrollTop = scroll.bounded;
        bar.update();
      },
      'prompt',
      content.id,
      '提示内容滚动位置',
    );
    root.append(bar.track);
    place(bar.track, [x + w - 25, y + 24, 9, h - 48]);
    new NativeSelectableSurface(
      root,
      '.prompt-track',
      () => !root.hidden,
      () => [{ element: bar.thumb }],
    );
    const updateScroll = () => {
      scroll.viewport = content.clientHeight;
      scroll.extent = Math.max(0, content.scrollHeight - content.clientHeight);
      scroll.reset(content.scrollTop);
      bar.update(!root.hidden);
    };
    new ResizeObserver(updateScroll).observe(content);
    new ResizeObserver(updateScroll).observe(inner);
    content.addEventListener('scroll', updateScroll, { passive: true });
    const add = (button: HTMLButtonElement, control: Control) => {
      const label = button.textContent ?? '';
      button.className = 'native-prompt-button';
      place(button, control.rect);
      const relative = (r: Rect): Rect => [
        r[0] - control.rect[0],
        r[1] - control.rect[1],
        r[2],
        r[3],
      ];
      const art = graphic(control.background, relative(control.background.rect));
      art.classList.add('native-prompt-button-art');
      const text = document.createElement('span');
      text.className = 'native-prompt-button-label';
      text.textContent = label;
      place(text, relative(control.text.rect));
      text.style.fontSize = unit(control.text.fontSize!);
      text.style.color = color(control.text.color);
      button.replaceChildren(art, text);
      root.append(button);
    };
    if (cancel && profile.controls.cancel) add(cancel, profile.controls.cancel);
    add(confirm, profile.controls.confirm);
    this.selectable = new NativeSelectableSurface(
      root,
      '.native-prompt-button',
      () => !root.hidden,
      (el) => [{ element: el.querySelector<HTMLElement>('.native-prompt-button-art')! }],
    );
    new MutationObserver(() => {
      this.selectable.update();
      updateScroll();
    }).observe(root, { attributes: true, attributeFilter: ['hidden', 'open'] });
  }
}

/** HTML range provides keyboard/accessibility, the actual audio-setting
 * prefab provides the track, thumb, value and pointer hit geometry. */
export class NativeVolumeSlider {
  private root = document.createElement('span');
  private handle: HTMLElement;
  private output: HTMLElement;
  private pointer: number | null = null;
  private offset = 0;
  private width: number;
  private shiftX: number;
  private vu: (n: number) => string;
  constructor(
    private input: HTMLInputElement,
    private profile: VolumeProfile,
  ) {
    input.parentElement!.append(this.root);
    this.root.className = 'native-volume';
    this.root.dataset.nativeSource = profile.handle.path.split('/handle_slide_area')[0];
    this.shiftX = -Math.min(0, profile.hotspot[0], profile.handle.rect[0]);
    this.width =
      this.shiftX +
      profile.area[2] +
      Math.max(
        profile.size[0] - profile.area[2],
        profile.handle.rect[0] + profile.handle.rect[2],
        profile.hotspot[0] + profile.hotspot[2],
      );
    this.vu = (n) => `${(n / this.width) * 100}cqw`;
    const shift = -Math.min(
      0,
      profile.handle.rect[1],
      profile.hotspot[1],
      profile.label.rect[1],
      profile.track.rect[1],
    );
    // The original row reserves its interactive area; the thumb's decorative
    // shadow is allowed to extend below it, as in the client settings layout.
    const height = profile.size[1] + 2 * shift;
    this.root.style.aspectRatio = String(this.width / height);
    const moved = (r: Rect): Rect => [r[0] + this.shiftX, r[1] + shift, r[2], r[3]];
    const placeVolume = (el: HTMLElement, r: Rect) => {
      [el.style.left, el.style.top, el.style.width, el.style.height] = r.map(this.vu);
    };
    const volumeGraphic = (g: Graphic) => {
      const el = graphic(g);
      placeVolume(el, moved(g.rect));
      return el;
    };
    this.root.append(volumeGraphic(profile.track));
    this.handle = volumeGraphic(profile.handle);
    this.root.append(this.handle);
    this.output = document.getElementById('volume-value')!;
    this.output.className = 'native-volume-value';
    this.output.setAttribute('aria-hidden', 'true');
    placeVolume(this.output, moved(profile.label.rect));
    this.output.style.fontSize = this.vu(profile.label.fontSize!);
    this.output.style.color = color(profile.label.color);
    this.root.append(this.output, input);
    input.classList.add('native-volume-input');
    this.root.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || !event.isPrimary || input.disabled || this.pointer !== null) return;
      const point = this.local(event),
        p = profile,
        position = this.fraction() * p.area[2];
      const [x, y, w, h] = p.hotspot,
        inside =
          point.x >= x + position &&
          point.x <= x + position + w &&
          point.y >= y + shift &&
          point.y <= y + shift + h;
      if (!inside && (point.y < shift - 12 || point.y > shift + p.size[1] + 12)) return;
      event.preventDefault();
      event.stopPropagation();
      input.focus({ preventScroll: true });
      this.pointer = event.pointerId;
      this.offset = inside ? point.x - (p.area[0] + position) : 0;
      this.root.setPointerCapture(event.pointerId);
      this.setAt(point.x);
    });
    this.root.addEventListener('pointermove', (event) => {
      if (event.pointerId === this.pointer) {
        if (event.buttons === 0) this.cancel();
        else this.setAt(this.local(event).x);
      }
    });
    const release = (event: PointerEvent) => {
      if (event.pointerId === this.pointer) this.cancel();
    };
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'])
      this.root.addEventListener(type, release as EventListener);
    this.root.addEventListener('click', (event) => event.stopPropagation());
    window.addEventListener('blur', () => this.cancel());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.cancel();
    });
    document.getElementById('reading-settings')!.addEventListener('close', () => this.cancel());
    input.addEventListener('input', () => this.sync());
    input.addEventListener('change', () => this.sync());
    this.root.addEventListener(
      'wheel',
      (event) => {
        if (document.activeElement !== input || input.disabled) return;
        event.preventDefault();
        input.value = String(Number(input.value) - Math.sign(event.deltaY));
        input.dispatchEvent(new Event('input', { bubbles: true }));
      },
      { passive: false },
    );
    this.sync();
  }
  private local(event: PointerEvent) {
    const box = this.root.getBoundingClientRect(),
      scale = box.width / this.width;
    return { x: (event.clientX - box.x) / scale - this.shiftX, y: (event.clientY - box.y) / scale };
  }
  private fraction() {
    return (
      (Number(this.input.value) - Number(this.input.min)) /
      (Number(this.input.max) - Number(this.input.min))
    );
  }
  private setAt(x: number) {
    const p = this.profile,
      value = Math.max(0, Math.min(1, (x - p.area[0] - this.offset) / p.area[2]));
    this.input.value = String(
      Number(this.input.min) + value * (Number(this.input.max) - Number(this.input.min)),
    );
    this.input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  private cancel() {
    const pointer = this.pointer;
    this.pointer = null;
    if (pointer !== null && this.root.hasPointerCapture(pointer))
      this.root.releasePointerCapture(pointer);
  }
  sync() {
    const x = this.fraction() * this.profile.area[2];
    this.handle.style.translate = `${this.vu(x)} 0`;
    this.output.style.translate = `${this.vu(x)} 0`;
    this.output.textContent = this.input.value;
    this.input.setAttribute('aria-valuetext', this.input.value + '%');
  }
}

export async function loadWidgetProfile(signal: AbortSignal): Promise<WidgetProfile> {
  const response = await fetch(playerMediaUrl('native-widgets.json'), { signal });
  if (!response.ok) throw Error('原版播放器控件加载失败');
  const profile = (await response.json()) as WidgetProfile;
  const sprites = new Set<string>();
  JSON.stringify(profile, (_key, value) => {
    if (value?.sprite) sprites.add(value.sprite);
    return value;
  });
  await Promise.all(
    [...sprites].map(async (file) => {
      const img = new Image();
      img.src = playerMediaUrl(file);
      await img.decode();
      signal.throwIfAborted();
    }),
  );
  return profile;
}
