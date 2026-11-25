import { ParticleRandom, type NativeCurve } from './particle-math.ts';
import { sampleParticleCurve } from './particle-curve.ts';
import { particleLifetimeInverse } from './particle-numeric.ts';
const fraction = (v: number) => v - Math.floor(v);
export interface ParticleUVModule {
  mode: number;
  timeMode: number;
  animationType: number;
  rowMode: number;
  rowIndex: number;
  tilesX: number;
  tilesY: number;
  cycles: number;
  frameOverTime: NativeCurve;
  startFrame: NativeCurve;
}
/** UVModule.Update's lifetime grid path. Three independent particle-seed streams
 * choose start, frame and row; the start curve already contains a normalized
 * frame fraction. Cycles wrap the curve input, not the evaluated curve value.
 */
export function particleUVFrame(
  module: ParticleUVModule,
  percent: number,
  seed: number,
  meshCount = 0,
): number {
  const start = sampleParticleCurve(
    module.startFrame,
    0,
    new ParticleRandom(seed, 'uv-start').value(),
  );
  const phase = fraction(Math.max(0, percent * 0.01) * module.cycles);
  let frame = sampleParticleCurve(
    module.frameOverTime,
    phase,
    new ParticleRandom(seed, 'uv-frame').value(),
  );
  // The native constant/constant whole-sheet fast path includes cycle scale.
  if (
    module.animationType === 0 &&
    module.frameOverTime.minMaxState === 0 &&
    module.startFrame.minMaxState === 0
  )
    frame = frame * module.cycles;
  frame = fraction(frame + start);
  if (module.animationType === 0) return frame;
  const width = (1 / (module.tilesX * module.tilesY)) * module.tilesX;
  let row: number;
  if (module.rowMode === 1)
    row = Math.min(
      Math.floor(new ParticleRandom(seed, 'uv-row').value() * module.tilesY),
      module.tilesY - 1,
    );
  else if (module.rowMode === 0) {
    const selected = Math.max(0, Math.min(module.rowIndex, module.tilesY - 1));
    row = Math.floor(selected * width * module.tilesY);
  } else {
    // Mesh row mode uses the same deterministic mesh index as geometry routing.
    const index = meshCount > 0 ? new ParticleRandom(seed, 'mesh').uint() % meshCount : 0;
    row = Math.floor(
      index * (meshCount > 0 ? particleLifetimeInverse(meshCount) : 1) * module.tilesY,
    );
  }
  const offset = row * width,
    span = offset + width - offset;
  return frame * span + offset;
}
