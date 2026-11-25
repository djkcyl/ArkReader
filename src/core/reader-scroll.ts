/** Vertical ScrollRect in avg_reader_main_dialog: Elastic=.1, Inertia=.135.
 * Positions are logical pixels from the top, independent of story time. */
export class ReaderScroll {
  position = 0;
  velocity = 0;
  viewport = 720;
  extent = 0;
  dragging = false;
  private origin = 0;
  private previous = 0;
  get bounded() {
    return Math.max(0, Math.min(this.extent, this.position));
  }
  get normalized() {
    return this.extent > 0 ? 1 - this.position / this.extent : 1;
  }
  get showTop() {
    return this.normalized <= 0.999 && this.normalized >= 0.001;
  }
  reset(position: number) {
    this.position = position;
    this.previous = position;
    this.velocity = 0;
    this.dragging = false;
  }
  begin() {
    this.origin = this.position;
    this.previous = this.position;
    this.velocity = 0;
    this.dragging = true;
  }
  drag(delta: number) {
    if (!this.dragging) return;
    const wanted = this.origin - delta,
      bound = Math.max(0, Math.min(this.extent, wanted)),
      over = wanted - bound;
    this.position = bound + rubberDelta(over, this.viewport);
  }
  end() {
    this.dragging = false;
  }
  wheel(delta: number) {
    this.position += delta;
  }
  tick(dt: number) {
    if (!(dt > 0)) return;
    if (this.dragging) {
      const t = Math.min(1, dt * 10);
      this.velocity += ((this.position - this.previous) / dt - this.velocity) * t;
    } else if (this.position !== this.bounded) {
      // Mathf.SmoothDamp(current, current+offset, velocity, elasticity, Infinity, dt).
      const target = this.bounded,
        omega = 20,
        x = omega * dt,
        decay = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
      const change = this.position - target,
        temp = (this.velocity + omega * change) * dt;
      this.velocity = (this.velocity - omega * temp) * decay;
      const next = target + (change + temp) * decay;
      if (target - this.position > 0 === next > target) {
        this.position = target;
        this.velocity = 0;
      } else this.position = next;
      if (Math.abs(this.velocity) < 1) this.velocity = 0;
    } else {
      this.velocity *= Math.pow(0.135, dt);
      if (Math.abs(this.velocity) < 1) this.velocity = 0;
      this.position += this.velocity * dt;
    }
    this.previous = this.position;
  }
}
export function rubberDelta(distance: number, view: number): number {
  return view > 0
    ? (1 - 1 / ((Math.abs(distance) * 0.55) / view + 1)) * view * Math.sign(distance)
    : 0;
}
