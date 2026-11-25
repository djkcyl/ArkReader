import { ParticleRandom } from './particle-math.ts';
export { nativeColorByte as particleColorByte } from '../core/color32.ts';

/** Authored RGB and alpha keys have separate timelines in the resource. */
export function sampleParticleGradient(g: any, time: number): number[] {
  const t = time * 65535,
    result = [1, 1, 1, 1];
  for (const [prefix, count, channels] of [
    ['ctime', g.m_NumColorKeys, [0, 1, 2]],
    ['atime', g.m_NumAlphaKeys, [3]],
  ] as const) {
    if (!count) continue;
    const at = Math.max(g[prefix + '0'], Math.min(g[prefix + (count - 1)], t));
    let i = 0;
    while (i < count - 1 && g[prefix + i] < at) i++;
    for (const channel of channels) {
      const key = 'rgba'[channel],
        hi = g['key' + i][key];
      if (i === 0 || g.m_Mode === 1) result[channel] = hi;
      else {
        const lo = g['key' + (i - 1)][key],
          span = g[prefix + i] - g[prefix + (i - 1)];
        result[channel] = lo + (hi - lo) * (span > 0 ? (at - g[prefix + (i - 1)]) / span : 1);
      }
    }
  }
  return result;
}

/** Keep colors continuous until the rendering boundary, in both scene and UI effects. */
export function particleLifetimeColor(
  raw: any,
  age: number,
  seed: number,
  color: number[],
): number[] {
  const mode = raw.minMaxState,
    random = particleColorRandom(seed);
  const rgba = (v: any) => [v.r, v.g, v.b, v.a];
  let tint: number[];
  if (mode === 0) tint = rgba(raw.maxColor);
  else if (mode === 4) tint = sampleParticleGradient(raw.maxGradient, random);
  else {
    tint = mode === 2 ? rgba(raw.maxColor) : sampleParticleGradient(raw.maxGradient, age);
    if (mode === 2 || mode === 3) {
      const lo = mode === 2 ? rgba(raw.minColor) : sampleParticleGradient(raw.minGradient, age);
      tint = lo.map((v, i) => v + (tint[i] - v) * random);
    }
  }
  return color.map((v, i) => v * tint[i]);
}
export const particleColorRandom = (seed: number) => new ParticleRandom(seed, 'color').value();
