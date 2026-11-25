/** Fullscreen progress is an overlay, never part of the stage's layout. */
export class FloatingProgress {
  private floating = false;
  private timer?: ReturnType<typeof setTimeout>;
  private dragging = false;
  private revealPointer: number | null = null;
  private suppressClickUntil = 0;
  private compact = matchMedia('(max-height:500px) and (orientation:landscape)');
  constructor(
    private surface: HTMLElement,
    private footer: HTMLElement,
  ) {
    surface.addEventListener('playback-screen-mode', () => this.sync());
    document.addEventListener('fullscreenchange', () => this.sync());
    this.compact.addEventListener('change', () => this.sync());
    surface.addEventListener(
      'pointermove',
      (event) => {
        if (!this.floating || event.pointerType !== 'mouse' || event.buttons) return;
        if (this.nearBottom(event.clientY)) this.show();
      },
      { passive: true },
    );
    surface.addEventListener(
      'pointerdown',
      (event) => {
        if (!this.floating) return;
        if (this.footer.contains(event.target as Node)) {
          this.dragging = true;
          this.show();
          return;
        }
        // A first touch near the bottom reveals controls without advancing the story.
        if (event.isPrimary && event.pointerType === 'touch' && this.nearBottom(event.clientY)) {
          this.revealPointer = event.pointerId;
          this.show();
          event.preventDefault();
          event.stopPropagation();
        }
      },
      true,
    );
    window.addEventListener(
      'pointerup',
      (event) => {
        if (event.pointerId === this.revealPointer) {
          this.revealPointer = null;
          this.suppressClickUntil = performance.now() + 500;
        }
        if (this.dragging) {
          this.dragging = false;
          this.show();
        }
      },
      true,
    );
    window.addEventListener(
      'pointercancel',
      () => {
        this.dragging = false;
        this.revealPointer = null;
        this.hide();
      },
      true,
    );
    surface.addEventListener(
      'click',
      (event) => {
        if (
          this.floating &&
          performance.now() < this.suppressClickUntil &&
          !this.footer.contains(event.target as Node)
        ) {
          event.preventDefault();
          event.stopPropagation();
        }
      },
      true,
    );
    surface.addEventListener('pointerleave', (event) => {
      if (event.pointerType === 'mouse' && !this.dragging) this.hide();
    });
    footer.addEventListener('focusin', () => this.show());
    footer.addEventListener('focusout', () => this.show());
    window.addEventListener('blur', () => {
      this.dragging = false;
      this.hide();
    });
    this.sync();
  }
  private nearBottom(y: number) {
    const area = this.surface.classList.contains('script-open')
      ? (this.surface.querySelector<HTMLElement>('.playback-frame') ?? this.surface)
      : this.surface;
    const rect = area.getBoundingClientRect();
    return y >= rect.bottom - 56 && y <= rect.bottom;
  }
  private sync() {
    const floating =
      this.surface.classList.contains('window-filled') ||
      document.fullscreenElement === this.surface ||
      this.compact.matches;
    this.floating = floating;
    this.surface.classList.toggle('floating-progress', floating);
    this.hide();
  }
  private show() {
    if (!this.floating) return;
    clearTimeout(this.timer);
    this.surface.classList.add('progress-open');
    this.timer = setTimeout(() => {
      if (this.dragging) this.show();
      else this.hide();
    }, 1800);
  }
  private hide() {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.surface.classList.remove('progress-open');
  }
}
