import {
  ParticleRandom,
  limitParticleVelocity,
  applyParticleDrag,
  type NativeCurve,
} from './particle-math.ts';
import { sampleParticleCurve } from './particle-curve.ts';
export interface ParticleLimitModule {
  magnitude: NativeCurve;
  drag: NativeCurve;
  dampen: number;
  separateAxis: boolean;
  multiplyDragByParticleSize: boolean;
  multiplyDragByParticleVelocity: boolean;
}
/** Story profiles use magnitude limits; each module has its own seeded stream. */
export function limitParticleMotion(
  module: ParticleLimitModule,
  percent: number,
  seed: number,
  base: number[],
  animated: number[],
  size: number[],
  dt: number,
): number[] {
  const age = Math.max(0, percent * 0.01);
  base = base.slice();
  animated = animated.slice();
  size = size.slice();
  let velocity = limitParticleVelocity(
    base,
    animated,
    sampleParticleCurve(module.magnitude, age, new ParticleRandom(seed, 'speed-limit').value()),
    module.dampen,
    dt,
  );
  if (module.drag.scalar !== 0) {
    const drag = sampleParticleCurve(module.drag, age, new ParticleRandom(seed, 'drag').value());
    velocity = applyParticleDrag(
      velocity,
      animated,
      drag,
      Math.max(...size),
      module.multiplyDragByParticleSize,
      module.multiplyDragByParticleVelocity,
      dt,
    );
  }
  return velocity;
}
