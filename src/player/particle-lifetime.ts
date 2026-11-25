/** Lifetime progress is in percent; trails may retain expired particles. */
export function particleAge(percent: number): number {
  return percent * 0.01;
}
export function birthParticlePercent(inverseLife: number, delta: number): number {
  return delta * 100 * inverseLife;
}
export function advanceParticlePercent(
  percent: number,
  inverseLife: number,
  delta: number,
): number {
  return percent > 100 ? percent : percent + delta * 100 * inverseLife;
}
/** Remove expired particles in place, retaining survivor order. */
export function removeExpiredParticles<T>(particles: T[], expired: (particle: T) => boolean): void {
  removeExpiredBirths(particles, 0, expired);
}
/** Compact only the appended births, leaving existing particles untouched. */
export function removeExpiredBirths<T>(
  particles: T[],
  first: number,
  expired: (particle: T) => boolean,
): void {
  let write = first;
  for (let read = first; read < particles.length; read++)
    if (!expired(particles[read])) particles[write++] = particles[read];
  particles.length = write;
}
