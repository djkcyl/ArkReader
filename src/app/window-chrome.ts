import { invoke } from '@tauri-apps/api/core';
import { isDesktop } from './platform';
import { getCurrentWindow } from '@tauri-apps/api/window';
import './window-chrome.css';

const icons = {
  minimize: '<path d="M3 8h10"/>',
  maximize: '<rect x="3.5" y="3.5" width="9" height="9"/>',
  restore: '<path d="M5.5 4.5v-2h8v8h-2"/><rect x="2.5" y="5.5" width="8" height="8"/>',
  close: '<path d="m3.5 3.5 9 9m0-9-9 9"/>',
};
const icon = (name: keyof typeof icons) =>
  `<svg viewBox="0 0 16 16" aria-hidden="true">${icons[name]}</svg>`;

export function mountWindowChrome(header: HTMLElement): () => void {
  if (!isDesktop || header.classList.contains('app-titlebar')) return () => {};
  const appWindow = getCurrentWindow();
  header.classList.add('app-titlebar');
  header.setAttribute('aria-label', 'ArkReader 标题栏');
  for (const link of header.querySelectorAll('a')) link.draggable = false;
  const controls = document.createElement('div');
  controls.className = 'window-controls';
  controls.setAttribute('role', 'group');
  controls.setAttribute('aria-label', '窗口操作');
  for (const [action, label] of [
    ['minimize', '最小化'],
    ['maximize', '最大化'],
    ['close', '关闭窗口'],
  ] as const) {
    const button = document.createElement('button');
    button.id = `window-${action}`;
    button.type = 'button';
    button.title = label;
    button.setAttribute('aria-label', label);
    button.innerHTML = icon(action);
    controls.append(button);
  }
  header.append(controls);
  const minimize = controls.querySelector<HTMLButtonElement>('#window-minimize')!;
  const maximize = controls.querySelector<HTMLButtonElement>('#window-maximize')!;
  const close = controls.querySelector<HTMLButtonElement>('#window-close')!;
  const notice = document.createElement('p');
  notice.className = 'window-action-error';
  notice.hidden = true;
  notice.setAttribute('role', 'alert');
  header.after(notice);
  let closing = false,
    changing = false,
    revision = 0,
    disposed = false;
  const unlisten: (() => void)[] = [];
  const report = (error: unknown) => {
    notice.textContent = `窗口操作未完成：${String(error)}`;
    notice.hidden = false;
  };
  const register = (listener: Promise<() => void>) => {
    void listener
      .then((stop) => {
        if (disposed) stop();
        else unlisten.push(stop);
      })
      .catch(report);
  };
  async function sync() {
    const request = ++revision;
    try {
      const [maximized, focused] = await Promise.all([
        appWindow.isMaximized(),
        appWindow.isFocused(),
      ]);
      if (disposed || request !== revision) return;
      maximize.innerHTML = icon(maximized ? 'restore' : 'maximize');
      maximize.title = maximized ? '还原窗口' : '最大化';
      maximize.setAttribute('aria-label', maximize.title);
      maximize.setAttribute('aria-pressed', String(maximized));
      document.body.classList.toggle('window-maximized', maximized);
      header.classList.toggle('window-unfocused', !focused);
    } catch (error) {
      if (!disposed) report(error);
    }
  }
  async function toggleMaximize() {
    if (changing || closing) return;
    changing = true;
    maximize.disabled = true;
    notice.hidden = true;
    try {
      await appWindow.toggleMaximize();
      await sync();
    } catch (error) {
      report(error);
    } finally {
      changing = false;
      maximize.disabled = false;
    }
  }
  async function quit() {
    if (closing) return;
    closing = true;
    close.disabled = true;
    notice.hidden = true;
    // Synchronous subscribers save the current reading position before native teardown.
    document.dispatchEvent(new Event('arkreader-before-close'));
    try {
      await invoke('app_quit');
    } catch (error) {
      closing = false;
      close.disabled = false;
      report(error);
    }
  }
  minimize.onclick = () => {
    notice.hidden = true;
    void appWindow.minimize().catch(report);
  };
  maximize.onclick = () => void toggleMaximize();
  close.onclick = () => void quit();
  const draggable = (target: EventTarget | null) =>
    target instanceof Element && !target.closest('button,a,input,select,textarea,[role=button]');
  // Manual drag regions keep controls interactive and avoid a native titlebar
  // context menu. The second primary press follows the native double-click rule.
  header.addEventListener('mousedown', (event) => {
    if (event.button !== 0 || event.buttons !== 1 || !draggable(event.target)) return;
    event.preventDefault();
    if (event.detail === 2) void toggleMaximize();
    else void appWindow.startDragging().catch(report);
  });
  header.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' || event.button !== 0 || !draggable(event.target)) return;
    event.preventDefault();
    void appWindow.startDragging().catch(report);
  });
  register(appWindow.onResized(() => void sync()));
  register(appWindow.onFocusChanged(() => void sync()));
  register(
    appWindow.onCloseRequested((event) => {
      if (!closing) {
        event.preventDefault();
        void quit();
      }
    }),
  );
  const dispose = () => {
    disposed = true;
    for (const stop of unlisten.splice(0)) stop();
    notice.remove();
    window.removeEventListener('pagehide', dispose);
  };
  window.addEventListener('pagehide', dispose, { once: true });
  void sync();
  return dispose;
}
