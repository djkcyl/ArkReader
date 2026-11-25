import { ParticleRandom, integrateCurve, type NativeCurve } from './particle-math.ts';
/** All three RotationModule axes share the same seeded sample, unlike the
 * orbital module's consecutive XYZ stream (UnityPlayer 0xAFC1E0). */
export function rotationOverLifetime(
  curves: NativeCurve[],
  age: number,
  life: number,
  seed: number,
  direction: number,
): number[] {
  const random = new ParticleRandom(seed, 'rotation').value();
  const sign = new ParticleRandom(seed, 'rotation-direction').value() > direction ? 1 : -1;
  return curves.map((curve) => integrateCurve(curve, age, random) * life * sign);
}
/** Particle module animation setters use the module's native validation,
 * not the managed MainModule API's normalized color/size aliases. */
export function particlePropertyValue(path: string, value: number): number | boolean {
  if (path === 'looping') return value > 0.001 || value < -0.001;
  const clamp = (lo: number, hi: number) => Math.max(lo, Math.min(hi, value));
  if (/^InitialModule\.startSize(?:Y|Z)?\./.test(path)) return clamp(0, 100000);
  if (path.startsWith('InitialModule.startLifetime.')) return clamp(0.0001, Infinity);
  if (path.startsWith('InitialModule.startSpeed.') || path.startsWith('NoiseModule.strength.'))
    return clamp(-100000, 100000);
  if (/^EmissionModule\.rateOver(?:Distance|Time)\./.test(path)) return clamp(0, 10000000);
  if (path === 'simulationSpeed') return clamp(0, 100);
  if (path === 'ShapeModule.radius.value') return clamp(0.0001, Infinity);
  return value;
}
/** Original ParticleSystemState::Tick (0xAED130) and Update1Incremental's
 * emission stop latch. Toggling loop off completes the current cycle; toggling
 * it back on does not Play/restart an already stopped particle system. */
export class ParticleLoopClock {
  phase = 0;
  cycles = 0;
  stopped = false;
  tick(dt: number, duration: number, looping: boolean): void {
    this.phase = this.phase + dt;
    if (looping) {
      while (this.phase >= duration) {
        this.phase = this.phase - duration;
        this.cycles++;
      }
    } else {
      this.phase = Math.min(this.phase, duration);
      if (this.phase >= duration) this.stopped = true;
    }
  }
}
