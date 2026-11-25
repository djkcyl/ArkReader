/** AVGReaderModeAutoPlayController: separate cache and coroutine from the
 * ordinary AVGController auto mode. Serialized profiles in common reader prefab. */
export const readerSpeeds = [
  { base: 1.5, perChar: 0.03 },
  { base: 0.5, perChar: 0.02 },
  { base: 0.2, perChar: 0.01 },
] as const;
// avg_reader_setting_dialog serialized configurations, common.ab.
export const readerFonts = [
  { size: 20, nameSize: 24 },
  { size: 24, nameSize: 30 },
  { size: 28, nameSize: 30 },
] as const;
export const readerSpacing = [8, 10, 15] as const;
export const readerAlphas = [25, 50, 75, 100] as const;
export class ReaderPlayback {
  active = false;
  pure = false;
  auto = false;
  speed = 0;
  // GameDataConsts.avgReaderModeDefaultSetting (vtable slot 252): 75.
  // The name-size default is zero, so TextView preserves the prefab's 30.
  backgroundAlpha = 0.75;
  fontIndex = 1;
  spacingIndex = 1;
  alphaIndex = 2;
  get font() {
    return readerFonts[this.fontIndex];
  }
  get cellSpacing() {
    return readerSpacing[this.spacingIndex];
  }
  setFont(index: number): void {
    if (Number.isInteger(index) && readerFonts[index]) this.fontIndex = index;
  }
  setSpacing(index: number): void {
    if (Number.isInteger(index) && readerSpacing[index] !== undefined) this.spacingIndex = index;
  }
  setAlpha(index: number): void {
    if (Number.isInteger(index) && readerAlphas[index] !== undefined) {
      this.alphaIndex = index;
      this.backgroundAlpha = readerAlphas[index] / 100;
    }
  }
  waitingForInput = false;
  private pausedAuto = false;
  private theaterCache: {
    auto: boolean;
    speed: number;
  } | null = null;
  private click: {
    duration: number;
    remaining: number | null;
  } | null = null;
  get shouldAutoPlay(): boolean {
    return this.active && this.auto && !this.waitingForInput;
  }
  raise(length: number): void {
    const profile = readerSpeeds[this.speed];
    this.raiseSeconds(profile.base + length * profile.perChar);
  }
  raiseSeconds(duration: number): void {
    if (this.active) this.click = { duration, remaining: null };
  }
  toggleAuto(): void {
    this.auto = !this.auto;
    // MainDialog.EventOnAutoButtonClicked uses _clickAutoDelay, not text length.
    if (this.auto) this.raiseSeconds(0.2);
  }
  cycleSpeed(): void {
    this.speed = (this.speed + 1) % readerSpeeds.length;
  }
  stopClick(): void {
    this.click = null;
  }
  stopAuto(): void {
    this.click = null;
    this.auto = false;
    this.pausedAuto = false;
  }
  pauseAuto(): void {
    if (this.auto) {
      this.click = null;
      this.pausedAuto = true;
      this.auto = false;
    }
  }
  resumeAuto(): void {
    if (this.pausedAuto) {
      this.pausedAuto = false;
      this.auto = true;
      if (!this.waitingForInput) this.raiseSeconds(readerSpeeds[this.speed].base);
    }
  }
  suspendForTheater(): void {
    // _SetTheaterModeStatus caches Reader auto before MainState.OnExit resets
    // its controller. Speed is reloaded from the independent reader cache.
    const saved = { auto: this.auto, speed: this.speed };
    this.reset();
    this.theaterCache = saved;
  }
  restoreFromTheater(): void {
    const saved = this.theaterCache;
    if (!saved) return;
    this.theaterCache = null;
    this.auto = saved.auto;
    this.speed = saved.speed;
    this.waitingForInput = false;
    // ApplyRestoredAutoStatus schedules the base wait, not the old coroutine.
    if (this.auto) this.raiseSeconds(readerSpeeds[this.speed].base);
  }
  reset(): void {
    this.stopAuto();
    this.waitingForInput = false;
    this.speed = 0;
    this.theaterCache = null;
  }
  /** DoAutoClick waits for auto, then realtime delay, then auto again. Turning
   * the button off preserves the coroutine; dragging/manual input cancels it. */
  tick(delta: number): boolean {
    const click = this.click;
    if (!this.active || !click) return false;
    if (click.remaining === null) {
      if (this.auto) click.remaining = click.duration;
      return false;
    }
    click.remaining -= Math.max(0, delta);
    if (click.remaining > 0 || !this.auto) return false;
    this.click = null;
    return true;
  }
}
