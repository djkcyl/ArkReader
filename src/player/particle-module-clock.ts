import { ParticleRandom, type NativeCurve } from './particle-math.ts';
import { sampleParticleCurve } from './particle-curve.ts';
/** Native gravity transforms use column-major world-to-local matrices. */
function transform(v: number[], matrix?: number[]): number[] {
  if (!matrix) return v;
  return [0, 1, 2].map((i) => matrix[4 + i] * v[1] + matrix[8 + i] * v[2] + matrix[i] * v[0]);
}
export function advanceParticleGravity(
  initial: number[],
  curve: NativeCurve,
  phase: number,
  duration: number,
  seed: number,
  dt: number,
  matrix?: number[],
  gravity = [0, -9.81, 0],
): number[] {
  const random = curve.minMaxState >= 2 ? new ParticleRandom(seed, 'gravity').value() : 1;
  const modifier = sampleParticleCurve(curve, phase / duration, random);
  const delta = transform(gravity, matrix).map((v) => v * dt * modifier);
  return initial.map((v, i) => v + delta[i]);
}
export function advanceNoiseScroll(
  scroll: number,
  curve: NativeCurve,
  phase: number,
  duration: number,
  dt: number,
  update = true,
): number {
  if (!update) return scroll;
  const speed = sampleParticleCurve(curve, phase / duration, 1);
  return scroll + speed * dt;
}
