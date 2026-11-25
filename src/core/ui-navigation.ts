export type NavigationRect = readonly [number, number, number, number];
export type MoveDirection = 'left' | 'up' | 'right' | 'down';
export const moveVector: Record<MoveDirection, readonly [number, number]> = {
  left: [-1, 0],
  up: [0, -1],
  right: [1, 0],
  down: [0, 1],
};
export function navigationTarget(
  rect: NavigationRect,
  candidates: readonly NavigationRect[],
  direction: MoveDirection,
): number {
  const [dx, dy] = moveVector[direction];
  // GetPointOnRectEdge starts at the edge of the SOURCE Selectable's rect.
  const x = rect[0] + rect[2] * 0.5 + dx * 0.5 * rect[2],
    y = rect[1] + rect[3] * 0.5 + dy * 0.5 * rect[3];
  let best = -1,
    score = -Infinity;
  candidates.forEach((r, i) => {
    const vx = r[0] + r[2] * 0.5 - x,
      vy = r[1] + r[3] * 0.5 - y;
    const dot = vx * dx + vy * dy;
    if (dot <= 0) return;
    const next = dot / (vx * vx + vy * vy);
    // Strict comparison preserves registration order on equal scores.
    if (next > score) {
      score = next;
      best = i;
    }
  });
  return best;
}
export function moveDirection(x: number, y: number): MoveDirection | undefined {
  if (x * x + y * y < 0.6 * 0.6) return;
  return Math.abs(x) > Math.abs(y) ? (x > 0 ? 'right' : 'left') : y > 0 ? 'up' : 'down';
}
export function navigationRepeatReady(
  time: number,
  previous: number,
  count: number,
  x: number,
  y: number,
  previousX: number,
  previousY: number,
): boolean {
  const same = x * previousX + y * previousY > 0;
  return time > previous + (same && count === 1 ? 0.5 : 1 / 10);
}
export class NavigationRepeat {
  private previous = 0;
  private x = 0;
  private y = 0;
  private count = 0;
  /** A released axis resets the consecutive count, not the last action time. */
  release(): void {
    this.count = 0;
  }
  poll(time: number, x: number, y: number): MoveDirection | undefined {
    if (x === 0 && y === 0) {
      this.release();
      return;
    }
    const same = x * this.x + y * this.y > 0;
    if (!navigationRepeatReady(time, this.previous, this.count, x, y, this.x, this.y)) return;
    const direction = moveDirection(x, y);
    if (!direction) {
      this.release();
      return;
    }
    if (!same) this.count = 0;
    this.count++;
    this.previous = time;
    this.x = x;
    this.y = y;
    return direction;
  }
}
