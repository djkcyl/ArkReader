/** Ordinary numerical operations for particle sizes, lifetime and direction. */
export function particleNormalizeInverse(squared: number): number {
  return squared > 1e-30 && Number.isFinite(squared) ? 1 / Math.sqrt(squared) : 0;
}
export function particleLifetimeInverse(life: number): number {
  return life > 0 && Number.isFinite(life) ? 1 / life : 0;
}
