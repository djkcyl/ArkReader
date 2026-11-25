export function particleTrailLifetime(
  sample: number,
  inverseLifetime: number,
  size: number[],
  size3d: boolean,
  affectsSize: boolean,
): number {
  return (affectsSize ? sample * (size3d ? Math.max(...size) : size[0]) : sample) / inverseLifetime;
}

const length = (v: number[]) => Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));
const normalize = (v: number[]) => {
  const n = length(v);
  return n > 0 ? v.map((x) => x / n) : v.map(() => 0);
};
const clamp = (n: number, lo: number, hi: number) =>
  Number.isNaN(n) ? lo : Math.min(hi, Math.max(lo, n));
function miter(a: number[], b: number[], ratio: number) {
  const slopeA = clamp(a[0] / -a[1], -100000, 100000),
    slopeB = clamp(-b[0] / b[1], -100000, 100000);
  let result = [...a];
  if (Math.abs(slopeA - slopeB) >= 1e-5) {
    const interceptA = a[1] - slopeA * a[0],
      interceptB = b[1] - slopeB * b[0];
    const x = (interceptB - interceptA) / (slopeA - slopeB),
      y = slopeA * x + interceptA;
    const difference = a.map((v, i) => v - b[i]),
      sum = a.map((v, i) => v + b[i]);
    const weight = Math.min(
      1,
      difference.reduce((s, v) => s + v * v, 0) * 50,
      sum.reduce((s, v) => s + v * v, 0) * 50,
    );
    result = [x, y].map((v, i) => a[i] + (v - a[i]) * weight);
  }
  const limit = Math.max(1, 3 * clamp(ratio, 0, 1));
  return length(result) > limit ? normalize(result).map((v) => v * limit) : result;
}
export interface TrailVertex {
  position: number[];
  uv: number[];
  progress: number;
}
export function multiplyTrailColor(a: number[], b: number[]): number[] {
  return a.map((v, i) => v * b[i]);
}
export interface TrailPoint {
  position: number[];
  time: number;
}
/** Transform stored trail points from simulation space to world space. */
export function particleTrailPosition(
  position: number[],
  matrix: number[],
  toWorld: boolean,
): number[] {
  const p = position,
    m = matrix;
  return toWorld
    ? [0, 1, 2].map((i) => m[i + 12] + m[i + 8] * p[2] + (m[i + 4] * p[1] + m[i] * p[0]))
    : p.slice();
}
/** Managed TrailContext expires every old sample (no predecessor/interpolation)
 * and only records a point when the UI bake runs, after particle simulation. */
export function updateUITrail(
  points: TrailPoint[],
  position: number[],
  time: number,
  lifetime: number,
  minDistance: number,
) {
  while (points.length && points[0].time + lifetime <= time) points.shift();
  const previous = points.at(-1),
    distance = previous
      ? position.reduce((sum, v, i) => {
          const d = v - previous.position[i];
          return sum + d * d;
        }, 0)
      : Infinity;
  if (!previous || distance > minDistance * minDistance)
    points.push({ position: position.slice(), time: time });
}
/** TrailModule keeps a dead particle until all its stored trail points expire. */
export function expireTrailPoints(points: TrailPoint[], time: number, lifetime: number): void {
  while (points.length && time > lifetime + points[Math.min(1, points.length - 1)].time)
    points.shift();
}
/** Native trail retention keeps the point immediately before the expiry edge
 * for interpolation. The spacing comparison is strictly greater-than. */
