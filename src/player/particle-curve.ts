import { sampleCurve, integrateCurve, type NativeCurve, type CurveKey } from './particle-math.ts';

/** All modules share the same authored curve evaluator. */
export function sampleParticleCurve(curve: NativeCurve, age: number, random: number): number {
  return sampleCurve(curve, Math.max(0, age), random);
}
export function integrateParticleCurve(
  curve: NativeCurve,
  time: number,
  random: number,
  twice = false,
): number {
  return integrateCurve(curve, Math.max(0, time), random, twice);
}

function keyRange(keys: CurveKey[]): number[] {
  const values = keys.map((k) => k.value);
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1],
      b = keys[i],
      h = b.time - a.time;
    if (
      a.outSlope === null ||
      b.inSlope === null ||
      !Number.isFinite(a.outSlope) ||
      !Number.isFinite(b.inSlope)
    )
      continue;
    // A weighted segment's Bezier control values give conservative bounds.
    if (a.weightedMode || b.weightedMode) {
      values.push(
        a.value + a.outSlope * h * ((a.weightedMode ?? 0) & 2 ? (a.outWeight ?? 1 / 3) : 1 / 3),
        b.value - b.inSlope * h * ((b.weightedMode ?? 0) & 1 ? (b.inWeight ?? 1 / 3) : 1 / 3),
      );
      continue;
    }
    const A = 2 * a.value - 2 * b.value + h * (a.outSlope + b.inSlope),
      B = -3 * a.value + 3 * b.value - h * (2 * a.outSlope + b.inSlope),
      C = h * a.outSlope;
    const d = 4 * B * B - 12 * A * C;
    const roots =
      Math.abs(A) > 1e-12
        ? d >= 0
          ? [(-2 * B + Math.sqrt(d)) / (6 * A), (-2 * B - Math.sqrt(d)) / (6 * A)]
          : []
        : Math.abs(B) > 1e-12
          ? [-C / (2 * B)]
          : [];
    for (const t of roots) if (t > 0 && t < 1) values.push(((A * t + B) * t + C) * t + a.value);
  }
  return values.length ? values : [0];
}
/** Include Hermite overshoot so culling cannot hide an authored effect. */
export function particleCurveRange(curve: NativeCurve): [number, number] {
  let values: number[];
  if (curve.minMaxState === 0) values = [0, curve.scalar];
  else if (curve.minMaxState === 3) values = [curve.minScalar, curve.scalar];
  else
    values = [
      ...keyRange(curve.maxCurve.m_Curve),
      ...(curve.minMaxState === 2 ? keyRange(curve.minCurve.m_Curve) : []),
    ].map((v) => v * curve.scalar);
  return [Math.min(...values), Math.max(...values)];
}
/** A conservative travel envelope is sufficient for visibility culling. */
export function particleIntegratedCurveRange(curve: NativeCurve, twice = false): [number, number] {
  const [lo, hi] = particleCurveRange(curve),
    factor = twice ? 0.5 : 1;
  return [Math.min(0, lo) * factor, Math.max(0, hi) * factor];
}
