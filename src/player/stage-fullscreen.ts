import { setControlLabel } from './control-label';
/** Browser display mode, separate from the story's authored camera/viewport. */
export class StageFullscreen {
  private pending = false;
  private revision = 0;
  constructor(
    private surface: HTMLElement,
    private button: HTMLButtonElement,
    private windowButton?: HTMLButtonElement,
  ) {
    button.onclick = () => void this.toggle();
    if (windowButton) windowButton.onclick = () => void this.toggleWindow();
    document.addEventListener('keydown', (event) => {
      if (
        event.key === 'F10' &&
        !event.shiftKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.metaKey &&
        document.body.classList.contains('playing') &&
        !document.body.classList.contains('resource-loading')
      ) {
        event.preventDefault();
        void this.toggleWindow();
      }
    });
    document.addEventListener('fullscreenchange', () => this.sync());
    this.sync();
  }
  get active(): boolean {
    return (
      document.fullscreenElement === this.surface ||
      this.surface.classList.contains('window-filled')
    );
  }
  private supported(): boolean {
    return (
      typeof this.surface.requestFullscreen === 'function' && document.fullscreenEnabled !== false
    );
  }
  private fillWindow(value: boolean): void {
    this.surface.classList.toggle('window-filled', value);
    document.body.classList.toggle('window-filled', value);
  }
  private sync(): void {
    const filled = this.surface.classList.contains('window-filled');
    setControlLabel(
      this.button,
      document.fullscreenElement === this.surface ? '退出全屏' : '系统全屏',
    );
    this.button.setAttribute('aria-pressed', String(document.fullscreenElement === this.surface));
    this.button.disabled = this.pending;
    if (this.windowButton) {
      setControlLabel(this.windowButton, filled ? '退出窗口全屏' : '窗口全屏');
      this.windowButton.setAttribute('aria-pressed', String(filled));
      this.windowButton.disabled = this.pending;
    }
    this.surface.dispatchEvent(new Event('playback-screen-mode'));
  }
  private async toggle(): Promise<void> {
    if (this.pending) return;
    if (document.fullscreenElement === this.surface) {
      await this.exit();
      return;
    }
    this.fillWindow(false);
    const revision = ++this.revision;
    this.pending = true;
    this.sync();
    try {
      if (this.supported()) await this.surface.requestFullscreen();
      else this.fillWindow(true);
    } catch {
      // Permission denial or an unsupported implementation must not break play.
      if (revision === this.revision) this.fillWindow(true);
    } finally {
      this.pending = false;
      // Leaving the story may have raced the browser's asynchronous transition.
      if (revision !== this.revision) await this.exit();
      this.sync();
    }
  }
  async toggleWindow(): Promise<void> {
    if (this.pending) return;
    const filled = this.surface.classList.contains('window-filled'),
      revision = ++this.revision;
    this.pending = true;
    this.sync();
    try {
      if (document.fullscreenElement === this.surface) await document.exitFullscreen();
      if (revision === this.revision) this.fillWindow(!filled);
    } catch {
      /* Keep the existing screen mode if the platform refuses to exit it. */
    } finally {
      this.pending = false;
      this.sync();
    }
  }
  async exit(): Promise<void> {
    ++this.revision;
    this.fillWindow(false);
    try {
      if (document.fullscreenElement === this.surface) await document.exitFullscreen();
    } catch {
      /* The browser may already have exited while this request was pending. */
    }
    this.sync();
  }
}
