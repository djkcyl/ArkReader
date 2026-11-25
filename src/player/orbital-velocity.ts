import { sampleParticleCurve } from './particle-curve.ts';
import { ParticleRandom, cosineTurns, type NativeCurve } from './particle-math.ts';
import { particleNormalizeInverse } from './particle-numeric.ts';
import { particleLifetimeInverse } from './particle-numeric.ts';
/** UpdateOrbitalAndRadialTpl uses a dedicated stream, reset from
 * the particle seed every update. X/Y/Z consume consecutive draws. */
export function orbitalRates(curves: NativeCurve[], age: number, seed: number): number[] {
  const random = new ParticleRandom(seed, 'orbital');
  return curves.map((c) => sampleParticleCurve(c, age, random.value()));
}
/** Unity VelocityModule's finite rotation displacement, followed by radial speed. */
export function orbitalVelocity(
  position: number[],
  rates: number[],
  offset: number[],
  radial: number,
  dt: number,
  speed = 1,
): number[] {
  if (dt <= 1e-6) return [0, 0, 0];
  // UpdateOrbitalAndRadial (0xF7F2C0) advances the angle and radius by
  // dt * speed, then removes speed before the common integration applies it.
  const delta = dt * speed,
    turns = rates.map((v) => delta * v * (1 / (2 * Math.PI)));
  const [cx, cy, cz] = turns.map(cosineTurns),
    [sx, sy, sz] = turns.map((t) => cosineTurns(t + -0.25));
  const [x, y, z] = position.map((v, i) => v - offset[i]);
  const czcy = cz * cy;
  const rotated = [
    y * (sx * cz * sy - sz * cy) + z * sy * cx + (sy * sx * sz + czcy) * x,
    y * cx * cz + z * -sx + sz * cx * x,
    y * (sx * czcy + sy * sz) + z * cx * cy + (sy * -cz + sx * cy * sz) * x,
  ];
  // Normalize the rotated radius before applying radial speed.
  const inverse = particleNormalizeInverse(
    rotated[1] * rotated[1] + rotated[2] * rotated[2] + rotated[0] * rotated[0],
  );
  const distance = delta * radial,
    inverseDt = particleLifetimeInverse(dt),
    local = [x, y, z];
  return rotated.map((v, i) => {
    const displacement = v + distance * inverse * v - local[i];
    return Math.abs(speed) > 1e-9 ? (displacement / speed) * inverseDt : 0;
  });
}
