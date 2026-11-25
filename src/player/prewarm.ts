import type { NativeCurve } from './particle-math';
/** ParticleSystem::ComputePrewarmStartParameters at requested time zero.
 * The native scalar and two-constant lifetime branches include no curve-cache queries. */
export function constantLifetimePrewarm(
  duration: number,
  lifetime: NativeCurve,
):
  | {
      start: number;
      end: number;
    }
  | undefined {
  const largest = maximumConstantLifetime(lifetime);
  if (largest === undefined) return undefined;
  return prewarmFromLifetime(duration, largest);
}
export function maximumConstantLifetime(lifetime: NativeCurve): number | undefined {
  if (lifetime.minMaxState !== 0 && lifetime.minMaxState !== 3) return undefined;
  return Math.max(0, lifetime.scalar, lifetime.minMaxState === 3 ? lifetime.minScalar : 0);
}
export function prewarmFromLifetime(
  duration: number,
  largest: number,
):
  | {
      start: number;
      end: number;
    }
  | undefined {
  const life = largest === Infinity ? duration : Math.max(0, largest),
    cycle = duration;
  if (!(cycle > 0) || !Number.isFinite(life)) return undefined;
  const aligned = Math.ceil(life / cycle) * cycle;
  const start = (aligned - life) % cycle;
  return { start, end: start + life };
}
