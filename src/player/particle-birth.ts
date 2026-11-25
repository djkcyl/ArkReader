import { ParticleRandom, type NativeCurve } from './particle-math.ts';
import { sampleParticleCurve } from './particle-curve.ts';
import { sampleParticleGradient } from './particle-color.ts';
import { particleLifetimeInverse } from './particle-numeric.ts';
export interface ParticleBirthInitial {
  seed: number;
  life: number;
  inverseLife: number;
  size: number[];
  rotation: number[];
  color: number[];
}
export interface ParticleEmitReplay {
  phase: number;
  age: number;
  offset: number;
  spacing: number;
  count: number;
  continuous: number;
}
export interface ParticleProceduralBirth extends ParticleBirthInitial {
  percent: number;
  elapsed: number;
}
export function particleBirthColor(raw: any, phase: number, random: number): number[] {
  const rgba = (v: any) => [v.r, v.g, v.b, v.a].slice(),
    mode = raw.minMaxState;
  let tint: number[];
  if (mode === 0) tint = rgba(raw.maxColor);
  else if (mode === 2) {
    const low = rgba(raw.minColor),
      high = rgba(raw.maxColor);
    tint = low.map((v, i) => v + (high[i] - v) * random);
  } else if (mode === 4) tint = sampleParticleGradient(raw.maxGradient, random);
  else {
    tint = sampleParticleGradient(raw.maxGradient, phase);
    if (mode === 3) {
      const low = sampleParticleGradient(raw.minGradient, phase);
      tint = low.map((v, i) => v + (tint[i] - v) * random);
    }
  }
  return tint;
}
export function particleBirthSpeed(curve: NativeCurve, phase: number, seed: number): number {
  return sampleParticleCurve(curve, phase, new ParticleRandom(seed, 'birth-speed').value());
}
/** Seeded properties with a single stream; batch size does not change results. */
export class ParticleBirthRandom {
  private random: ParticleRandom;
  constructor(seed: number) {
    this.random = new ParticleRandom(seed);
  }
  private create(phase: number, raw: any): ParticleBirthInitial {
    const random = () => this.random.value(),
      seed = this.random.uint();
    const life = Math.max(0.00001, sampleParticleCurve(raw.startLifetime, phase, random()));
    const x = sampleParticleCurve(raw.startSize, phase, random());
    const size = [
      x,
      raw.size3D ? sampleParticleCurve(raw.startSizeY, phase, random()) : x,
      raw.size3D ? sampleParticleCurve(raw.startSizeZ, phase, random()) : x,
    ].map((v) => Math.max(0, v));
    const sign = random() < raw.randomizeRotationDirection ? -1 : 1;
    const z = sampleParticleCurve(raw.startRotation, phase, random());
    const rotation = [
      raw.rotation3D ? sampleParticleCurve(raw.startRotationX, phase, random()) : 0,
      raw.rotation3D ? sampleParticleCurve(raw.startRotationY, phase, random()) : 0,
      z,
    ].map((v) => sign * v);
    return {
      seed,
      life,
      inverseLife: particleLifetimeInverse(life),
      size,
      rotation,
      color: particleBirthColor(raw.startColor, phase, random()),
    };
  }
  take(count: number, phase: number, raw: any): ParticleBirthInitial[] {
    return Array.from({ length: Math.max(0, Math.floor(count)) }, () => this.create(phase, raw));
  }
  replay(record: ParticleEmitReplay, duration: number, raw: any): ParticleProceduralBirth[] {
    const result: ParticleProceduralBirth[] = [],
      phase = duration > 0 ? record.phase / duration : 0;
    for (let i = 0; i < record.count; i++) {
      const particle = this.create(phase, raw);
      const age = Math.max(
        0,
        record.age +
          (record.offset + i < record.continuous ? (record.offset + i) * record.spacing : 0),
      );
      if (age > particle.life) continue;
      result.push({ ...particle, percent: age * particle.inverseLife * 100, elapsed: age });
    }
    return result;
  }
}
