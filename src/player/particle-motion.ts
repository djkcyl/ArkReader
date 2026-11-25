import { ParticleRandom, type NativeCurve } from './particle-math.ts';
import { sampleParticleCurve } from './particle-curve.ts';
import { rotationOverLifetime } from './particle-properties.ts';
interface VectorModule {
  x: NativeCurve;
  y: NativeCurve;
  z: NativeCurve;
}
/** Each module owns a seeded XYZ sequence; these are not birth RNG slots. */
export function particleVector(
  module: VectorModule,
  age: number,
  seed: number,
  kind: 'force' | 'velocity',
): number[] {
  const curves = [module.x, module.y, module.z];
  // Native vector jobs choose one optimization branch for the complete triple.
  if (curves.every((curve) => curve.minMaxState === 0)) return curves.map((curve) => curve.scalar);
  const random = new ParticleRandom(seed, kind);
  return curves.map((curve) => sampleParticleCurve(curve, age, random.value()));
}
export function particleSpeed(curve: NativeCurve, age: number, seed: number): number {
  if (curve.minMaxState === 0) return curve.scalar;
  return sampleParticleCurve(curve, age, new ParticleRandom(seed, 'speed').value());
}
export function advanceParticleForce(velocity: number[], force: number[], dt: number): number[] {
  return velocity.map((value, i) => value + force[i] * dt);
}
export function particleRotation(
  module: {
    x: NativeCurve;
    y: NativeCurve;
    curve: NativeCurve;
    separateAxes: boolean;
  },
  age: number,
  life: number,
  seed: number,
  direction: number,
): number[] {
  if (module.separateAxes)
    return rotationOverLifetime([module.x, module.y, module.curve], age, life, seed, direction);
  return [0, 0, rotationOverLifetime([module.curve], age, life, seed, direction)[0]];
}
