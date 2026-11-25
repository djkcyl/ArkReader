import { graphic, place, type Graphic } from './native-widgets';
import { NativeSelectableSurface } from './native-selectable';
import './native-settings-widgets.css';

interface Action {
  size: number[];
  background: Graphic;
  text: Graphic;
}
interface TabState {
  background: Graphic;
  icon?: Graphic;
  text: Graphic;
}
interface Tab {
  size: number[];
  on: TabState;
  off: TabState;
}
interface Toggle {
  size: number[];
  background: Graphic;
  bar: Graphic;
  on_mask: Graphic;
  unavailable_mask: Graphic;
  open: Graphic;
  close: Graphic;
  order: string[];
  tintPath: string;
  checkedState: string;
  uncheckedState: string;
  states: Record<string, { on_mask: boolean; unavailable_mask: boolean; barOffset: number }>;
}
export interface SettingsProfile {
  action: Action;
  toggle: Toggle;
  tabs: { game: Tab; audio: Tab };
}
const unit = (n: number) => `${n / 12.8}cqw`;
function label(g: Graphic, text: string) {
  const el = document.createElement('span');
  el.className = 'native-client-label';
  el.dataset.nativeLabel = '';
  el.dataset.nativeSource = g.path;
  el.textContent = text;
  place(el, g.rect);
  el.style.fontSize = unit(g.fontSize!);
  el.style.color = `rgba(${g.color
    .slice(0, 3)
    .map((n) => n * 255)
    .join(',')},${g.color[3]})`;
  return el;
}

/** Concrete controls from setting_state, including prefab overrides and the
 * switch Animator's actual on/off/disabled states. No AVG font-option skin. */
export function installSettingsWidgets(dialog: HTMLDialogElement, profile: SettingsProfile): void {
  const targets = new Map<HTMLElement, HTMLElement[]>(),
    updates: (() => void)[] = [];
  dialog.style.setProperty('--native-action-width', unit(profile.action.size[0]));
  dialog.style.setProperty('--native-action-height', unit(profile.action.size[1]));
  dialog.style.setProperty('--native-setting-font', unit(profile.action.text.fontSize!));
  for (const id of ['pause', 'window-full', 'full']) {
    const button = document.getElementById(id)!;
    const text = button.textContent ?? '';
    button.className = 'native-client-action';
    button.dataset.clientSetting = '';
    const art = graphic(profile.action.background);
    art.classList.add('native-client-tint');
    button.replaceChildren(art, label(profile.action.text, text));
    targets.set(button, [art]);
  }
  for (const [id, tab] of [
    ['native-story-settings-tab', profile.tabs.game],
    ['native-playback-settings-tab', profile.tabs.audio],
  ] as const) {
    const button = document.getElementById(id)!;
    const text = button.textContent ?? '';
    const scale = 1;
    button.className = 'native-client-tab';
    button.dataset.clientSetting = '';
    button.style.width = unit(tab.size[0] * scale);
    button.style.height = unit(tab.size[1] * scale);
    button.replaceChildren();
    const states = ([true, false] as const).map((selected) => {
      const profile = selected ? tab.on : tab.off,
        root = document.createElement('span');
      root.className = 'native-client-tab-state';
      root.dataset.selected = String(selected);
      root.style.transform = `scale(${scale})`;
      const art = graphic(profile.background);
      art.classList.add('native-client-tint');
      root.append(art);
      if (profile.icon) root.append(graphic(profile.icon));
      root.append(label(profile.text, text));
      button.append(root);
      return { root, art, selected };
    });
    updates.push(() => {
      for (const state of states) {
        state.root.hidden = (button.getAttribute('aria-selected') === 'true') !== state.selected;
        if (!state.root.hidden) targets.set(button, [state.art]);
      }
    });
  }
  for (const id of ['high-res-rt', 'quick-skip-decisions']) {
    const input = document.getElementById(id) as HTMLInputElement,
      root = input.parentElement!;
    const p = profile.toggle;
    root.className = 'native-client-toggle';
    root.style.width = unit(p.size[0]);
    root.style.height = unit(p.size[1]);
    input.dataset.clientSetting = '';
    const bg = graphic(p.background);
    bg.classList.add('native-client-tint');
    const nodes: Record<string, HTMLElement> = {
      button_bar: graphic(p.bar),
      on_mask: graphic(p.on_mask),
      unavailable_mask: graphic(p.unavailable_mask),
      open: label(p.open, '开'),
      close: label(p.close, '关'),
    };
    root.replaceChildren(bg, ...p.order.map((name) => nodes[name]), input);
    targets.set(input, [bg]);
    const sync = () => {
      const state =
        p.states[
          (input.disabled ? 'unavailable_' : '') +
            (input.checked ? p.checkedState : p.uncheckedState)
        ];
      root.dataset.value = input.checked ? 'on' : 'off';
      nodes.button_bar.style.translate = `${unit(state.barOffset)} 0`;
      nodes.on_mask.hidden = !state.on_mask;
      nodes.unavailable_mask.hidden = !state.unavailable_mask;
    };
    input.addEventListener('change', sync);
    updates.push(sync);
  }
  const selectable = new NativeSelectableSurface(
    dialog,
    '[data-client-setting]',
    () => dialog.open,
    (el) => (targets.get(el) ?? []).map((element) => ({ element })),
  );
  const update = () => {
    updates.forEach((fn) => fn());
    selectable.update();
  };
  new MutationObserver(update).observe(dialog, {
    attributes: true,
    subtree: true,
    attributeFilter: ['open', 'aria-selected', 'disabled'],
  });
  dialog.addEventListener('close', () => selectable.reset());
  update();
}
