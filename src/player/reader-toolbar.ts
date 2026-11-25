/** AVGReaderModeAutoButton: unscaled looping DOTween float 0..3, default
 * OutQuad easing, truncated before the 19-unit repeated arrow width is added. */
export class ReaderToolbar {
  private visible = false;
  private auto = false;
  private started = 0;
  constructor(
    private button: HTMLElement,
    private speedButton: HTMLElement,
  ) {}
  update(visible: boolean, auto: boolean, speed: number, now = performance.now()): void {
    if (visible && auto && (!this.visible || !this.auto)) this.started = now;
    this.visible = visible;
    this.auto = auto;
    if (!visible) return;
    const duration = 0.4 * 3 * 1000;
    const progress = (Math.max(0, now - this.started) % duration) / duration;
    const step = Math.trunc(3 * progress * (2 - progress));
    this.button.style.setProperty(
      '--reader-auto-width',
      `${(auto ? 75 + 19 * step : 56) / 12.8}cqw`,
    );
    this.speedButton.dataset.speed = String(speed + 1);
  }
}
