import { sampleParticleCurve } from './particle-curve.ts';
import type { NativeCurve } from './particle-math.ts';
/** Arc motion advances during start delay as well as emission. */
export class ParticleShapeClock {
  turns = 0;
  previousTurns = 0;
  advance(
    shape: {
      arc?: {
        speed: NativeCurve;
      };
    },
    phase: number,
    duration: number,
    step: number,
  ) {
    this.previousTurns = this.turns;
    if (shape.arc) this.turns += sampleParticleCurve(shape.arc.speed, phase / duration, 1) * step;
  }
  /** Distribute births along the arc traversed in this simulation step. */
  radians(
    index: number,
    emission: {
      spacing: number;
      remainder: number;
    },
  ): number {
    const weight = Math.max(0, Math.min(1, (index + emission.remainder) * emission.spacing));
    const current = this.turns * 2 * Math.PI,
      previous = this.previousTurns * 2 * Math.PI;
    return (1 - weight) * current + weight * previous;
  }
}
