import { ParticleRandom } from './particle-math.ts';

/** Authored seeds stay fixed; automatic seeds vary between activations. */
export class ParticleSeedSource {
  private readonly random: ParticleRandom;
  constructor(seed: number) {
    this.random = new ParticleRandom(seed);
  }
  next(main: { autoRandomSeed: boolean; randomSeed: number }): number {
    return main.autoRandomSeed ? this.random.uint() : main.randomSeed >>> 0;
  }
}

let shared: ParticleSeedSource | undefined;
export function sharedParticleSeeds(): ParticleSeedSource {
  return (shared ??= new ParticleSeedSource(crypto.getRandomValues(new Uint32Array(1))[0]));
}
