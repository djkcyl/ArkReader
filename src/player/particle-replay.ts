import type { ParticleEmitReplay } from './particle-birth.ts';
/** Original StartParticlesProcedural admits records against recorded births,
 * not the number alive at the end of prewarm. Preserve burst/rate ordering. */
export function appendParticleReplay(
  records: ParticleEmitReplay[],
  input: {
    phase: number;
    dt: number;
    offset: number;
    spacing: number;
    count: number;
    continuous: number;
    maximum: number;
    ring: number;
  },
): void {
  if (!input.count) return;
  const existing = records.reduce((sum, r) => sum + r.count, 0),
    available =
      (input.ring ? existing + input.count : Math.min(existing + input.count, input.maximum)) -
      existing;
  if (available <= 0) return;
  const skipped = input.count - available,
    continuous = Math.max(0, input.continuous - skipped),
    burstSkipped = skipped >= input.continuous ? skipped - input.continuous : skipped;
  const burst = input.count - burstSkipped - continuous,
    base = { phase: input.phase, offset: input.offset, spacing: input.dt * input.spacing };
  if (burst) records.push({ ...base, age: input.dt, count: burst, continuous: 0 });
  if (continuous) records.push({ ...base, age: 0, count: continuous, continuous });
}
