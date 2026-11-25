import { ParticleRandom, type NativeCurve } from './particle-math.ts';
import { sampleParticleCurve } from './particle-curve.ts';
import { sampleParticleGradient } from './particle-color.ts';
export interface ParticleCustomModule {
  enabled: boolean;
  [key: string]: any;
}
function customColor(raw: any, age: number, seed: number): number[] {
  const rgba = (c: any) => ['r', 'g', 'b', 'a'].map((k) => c[k]),
    mode = raw.minMaxState;
  if (mode === 0) return rgba(raw.maxColor);
  if (mode === 1) return sampleParticleGradient(raw.maxGradient, age);
  const random = new ParticleRandom(seed).value();
  if (mode === 4) return sampleParticleGradient(raw.maxGradient, random);
  const lo = mode === 2 ? rgba(raw.minColor) : sampleParticleGradient(raw.minGradient, age);
  const hi = mode === 2 ? rgba(raw.maxColor) : sampleParticleGradient(raw.maxGradient, age);
  return lo.map((value, i) => value + (hi[i] - value) * random);
}
/** CustomDataModule has eight independent vector streams and two HDR color
 * streams. Values stay float; lifetime ColorModule's byte conversion is wrong here. */
export function particleCustomData(
  module: ParticleCustomModule,
  percent: number,
  seed: number,
): number[] {
  const result = Array(8).fill(0),
    age = Math.max(0, percent * 0.01);
  if (!module.enabled) return result;
  for (let channel = 0; channel < 2; channel++) {
    if (module['mode' + channel] === 2) {
      result.splice(
        channel * 4,
        4,
        ...customColor(
          module['color' + channel],
          age,
          new ParticleRandom(seed, 'custom-color-' + channel).uint(),
        ),
      );
      continue;
    }
    if (module['mode' + channel] !== 1) continue;
    for (let axis = 0; axis < module['vectorComponentCount' + channel]; axis++) {
      const c: NativeCurve = module['vector' + channel + '_' + axis];
      const random =
        c.minMaxState === 2 || c.minMaxState === 3
          ? new ParticleRandom(seed, 'custom-vector-' + channel + '-' + axis).value()
          : 0;
      result[channel * 4 + axis] = sampleParticleCurve(c, age, random);
    }
  }
  return result;
}
/** Admitted story layouts: Custom1.xyzw + Custom2.xy[zw]. The short layout's
 * missing lanes (or zero UV2 on the wind mesh) must not reach shader uniforms. */
export function particleCustomStreams(
  values: number[],
  renderer: {
    m_UseCustomVertexStreams?: boolean;
    m_VertexStreams?: number[];
  },
): number[] {
  if (renderer.m_UseCustomVertexStreams === false) return Array(8).fill(0);
  const result = values.slice();
  if (renderer.m_VertexStreams?.includes(36)) {
    result[6] = 0;
    result[7] = 0;
  }
  return result;
}
