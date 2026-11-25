import { particleNormalizeInverse } from './particle-numeric.ts';
export interface OrdinaryParticleBoundsInput {
  positions: number[][];
  velocity?: number[][];
  animated?: number[][];
  particleSizeY?: number[];
  space: number;
  matrix: number[];
  scale: number[];
  renderMode: number;
  pivot: number[];
  startSize: number[];
  size?: number[];
  sizeBySpeed?: number[];
  size3D: boolean;
  meshBounds?: number[];
  maxSize?: number;
  lengthScale: number;
  velocityScale: number;
  trail?: {
    mode: number;
    worldSpace: boolean;
    oldest: (number[] | null)[];
    inverse: number[];
  };
}
/** Ordinary ParticleSystem::UpdateBounds, including retained particle trails.
 * The stored bound encloses the configured size range, not just live quads. */
export function ordinaryParticleBounds(c: OrdinaryParticleBoundsInput): number[] {
  if (!c.positions.length) {
    const p = c.space === 1 ? c.matrix.slice(12, 15) : [0, 0, 0],
      epsilon = 0.00001;
    return [...p.map((x) => x - epsilon), ...p.map((x) => x + epsilon)];
  }
  const lo = [Infinity, Infinity, Infinity],
    hi = [-Infinity, -Infinity, -Infinity];
  const include = (p: number[]) => {
    for (let i = 0; i < 3; i++) {
      lo[i] = Math.min(lo[i], p[i]);
      hi[i] = Math.max(hi[i], p[i]);
    }
  };
  c.positions.forEach((p) => include(p.slice()));
  if (c.trail?.mode === 0)
    for (const point of c.trail.oldest.slice(0, c.positions.length)) {
      if (!point) continue;
      const p = point.slice(),
        m = c.trail.inverse.slice();
      // Native bounds include the oldest retained point, not every intermediate
      // point or the interpolated visible tail. World trails need inverse TRS.
      include(
        c.trail.worldSpace && c.space !== 1
          ? [0, 1, 2].map((i) => m[i] * p[0] + (m[i + 4] * p[1] + m[i + 8] * p[2]) + m[i + 12])
          : p,
      );
    }
  if (c.renderMode === 1)
    for (let j = 0; j < c.positions.length; j++) {
      const p = c.positions[j],
        v = [0, 1, 2].map((i) => (c.velocity?.[j]?.[i] ?? 0) + (c.animated?.[j]?.[i] ?? 0));
      const squared = v[1] * v[1] + v[2] * v[2] + v[0] * v[0];
      const length =
        particleNormalizeInverse(squared) * c.lengthScale * (c.particleSizeY?.[j] ?? 1) +
        c.velocityScale;
      include(p.map((x, i) => x - v[i] * length));
    }
  return expandParticleBounds([...lo, ...hi], c);
}
/** Shared size/pivot padding after ordinary or procedural movement bounds. */
export function expandParticleBounds(bounds: number[], c: OrdinaryParticleBoundsInput): number[] {
  const lo = bounds.slice(0, 3),
    hi = bounds.slice(3, 6);
  let dimensions = [1, 1, 1],
    largest = 0;
  if (c.meshBounds && c.meshBounds.slice(0, 3).every((x, i) => x <= c.meshBounds![i + 3])) {
    dimensions = [0, 1, 2].map((i) => {
      const a = Math.max(Math.abs(c.meshBounds![i]), Math.abs(c.meshBounds![i + 3]));
      return a + a;
    });
    if (!c.size3D) dimensions[0] = Math.max(...dimensions);
  }
  for (let i = 0; i < (c.size3D ? 3 : 1); i++) {
    let size = c.startSize[i];
    if (c.size) size = size * c.size[i];
    if (c.sizeBySpeed) size = size * c.sizeBySpeed[i];
    if (c.renderMode === 4) size = size * dimensions[i];
    largest = Math.max(largest, size);
  }
  largest = Math.max(c.maxSize ?? 0, largest);
  const pivot = Math.max(...c.pivot.map((x) => Math.abs(x))) * largest;
  for (let i = 0; i < 3; i++) {
    lo[i] = lo[i] - pivot;
    hi[i] = hi[i] + pivot;
  }
  let radius = largest * 0.71;
  if (c.space === 1 || c.space === 2)
    radius = radius * Math.max(...c.scale.map((x) => Math.abs(x)));
  return [...lo.map((x) => x - radius), ...hi.map((x) => x + radius)];
}
/** Convert conservative bounds through signed and sheared world transforms. */
export function particleWorldBounds(
  bounds: number[],
  matrix: number[],
  space: number,
): {
  center: number[];
  extent: number[];
} {
  let center = [0, 1, 2].map((i) => (bounds[i] + bounds[i + 3]) * 0.5),
    extent = [0, 1, 2].map((i) => (bounds[i + 3] - bounds[i]) * 0.5);
  if (space !== 1) {
    const m = matrix.slice(),
      c = center,
      e = extent;
    extent = [0, 1, 2].map(
      (i) => Math.abs(m[i] * e[0]) + Math.abs(m[i + 4] * e[1]) + Math.abs(m[i + 8] * e[2]),
    );
    center = [0, 1, 2].map((i) => c[0] * m[i] + c[1] * m[i + 4] + c[2] * m[i + 8] + m[i + 12]);
  }
  return { center, extent };
}
