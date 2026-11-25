import type { ParticleMaterial } from './particles';

/** Original GrabPass vertex stage, before the object's linear projection.
 * Modes 1/2 are calculated at vertices and interpolated, not normalized again
 * per pixel. Modes 3/4 are UV-space directions calculated by the fragment stage.
 */
export function grabObjectDirection(position: number[], material: ParticleMaterial): number[] {
  const mode = material.floats._DirMode ?? 0;
  if (mode === 1) return (material.colors._DisturbDir ?? [0, 0, 0]).slice(0, 3);
  if (mode !== 2) return [0, 0, 0];
  const center = material.colors._DisturbCenter ?? [0, 0, 0],
    system = material.colors._ParticleSystemPositionWS ?? [0, 0, 0];
  const delta = position.map((v, i) => v - center[i] - system[i]);
  const length = Math.hypot(...delta);
  return delta.map((v) => v / length);
}
