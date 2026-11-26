import { quickPanelProfile as profile } from './quick-panel-profile';
import { playerMediaUrl } from './resource-urls';

const unit = (n: number) => `${n / 12.8}cqw`;
function rect(element: HTMLElement, box: readonly number[]): void {
  const [x, y, w, h] = box;
  Object.assign(element.style, { left: unit(x), top: unit(y), width: unit(w), height: unit(h) });
}

/** Native AVGQuickPlay: filled hold indicator, expanded speed background and
 * independent unscaled size/fade sequence. Sprites preserve prefab draw order. */
export class QuickPanel {
  private readonly hold = document.createElement('div');
  private readonly speeds = document.createElement('div');
  private readonly entries: { node: HTMLElement; path: string }[] = [];
  private readonly buttons: HTMLButtonElement[] = [];
  private fill!: HTMLElement;
  private background!: HTMLElement;
  private wasActive = false;
  private started = 0;
  constructor(
    private readonly element: HTMLElement,
    onSpeed: (index: number) => void,
  ) {
    element.replaceChildren(this.hold, this.speeds);
    this.hold.id = 'quick-progress';
    this.hold.setAttribute('role', 'progressbar');
    this.hold.setAttribute('aria-label', '长按快进');
    this.hold.setAttribute('aria-valuemin', '0');
    this.hold.setAttribute('aria-valuemax', '1');
    this.speeds.id = 'quick-speeds';
    this.speeds.setAttribute('role', 'group');
    this.speeds.setAttribute('aria-label', '快进速度');
    for (const graphic of profile.graphics) {
      const node = document.createElement(graphic.type === 1 ? 'div' : 'img');
      node.className = 'quick-graphic';
      node.dataset.nativePath = graphic.path;
      rect(node, graphic.rect);
      node.style.opacity = String(graphic.alpha);
      const url = playerMediaUrl(graphic.sprite);
      if (node instanceof HTMLImageElement) {
        node.src = url;
        node.alt = '';
        node.draggable = false;
      } else if ('border' in graphic) {
        const [l, b, r, t] = graphic.border;
        node.style.borderStyle = 'solid';
        node.style.borderWidth = [t, r, b, l].map(unit).join(' ');
        node.style.borderImageSource = `url("${url}")`;
        node.style.borderImageSlice = `${t} ${r} ${b} ${l} fill`;
      }
      if (graphic.path === 'slider/slider') this.fill = node;
      if (graphic.path === 'speedBtn/bg') this.background = node;
      (graphic.path.startsWith('slider/') ? this.hold : this.speeds).append(node);
      this.entries.push({ node, path: graphic.path });
    }
    for (const control of profile.controls) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.quickSpeed = String(control.index);
      button.setAttribute('aria-label', `快进 ${4 * 2 ** control.index} 倍`);
      rect(button, control.rect);
      button.onclick = (e) => {
        e.stopPropagation();
        if (this.wasActive && !element.hidden) onSpeed(control.index);
      };
      // Chromium does not synthesize a click for the second finger while the
      // first one owns the canvas hold. Native EventSystem clicks that pointer.
      button.onpointerup = (e) => {
        if (e.pointerType !== 'touch' || e.isPrimary) return;
        const box = button.getBoundingClientRect();
        if (
          e.clientX < box.left ||
          e.clientX > box.right ||
          e.clientY < box.top ||
          e.clientY > box.bottom
        )
          return;
        e.preventDefault();
        e.stopPropagation();
        if (this.wasActive && !element.hidden) onSpeed(control.index);
      };
      this.speeds.append(button);
      this.buttons.push(button);
    }
  }
  update(
    visible: boolean,
    active: boolean,
    side: 'left' | 'right',
    speed: number,
    progress: number,
    now: number,
  ): void {
    if (active && !this.wasActive) this.started = now;
    this.wasActive = active;
    this.element.hidden = !visible;
    this.element.dataset.side = side;
    this.element.style.left = `calc(50% + ${unit(side === 'right' ? profile.x : -profile.x)})`;
    this.hold.hidden = active;
    this.speeds.hidden = !active;
    this.fill.style.clipPath = `inset(${100 * (1 - progress)}% 0 0 0)`;
    this.hold.setAttribute('aria-valuenow', String(progress));
    const elapsed = Math.max(0, (now - this.started) / 1000),
      t = Math.min(1, elapsed / profile.expandSeconds);
    const eased = t === 1 ? 1 : 1 - 2 ** (-10 * t),
      height = profile.smallHeight + (profile.height - profile.smallHeight) * eased;
    this.background.style.height = unit(height);
    this.background.style.top = unit(-height / 2);
    const alpha = Math.max(0, Math.min(1, (elapsed - profile.expandSeconds) / profile.fadeSeconds));
    for (const { node, path } of this.entries) {
      if (!path.startsWith('speedBtn/buttons/')) continue;
      node.style.opacity = String(alpha);
      const selected = /buttons\/(\d)\/Selected\//.exec(path);
      node.hidden = !!selected && Number(selected[1]) !== speed;
    }
    for (const [i, button] of this.buttons.entries()) {
      button.classList.toggle('selected', i === speed);
      button.setAttribute('aria-pressed', String(i === speed));
      button.disabled = !active;
    }
  }
}
