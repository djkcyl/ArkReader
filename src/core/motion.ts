import { nativeEaseAt } from './easing';
export type Point = { x: number; y: number };
export type Ease = 'linear' | 'outQuad' | 'outCubic' | 'smoothStep' | number;
export function easeAt(ease: Ease, t: number): number {
  if (typeof ease === 'number') return nativeEaseAt(ease, t);
  return ease === 'smoothStep'
    ? t * t * (3 - 2 * t)
    : ease === 'outCubic'
      ? 1 - (1 - t) ** 3
      : ease === 'outQuad'
        ? 1 - (1 - t) ** 2
        : t;
}

/** Independently implemented from the Windows shake executor's segment rules.
 * RNG is injectable; Unity's process-wide random state is not reproducible here.
 */
export function shakePath(
  duration: number,
  x: number,
  y: number,
  vibrato: number,
  randomness: number,
  fade: boolean,
  random = Math.random,
  scalar = false,
) {
  const count = Math.max(2, Math.trunc(vibrato * duration));
  const magnitude = scalar ? x : Math.hypot(x, y),
    points: Point[] = [{ x: 0, y: 0 }],
    ends: number[] = [];
  let angle = random() * 360,
    elapsed = 0;
  for (let i = 0; i < count; i++) {
    elapsed += duration * (fade ? (2 * (i + 1)) / (count * (count + 1)) : 1 / count);
    ends.push(elapsed);
    if (i === count - 1) {
      points.push({ x: 0, y: 0 });
      break;
    }
    if (i) angle = angle - 180 + (random() * 2 - 1) * randomness;
    const yaw = ((random() * 2 - 1) * randomness * Math.PI) / 180,
      a = (angle * Math.PI) / 180;
    const length = fade ? magnitude * (1 - i / count) : magnitude;
    const strengthScale = magnitude ? Math.min(1, length / magnitude) : 0;
    let px = Math.cos(a) * Math.cos(yaw) * length,
      py = Math.sin(a) * length;
    const pz = -Math.cos(a) * Math.sin(yaw) * length;
    if (!scalar) {
      // Component limits are applied in sequence: Y uses the vector after X
      // was changed. Z strength is zero in the camera executor.
      const clamp = (limit: number) => Math.min(1, limit / (Math.hypot(px, py, pz) || 1));
      px *= clamp(Math.abs(x) * strengthScale);
      py *= clamp(Math.abs(y) * strengthScale);
      const scale = length / (Math.hypot(px, py) || 1);
      px *= scale;
      py *= scale;
    }
    points.push({ x: px, y: py });
  }
  return { points, ends, duration };
}
/** A local jump: the containing sequence is OutCubic; the vertical yoyo and
 * destination-height correction are independently OutQuad. */
export function jumpAt(t: number, times: number, power: number, dx: number, dy: number): Point {
  const progress = easeAt('outCubic', t),
    phase = progress * Math.max(1, Math.trunc(times)) * 2;
  const half = Math.floor(phase),
    fraction = phase - half;
  const rise = half % 2 ? 1 - fraction : fraction;
  return {
    x: dx * progress,
    y: power * easeAt('outQuad', rise) + dy * easeAt('outQuad', progress),
  };
}
export function sampleShake(path: ReturnType<typeof shakePath>, elapsed: number): Point {
  if (elapsed >= path.duration) return { x: 0, y: 0 };
  const i = path.ends.findIndex((end) => end > Math.max(0, elapsed));
  const start = i ? path.ends[i - 1] : 0,
    t = (Math.max(0, elapsed) - start) / (path.ends[i] - start);
  return {
    x: path.points[i].x + (path.points[i + 1].x - path.points[i].x) * t,
    y: path.points[i].y + (path.points[i + 1].y - path.points[i].y) * t,
  };
}
