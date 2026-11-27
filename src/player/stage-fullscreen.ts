import { setControlLabel } from './control-label';
import { isWeb, isMobile } from '../app/platform';

/** Display orientation is independent of the story's authored camera. */
export class StageFullscreen {
  private pending = false;
  private revision = 0;
  private orientationLocked = false;
  private systemFullscreen = false;
  private mobileSession = false;
  private mobilePlaying = false;
  private layout = '';
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
    window.addEventListener('resize', () => this.sync(), { passive: true });
    window.visualViewport?.addEventListener('resize', () => this.sync(), { passive: true });
    window.visualViewport?.addEventListener('scroll', () => this.sync(), { passive: true });
    screen.orientation?.addEventListener('change', () => this.sync());
    document.body.classList.toggle('web-system-fullscreen', isWeb && isMobile && this.supported());
    this.sync();
  }
  get active(): boolean {
    return this.full() || this.surface.classList.contains('window-filled');
  }
  private full(): boolean {
    return (
      document.fullscreenElement === this.surface ||
      (this.mobileSession && document.fullscreenElement === document.documentElement)
    );
  }
  private supported(): boolean {
    const target = isWeb && isMobile ? document.documentElement : this.surface;
    return typeof target.requestFullscreen === 'function' && document.fullscreenEnabled !== false;
  }
  private fillWindow(value: boolean): void {
    this.surface.classList.toggle('window-filled', value);
    document.body.classList.toggle('window-filled', value);
  }
  private unlock(): void {
    if (this.orientationLocked) screen.orientation?.unlock();
    this.orientationLocked = false;
  }
  /** Called before the first await in the user's Play/Continue click. */
  prepareMobile(): void {
    if (!isWeb || !isMobile) return;
    this.mobileSession = true;
    if (
      !this.full() &&
      !this.pending &&
      this.supported() &&
      navigator.userActivation?.isActive !== false
    )
      void this.requestSystem(true);
  }
  enterMobile(): void {
    this.mobileSession = this.mobilePlaying = true;
    this.fillWindow(true);
    this.sync();
  }
  private sync(): void {
    const full = this.full();
    if (this.systemFullscreen && !full) this.unlock();
    this.systemFullscreen = full;
    if (this.mobilePlaying) this.fillWindow(true);
    const viewport = window.visualViewport;
    const width = viewport?.width ?? innerWidth,
      height = viewport?.height ?? innerHeight;
    const rotated = isWeb && isMobile && this.mobilePlaying && height > width + 1;
    this.surface.dataset.stageRotated = String(rotated);
    document.body.classList.toggle('mobile-landscape', rotated);
    this.surface.style.setProperty('--stage-screen-width', `${width}px`);
    this.surface.style.setProperty('--stage-screen-height', `${height}px`);
    this.surface.style.setProperty('--stage-screen-left', `${viewport?.offsetLeft ?? 0}px`);
    this.surface.style.setProperty('--stage-screen-top', `${viewport?.offsetTop ?? 0}px`);
    const filled = this.surface.classList.contains('window-filled');
    setControlLabel(this.button, full ? '退出全屏' : '系统全屏');
    this.button.setAttribute('aria-pressed', String(full));
    this.button.disabled = this.pending;
    if (this.windowButton) {
      setControlLabel(this.windowButton, filled ? '退出窗口全屏' : '窗口全屏');
      this.windowButton.setAttribute('aria-pressed', String(filled));
      this.windowButton.disabled = this.pending;
    }
    const layout = `${full}/${filled}/${rotated}/${width}/${height}/${viewport?.offsetLeft}/${viewport?.offsetTop}`;
    if (layout !== this.layout) {
      this.layout = layout;
      this.surface.dispatchEvent(new Event('playback-screen-mode', { bubbles: true }));
    }
  }
  private async requestSystem(mobile: boolean): Promise<void> {
    if (this.pending) return;
    if (!mobile) this.fillWindow(false);
    const revision = ++this.revision;
    const target = mobile ? document.documentElement : this.surface;
    this.pending = true;
    this.sync();
    try {
      if (this.supported()) {
        await target.requestFullscreen({ navigationUI: 'hide' });
        const orientation = screen.orientation as ScreenOrientation & {
          lock?: (mode: string) => Promise<void>;
        };
        if (mobile && revision === this.revision && orientation?.lock) {
          try {
            await orientation.lock('landscape');
            this.orientationLocked = true;
          } catch {
            /* Portrait browser layouts use the same landscape stage below. */
          }
        }
      } else if (!mobile) this.fillWindow(true);
    } catch {
      if (!mobile && revision === this.revision) this.fillWindow(true);
    } finally {
      this.pending = false;
      if (revision !== this.revision) {
        this.unlock();
        if (document.fullscreenElement === target) await document.exitFullscreen().catch(() => {});
      }
      this.sync();
    }
  }
  private async toggle(): Promise<void> {
    if (this.pending) return;
    if (isWeb && isMobile) {
      this.mobileSession = true;
      if (this.full()) {
        ++this.revision;
        this.unlock();
        await document.exitFullscreen().catch(() => {});
        this.sync();
      } else await this.requestSystem(true);
    } else if (this.full()) await this.exit();
    else await this.requestSystem(false);
  }
  async toggleWindow(): Promise<void> {
    if (this.pending) return;
    const filled = this.surface.classList.contains('window-filled'),
      revision = ++this.revision;
    this.pending = true;
    this.sync();
    try {
      if (this.full()) await document.exitFullscreen();
      if (revision === this.revision) this.fillWindow(!filled);
    } catch {
      /* Retain the previous display when the browser refuses a change. */
    } finally {
      this.pending = false;
      this.sync();
    }
  }
  async exit(): Promise<void> {
    ++this.revision;
    const full = this.full();
    this.mobileSession = this.mobilePlaying = false;
    this.unlock();
    this.fillWindow(false);
    this.sync();
    try {
      if (full) await document.exitFullscreen();
    } catch {
      /* The browser may already have exited fullscreen. */
    }
    this.sync();
  }
}
