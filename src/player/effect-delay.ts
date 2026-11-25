/** FxDelay.OnEnable disables once while Invoke is pending. An Animator can
 * re-enable it during that interval; the pending flag prevents another delay.
 * _DelayFunc calls SetActive(true) before clearing the flag. */
export class AnimatedEffectDelay {
  readonly delay: number;
  active: boolean;
  pending: number | null = null;
  disableEpoch = 0;
  constructor(delay: number, active: boolean) {
    this.delay = delay;
    this.active = active;
    if (active) this.onEnable(0);
  }
  private onEnable(time: number) {
    if (this.pending !== null) return;
    this.pending = time + this.delay;
    this.active = false;
    this.disableEpoch++;
  }
  setActive(active: boolean, time: number) {
    if (this.active === active) return;
    this.active = active;
    if (active) this.onEnable(time);
    else this.disableEpoch++;
  }
  update(time: number, animated: boolean) {
    if (this.pending !== null && time >= this.pending) {
      this.setActive(true, time);
      this.pending = null;
    }
    this.setActive(animated, time);
  }
  recycle() {
    this.pending = null;
    this.active = false;
    this.disableEpoch++;
  }
}
