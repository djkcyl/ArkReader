import { normalSettingsProfile } from './normal-settings-profile';
import { dialogPresets } from '../core/dialog-presets';
import { readerSettingsProfile } from './reader-settings-profile';
import { playerMediaUrl } from './resource-urls';
import { NativeSelectableSurface } from './native-selectable';
import { navigationProfile } from './navigation-profile';
type State = {
  key: string;
  index: number;
  on: boolean;
};
type Graphic = {
  path: string;
  rect: number[];
  color: number[];
  state?: State;
  sprite?: string;
  border?: number[];
  text?: string;
  fontSize?: number;
  align?: number;
  flow?: boolean;
  spacing?: number;
};
const logical = (n: number) => `${n / 12.8}cqw`;
function place(el: HTMLElement, rect: number[]): void {
  [el.style.left, el.style.top, el.style.width, el.style.height] = rect.map(logical);
}
/** Prefab-defined ordinary and Reader settings, each using its own native profile.
 * Native click areas remain accessible radio/checkbox inputs; the original
 * graphics and text occupy their own serialized rectangles. */
export class ReaderSettingsView {
  private native = false;
  private profile: typeof readerSettingsProfile | typeof normalSettingsProfile =
    readerSettingsProfile;
  private initializedProfile: unknown;
  private ordinary = false;
  private fadingOut = false;
  private fade?: Animation;
  private art = document.createElement('div');
  private blocker = document.createElement('div');
  private states: {
    element: HTMLElement;
    state: State;
  }[] = [];
  private backgroundPress = false;
  private selectable: NativeSelectableSurface;
  constructor(
    private dialog: HTMLDialogElement,
    private stage: HTMLElement,
    private close: HTMLElement,
  ) {
    this.selectable = new NativeSelectableSurface(
      dialog,
      '.reader-setting-hit input,#close-settings',
      () => dialog.open,
      (el) =>
        [...this.art.querySelectorAll<HTMLElement>('[data-selectable-input]')]
          .filter((g) => g.dataset.selectableInput === el.id)
          .map((element) => ({ element })),
    );
    this.art.className = 'reader-settings-art';
    this.art.setAttribute('aria-hidden', 'true');
    this.blocker.className = 'reader-settings-blocker';
    dialog.append(this.art, this.blocker);
    this.blocker.onclick = (e) => e.stopPropagation();
    dialog.addEventListener('pointerdown', (e) => {
      this.backgroundPress = e.button === 0 && e.target === dialog;
    });
    // Browser click may be retargeted to the common ancestor after dragging
    // from an input to the backdrop. Unity PointerClick requires the same target.
    dialog.addEventListener('click', (e) => {
      if (this.native && e.target === dialog && (e.detail === 0 || this.backgroundPress))
        this.dismiss();
      this.backgroundPress = false;
    });
    dialog.addEventListener('change', () => this.update());
    dialog.addEventListener('close', () => this.selectable.update());
    dialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      this.dismiss();
    });
    new ResizeObserver(() => this.fit()).observe(stage);
    window.addEventListener('scroll', () => this.fit(), { passive: true });
    window.addEventListener('resize', () => this.fit(), { passive: true });
  }
  configure(reader: boolean): void {
    this.native = true;
    this.ordinary = !reader;
    this.profile = reader ? readerSettingsProfile : normalSettingsProfile;
    this.dialog.classList.add('native-settings');
    this.dialog.classList.toggle('reader-settings-native', reader);
    this.dialog.classList.toggle('normal-settings-native', !reader);
    if (this.initializedProfile !== this.profile) {
      this.selectable.reset();
      this.art.replaceChildren();
      this.states = [];
      this.initializedProfile = this.profile;
      this.initialize();
    }
    place(this.blocker, this.profile.blocker);
    place(this.close, this.profile.close);
    this.fit();
    this.update();
  }
  show(): void {
    delete this.dialog.dataset.audioClosing;
    this.fadingOut = false;
    this.fade?.cancel();
    this.dialog.style.opacity = '1';
    this.dialog.showModal();
    this.selectable.update();
    // Reader's inherited DefaultDialogSwitchTween adds a 0.1s show delay.
    this.animateAlpha(0, 1, this.ordinary ? 0 : 0.1 * 1000);
  }
  dismiss(immediate = false): void {
    if (!this.dialog.open || this.fadingOut) return;
    this.dialog.dataset.audioClosing = '1';
    // AVGSettingView resumes both auto controllers before starting its fade.
    this.dialog.dispatchEvent(new Event('settings-dismiss'));
    if (immediate) {
      this.fade?.cancel();
      this.dialog.close();
      this.dialog.style.opacity = '1';
      return;
    }
    this.fadingOut = true;
    const alpha = Number(getComputedStyle(this.dialog).opacity);
    const fade = this.animateAlpha(alpha, 0);
    void fade.finished
      .then(() => {
        if (this.fade === fade) {
          this.dialog.close();
          fade.cancel();
          this.dialog.style.opacity = '1';
          this.fadingOut = false;
        }
      })
      .catch(() => {});
  }
  private animateAlpha(from: number, to: number, delay = 0): Animation {
    this.fade?.cancel();
    // FadeSwitchTween default 0.16f; DOTween default OutQuad; unscaled clock.
    return (this.fade = this.dialog.animate([{ opacity: from }, { opacity: to }], {
      duration: 0.16 * 1000,
      delay,
      easing: 'cubic-bezier(.3333333333333333,.6666666666666666,.6666666666666666,1)',
      fill: 'both',
    }));
  }
  private fit(): void {
    if (!this.native) return;
    const b = this.stage.getBoundingClientRect();
    Object.assign(this.dialog.style, {
      left: b.left + 'px',
      top: b.top + 'px',
      width: b.width + 'px',
      height: b.height + 'px',
    });
  }
  private input(key: string, index: number): HTMLInputElement {
    if (key === 'dialog')
      return this.dialog.querySelector<HTMLInputElement>(
        `input[name="dialog-size"][value="${dialogPresets[index].id}"]`,
      )!;
    return this.dialog.querySelector<HTMLInputElement>(
      key === 'characters'
        ? '#reader-show-characters'
        : `input[name="reader-${key}"][value="${index}"]`,
    )!;
  }
  update(): void {
    if (!this.native) return;
    for (const { element, state } of this.states)
      element.hidden = this.input(state.key, state.index).checked !== state.on;
    for (const control of this.profile.controls) {
      const input = this.input(control.key, control.index);
      const hits = (
        control.hits as {
          rect: number[];
          on?: boolean;
        }[]
      )
        .filter((h) => h.on === undefined || h.on === input.checked)
        .map((h) => h.rect);
      const x = Math.min(...hits.map((r) => r[0])),
        y = Math.min(...hits.map((r) => r[1]));
      place(input.closest('label')!, [
        x,
        y,
        Math.max(...hits.map((r) => r[0] + r[2])) - x,
        Math.max(...hits.map((r) => r[1] + r[3])) - y,
      ]);
    }
    this.selectable.update();
  }
  private initialize(): void {
    let flow: HTMLElement | undefined;
    for (const g of this.profile.graphics as Graphic[]) {
      const element = document.createElement('span');
      element.dataset.nativePath = g.path;
      if (
        g.path === '/bg_gradient' ||
        g.path === '/btn_setting' ||
        g.path === '/btn_setting (1)/image'
      )
        element.dataset.settingsShell = '';
      element.className = 'reader-setting-graphic';
      place(element, g.rect);
      if (g.sprite) {
        const url = `url("${playerMediaUrl(g.sprite)}")`;
        if (g.border) {
          const [left, bottom, right, top] = g.border;
          Object.assign(element.style, {
            borderStyle: 'solid',
            borderWidth: [top, right, bottom, left].map(logical).join(' '),
            borderImageSource: url,
            borderImageSlice: `${top} ${right} ${bottom} ${left} fill`,
          });
        } else {
          element.style.backgroundImage = url;
          element.style.backgroundSize = '100% 100%';
        }
        if (g.color.slice(0, 3).every((v) => v === 0)) element.style.filter = 'brightness(0)';
        element.style.opacity = String(g.color[3]);
        element.style.setProperty('--native-base-alpha', String(g.color[3]));
      } else {
        element.textContent = g.text ?? '';
        element.style.fontSize = logical(g.fontSize ?? 20);
        element.style.color = `rgba(${g.color
          .slice(0, 3)
          .map((v) => v * 255)
          .join(',')},${g.color[3]})`;
        element.style.display = 'flex';
        element.style.alignItems = ['flex-start', 'center', 'flex-end'][
          Math.floor((g.align ?? 0) / 3)
        ];
        element.style.justifyContent = ['flex-start', 'center', 'flex-end'][(g.align ?? 0) % 3];
      }
      if (g.flow) {
        if (!flow) {
          flow = document.createElement('span');
          flow.className = 'reader-setting-title-flow';
          place(flow, g.rect);
          flow.style.gap = logical(g.spacing ?? 0);
          this.art.append(flow);
        }
        element.style.position = 'static';
        element.style.width = 'max-content';
        element.style.height = logical(g.fontSize ?? 20);
        flow.append(element);
      } else this.art.append(element);
      if (g.state) this.states.push({ element, state: g.state });
    }
    for (const control of this.profile.controls) {
      const input = this.input(control.key, control.index),
        label = input.closest('label')!;
      const navigation = (
        this.ordinary ? navigationProfile.normalSettings : navigationProfile.readerSettings
      ) as Record<string, number[]>;
      input.dataset.nativeNavigationRect = JSON.stringify(
        navigation[`${control.key}:${control.index}`],
      );
      label.classList.add('reader-setting-hit');
      place(label, control.rect);
      input.setAttribute(
        'aria-label',
        control.key === 'characters' ? '显示人物立绘' : (label.textContent?.trim() ?? ''),
      );
      if ('tintTarget' in control && typeof control.tintTarget === 'string') {
        input.id ||= `reader-native-${control.key}-${control.index}`;
        const graphic = [...this.art.querySelectorAll<HTMLElement>('[data-native-path]')].find(
          (el) => el.dataset.nativePath === control.tintTarget,
        )!;
        this.bindTint(input, graphic, `${control.key}-${control.index}`);
      }
    }
    if ('closeTintTarget' in this.profile) {
      const path = this.profile.closeTintTarget;
      const graphic = [...this.art.querySelectorAll<HTMLElement>('[data-native-path]')].find(
        (el) => el.dataset.nativePath === path,
      )!;
      this.bindTint(this.close, graphic, 'close');
    }
  }
  private bindTint(input: HTMLElement, graphic: HTMLElement, id: string) {
    graphic.dataset.selectableTint = id;
    graphic.dataset.selectableInput = input.id;
    // CanvasRenderer color multiplies this Image's serialized vertex color;
    // neither children nor sibling selected artwork inherit the tint.
    const style = document.createElement('style');
    const target = `#reading-settings.native-settings [data-selectable-tint="${id}"]`;
    const state = (s: string) =>
      `#reading-settings.native-settings:has(#${input.id}[data-native-state="${s}"]) [data-selectable-tint="${id}"]`;
    style.textContent =
      `${target}{filter:brightness(1);transition:none}` +
      `${state('highlighted')},${state('selected')}{filter:brightness(.960784316)}` +
      `${state('pressed')}{filter:brightness(.784313738)}` +
      `${state('disabled')}{filter:brightness(.784313738);opacity:calc(var(--native-base-alpha,1)*.501960814)!important}`;
    this.art.append(style);
  }
}
