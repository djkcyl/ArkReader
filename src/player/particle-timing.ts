/** Update1Incremental consumes StartDelay in scaled simulation substeps.
 * The phase-zero test is captured once at the start of the frame's job. */
export function particleDelayStep(
  delay: number,
  step: number,
  consume: boolean,
): {
  phase: number;
  emission: number;
  remaining: number;
} {
  const phase = step > delay ? step - delay : 0;
  if (consume && delay > 0) {
    const rest = delay - step;
    return { phase, emission: Math.max(0, -rest), remaining: Math.max(0, rest) };
  }
  return { phase, emission: step, remaining: delay };
}
// Small simulation steps keep motion stable at different browser frame rates.
export const MAX_PARTICLE_STEP = 1 / 30;
export const FIXED_PARTICLE_STEP = MAX_PARTICLE_STEP;
/** UIParticleRenderer._Simulate (0x69BD955–0x69BD9D3). The first positive
 * frame adds capped duration before Update1b applies simulationSpeed. */
export class UIParticleFrameClock {
  prewarmPending: boolean;
  constructor(prewarmPending: boolean) {
    this.prewarmPending = prewarmPending;
  }
  take(delta: number, duration: number, suppressed = false): number {
    if (suppressed) return 0;
    if (delta > 0 && this.prewarmPending) {
      this.prewarmPending = false;
      delta = delta + Math.min(duration, 10);
    }
    return delta;
  }
}
/** UnityPlayer ParticleStep (0xAC8030), scaled input delta. */
export function particleStep(delta: number, fixed = false): number {
  return fixed
    ? FIXED_PARTICLE_STEP
    : delta > MAX_PARTICLE_STEP
      ? delta / Math.ceil(delta / MAX_PARTICLE_STEP)
      : delta;
}
/** Update1b / Update1Incremental's pending-time scheduler. It deliberately
 * retains sub-threshold residuals; an individual tiny normal frame is dropped
 * before accumulation. Flags: 1 fixed step, 4 disable catch-up enlargement.
 * Particle modules, birth generation and procedural evaluation are separate. */
export class ParticleStepClock {
  pending = 0;
  take(delta: number, duration: number, flags = 0): number[] {
    const requested = particleStep(delta, !!(flags & 1)),
      steps: number[] = [];
    if (requested < 0.00001) return steps;
    this.pending = this.pending + delta;
    let step = requested,
      threshold = flags & 1 ? requested : 0.000001;
    while (this.pending >= threshold) {
      if (!(flags & 4) && this.pending > 10) {
        if (step <= 1) step = Math.min(duration, 1);
      } else if (!(flags & 4) && this.pending > 5) {
        if (step <= 0.2) step = Math.min(duration, 0.2);
      } else step = Math.min(requested, this.pending);
      steps.push(step);
      this.pending = this.pending - step;
      if (flags & 1) threshold = step;
    }
    return steps;
  }
}
