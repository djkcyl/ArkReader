import { ParticleRandom, sampleCurve, type NativeCurve } from './particle-math.ts';
export interface NativeBurst {
  time: number;
  cycleCount: number;
  repeatInterval: number;
  probability: number;
  countCurve: NativeCurve;
}
export function burstInInterval(
  b: NativeBurst,
  begin: number,
  end: number,
  repeat = true,
): boolean {
  const time = b.time;
  if (time >= begin && end > time) return true;
  if (!repeat || b.cycleCount === 1 || begin <= time) return false;
  const from = (begin - time) / b.repeatInterval,
    to = (end - time) / b.repeatInterval;
  return (b.cycleCount === 0 || b.cycleCount - 1 > from) && Math.trunc(to) > Math.trunc(from);
}
export function accumulateBurst(b: NativeBurst, phase: number, random: ParticleRandom): number {
  const probability = b.probability;
  if (probability === 0) return 0;
  if (probability < 1 && random.value() >= probability) return 0;
  const c = b.countCurve;
  if (c.minMaxState === 0) return Math.trunc(c.scalar);
  if (c.minMaxState === 3) {
    const lo = Math.trunc(Math.min(c.scalar, c.minScalar)),
      hi = Math.trunc(Math.max(c.scalar, c.minScalar)) + 1;
    return lo + (random.uint() % (hi - lo));
  }
  return Math.trunc(sampleCurve(c, phase, random.value()));
}
export interface EmissionState {
  remainder: number;
  spacing: number;
  random: ParticleRandom;
}
function emitCommon(state: EmissionState, amount: number): number {
  const total = amount + state.remainder,
    count = Math.trunc(total);
  state.remainder = total - count;
  state.spacing = amount >= 0.0001 ? 1 / amount : 1;
  return count;
}
/** Distance and time emission share a fractional birth accumulator. */
export function emitOverDistance(
  state: EmissionState,
  c: NativeCurve,
  velocity: number[],
  dt: number,
  phase: number,
): number {
  if (c.scalar === 0) return 0;
  const rate = Math.max(0, sampleCurve(c, phase, state.random.value())),
    v = velocity.slice();
  const speed = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  return emitCommon(state, speed * rate * dt);
}
export function emitOverTime(
  state: EmissionState,
  c: NativeCurve,
  bursts: NativeBurst[],
  begin: number,
  end: number,
  duration: number,
): {
  count: number;
  continuous: number;
} {
  begin = Math.max(0, begin);
  end = Math.max(0, end);
  const random = state.random.value();
  let amount = 0,
    burstCount = 0;
  if (c.scalar > 0) {
    let at = end;
    if (begin > end) {
      amount = Math.max(0, sampleCurve(c, end / duration, random)) * end;
      at = duration;
    }
    amount = amount + (at - begin) * Math.max(0, sampleCurve(c, at / duration, random));
  }
  const accumulate = (from: number, to: number, repeat: boolean) => {
    for (const b of bursts)
      if (burstInInterval(b, from, to, repeat))
        burstCount += accumulateBurst(b, to / duration, state.random);
  };
  if (begin > end) {
    accumulate(0, end, true);
    accumulate(begin, duration + 0.0001, false);
  } else accumulate(begin, end, true);
  const continuous = emitCommon(state, amount);
  return { count: continuous + burstCount, continuous };
}
/** StartModules applies age fractions in reverse birth order. Burst particles
 * have no distribution interval and use the native minimum 1e-6 fraction. */
export function emissionAgeFraction(
  state: EmissionState,
  index: number,
  continuous: number,
): number {
  return Math.min(
    1,
    Math.max(1e-6, index < continuous ? (index + state.remainder) * state.spacing : 0),
  );
}
/** SubModule::Update evaluates the child's constant delay in the parent's
 * normalized age before passing the previous/current times to RecordEmit. */
export function delayedBirthInterval(
  percent: number,
  inverseLife: number,
  delay: number,
  step: number,
  duration: number,
) {
  const end = (percent * 0.01) / inverseLife - delay;
  if (end < 0 || end * inverseLife >= 1 || end >= duration) return undefined;
  return { begin: end - step, end };
}
