import {
  ParticleRandom,
  curlNoise,
  lowCurlNoise,
  mediumCurlNoise,
  noiseAngleDelta,
  noiseSizeFactor,
} from './particle-math.ts';
import { sampleParticleCurve } from './particle-curve.ts';
import { particleLifetimeInverse } from './particle-numeric.ts';
export interface ParticleNoiseInput {
  module: Record<string, any>;
  percent: number;
  seed: number;
  position: number[];
  offset: number[];
  scroll: number;
  dt: number;
  animated: number[];
  rotation: number[];
  size: number[];
  rotation3D?: boolean;
  size3D?: boolean;
}
/** Noise contributions to motion, rotation and size. */
export function particleNoise(c: ParticleNoiseInput) {
  const m = c.module,
    age = Math.max(0, c.percent * 0.01),
    frequency = Math.max(0.000001, m.frequency);
  const rng = new ParticleRandom(c.seed, 'noise-strength'),
    random = [rng.value(), rng.value(), rng.value()];
  const sample = (key: string, value: number) => sampleParticleCurve(m[key], age, value);
  const curl =
    m.quality === 0
      ? lowCurlNoise(c.position, frequency, c.scroll, c.offset)
      : m.quality === 1
        ? mediumCurlNoise(c.position, frequency, c.scroll, c.offset)
        : curlNoise(
            c.position,
            frequency,
            c.scroll,
            c.offset,
            m.octaves,
            m.octaveScale,
            m.octaveMultiplier,
          );
  const inverse = m.damping ? particleLifetimeInverse(frequency) : 1;
  const field = curl.map(
    (x, i) =>
      x *
      sample(
        m.separateAxes ? ['strength', 'strengthY', 'strengthZ'][i] : 'strength',
        random[m.separateAxes ? i : 0],
      ) *
      inverse,
  );
  const amount = sample('positionAmount', new ParticleRandom(c.seed, 'noise-position').value());
  const animated = c.animated.map((x, i) => x + field[i] * amount);
  const rotation = c.rotation.slice();
  if (m.rotationAmount.scalar) {
    const amount = sample('rotationAmount', new ParticleRandom(c.seed, 'noise-rotation').value());
    for (let i = c.rotation3D ? 0 : 2; i < 3; i++)
      rotation[i] = rotation[i] + noiseAngleDelta(field[i], amount, c.dt);
  }
  const size = c.size.slice(),
    sizeFactors = [1, 1, 1];
  if (m.sizeAmount.scalar) {
    const amount = sample('sizeAmount', new ParticleRandom(c.seed, 'noise-size').value());
    for (let i = 0; i < (c.size3D ? 3 : 1); i++) {
      sizeFactors[i] = noiseSizeFactor(field[i], amount);
      size[i] = size[i] * sizeFactors[i];
    }
  }
  return { animated, rotation, size, field, sizeFactors };
}