export function updateTrail(
  points: TrailPoint[],
  position: number[],
  time: number,
  lifetime: number,
  minDistance: number,
  percent = 0,
) {
  expireTrailPoints(points, time, lifetime);
  if (percent >= 100) return;
  const previous = points.at(-1),
    distance = previous
      ? position.reduce((s, v, i) => {
          const d = v - previous.position[i];
          return s + d * d;
        }, 0)
      : Infinity;
  if (!previous || distance > minDistance * minDistance)
    points.push({ position: position.slice(), time: time });
}
export function trailPositions(
  points: TrailPoint[],
  head: number[],
  time: number,
  lifetime: number,
): number[][] {
  if (!points.length) return [];
  const result = [head.slice(), ...points.map((p) => p.position.slice()).reverse()];
  if (result.length > 2) {
    const oldest = points[0],
      next = points[1],
      t = clamp((time - lifetime - oldest.time) / (next.time - oldest.time), 0, 1);
    result[result.length - 1] = oldest.position.map((v, i) => v + (next.position[i] - v) * t);
  }
  return result;
}
/** StoreLineData + BuildLineSegment<0>, open camera-facing strips, no caps or
 * rounded corners. Input is camera/view space, newest point first. */
export function buildTrailPairs(
  input: number[][],
  baseWidth: number,
  widthAt: (progress: number, index: number) => number,
  textureMode: number | boolean = 0,
  ui = false,
): TrailVertex[] {
  if (input.length < 2) return [];
  const points = input.map((p) => p.slice()),
    distances: number[] = [],
    ratios: number[] = [],
    normals: number[][] = [];
  let previous: number[] | null = null,
    total = 0;
  for (let i = 0; i < points.length; i++) {
    const at = Math.max(1, i);
    let direction = points[at - 1].map((v, j) => v - points[at][j]);
    const distance = length(direction);
    distances.push(i === 0 ? 0 : distance);
    total = total + (i === 0 ? 0 : distance);
    ratios.push(
      ui ? length(direction.slice(0, 2)) * (1 / (baseWidth * 2)) : distance / (baseWidth * 2),
    );
    const threshold = points.length <= 2 ? 1e-30 : 1e-5;
    if (direction.reduce((s, v) => s + v * v, 0) < threshold) {
      if (at < points.length - 1) direction = points[at].map((v, j) => v - points[at + 1][j]);
      if (direction.reduce((s, v) => s + v * v, 0) < threshold) direction = previous ?? [1, 0, 0];
    } else previous = direction;
    const point = points[i].map(
      (v) => (v < 0 || Object.is(v, -0) ? -1 : 1) * Math.max(Math.abs(v), 0.01),
    );
    normals.push(
      normalize([
        direction[2] * point[1] - direction[1] * point[2],
        direction[0] * point[2] - direction[2] * point[0],
      ]),
    );
    if (distance < baseWidth * 2 && i > 0) {
      const a = normals[i - 1],
        b = normals[i],
        average = a.map((v, j) => (v + b[j]) * 0.5),
        weight = Math.max(ratios[i] - 0.5, 0) * 2;
      for (const [index, v] of [
        [i - 1, a],
        [i, b],
      ] as const) {
        const n = average.map((x, j) => x + (v[j] - x) * weight);
        if (n.reduce((s, x) => s + x * x, 0) > 1e-10) normals[index] = normalize(n);
      }
    }
  }
  // ParticleSystemTrailGeometryJob::RenderJobCommon (0xECCD30) uses the
  // same normalized coordinate for width and color; only U is then scaled.
  const mode = Number(textureMode),
    segments = points.length - 1;
  total = Math.max(total, 1e-6);
  let distance = 0;
  const result: TrailVertex[] = [];
  for (let i = 0; i < points.length; i++) {
    distance = distance + distances[i];
    const progress = mode === 2 || mode === 3 ? i * (1 / segments) : distance / total,
      width = widthAt(progress, i) * 0.5;
    const inside = i > 0 && i < points.length - 1;
    const normal = inside
      ? miter(
          normals[i].map((v) => -v),
          normals[i + 1].map((v) => -v),
          ratios[i - 1],
        )
      : normals[Math.min(i + 1, points.length - 1)].map((v) => -v);
    for (const side of [1, -1])
      result.push({
        position: [
          points[i][0] + normal[0] * width * side * (ui ? -1 : 1),
          points[i][1] + normal[1] * width * side * (ui ? -1 : 1),
          points[i][2],
        ],
        progress,
        uv: [
          mode === 1 ? progress * total : mode === 3 ? progress * segments : progress,
          side === 1 ? 1 : 0,
        ],
      });
  }
  return result;
}
