import { ParticleRandom, type NativeCurve } from './particle-math.ts';
import { sampleParticleCurve } from './particle-curve.ts';
export function particleSizeMultiplier(
  module: { curve: NativeCurve; y: NativeCurve; z: NativeCurve; separateAxes: boolean },
  age: number,
  seed: number,
  axis = 0,
): number {
  const curve = module.separateAxes ? [module.curve, module.y, module.z][axis] : module.curve;
  const random =
    curve.minMaxState === 2 || curve.minMaxState === 3
      ? new ParticleRandom(seed, 'size').value()
      : 0;
  return Math.max(0, sampleParticleCurve(curve, age, random));
}
