import { expireTrailPoints, type TrailPoint } from './particle-trails.ts';
export interface StandaloneTrailPoint extends TrailPoint {
  emitting: boolean;
}
/** TrailRenderer::CalculateWorldMatrixAndBoundsJob, AddPoint, RemoveOldPoints.
 * Unlike particle trails, append precedes expiry and disabled emission is a
 * width mask on stored points. Keep positions in world space across movement. */
export class StandaloneTrailHistory {
  points: StandaloneTrailPoint[] = [];
  head: number[] | null = null;
  update(
    position: number[],
    time: number,
    lifetime: number,
    minDistance: number,
    emitting: boolean,
  ) {
    position = position.slice();
    const append = (p: number[]) => this.points.push({ position: [...p], time, emitting });
    if (!this.points.length && this.head) append(this.head);
    const last = this.points.at(-1),
      delta = last ? position.map((v, i) => v - last.position[i]) : null;
    const distance = delta
      ? delta[0] * delta[0] + delta[1] * delta[1] + delta[2] * delta[2]
      : Infinity;
    if (!last || distance > minDistance * minDistance) append(position);
    expireTrailPoints(this.points, time, lifetime);
    this.head = position;
  }
  /** TrailRenderer::FlattenRingbuffer (0xDF2520). */
  flatten(time: number, lifetime: number, emitting: boolean) {
    if (!this.points.length || !this.head) return { positions: [], masks: [] };
    const positions = [[...this.head], ...this.points.map((p) => [...p.position]).reverse()];
    const masks = [Number(emitting), ...this.points.map((p) => Number(p.emitting)).reverse()];
    if (this.points.length > 1) {
      const [a, b] = this.points,
        denominator = Math.max(b.time - a.time, 1e-9);
      const weight = Math.min(1, Math.max(0, (time - lifetime - a.time) / denominator));
      positions[positions.length - 1] = a.position.map((v, i) => v + (b.position[i] - v) * weight);
    }
    return { positions, masks };
  }
  clear() {
    this.points = [];
    this.head = null;
  }
}
