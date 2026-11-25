import { particleNormalizeInverse } from './particle-numeric.ts';
// Seeded particle sampling and gradient noise; ordinary floating-point arithmetic.
const permutation = [
  151, 160, 137, 91, 90, 15, 131, 13, 201, 95, 96, 53, 194, 233, 7, 225, 140, 36, 103, 30, 69, 142,
  8, 99, 37, 240, 21, 10, 23, 190, 6, 148, 247, 120, 234, 75, 0, 26, 197, 62, 94, 252, 219, 203,
  117, 35, 11, 32, 57, 177, 33, 88, 237, 149, 56, 87, 174, 20, 125, 136, 171, 168, 68, 175, 74, 165,
  71, 134, 139, 48, 27, 166, 77, 146, 158, 231, 83, 111, 229, 122, 60, 211, 133, 230, 220, 105, 92,
  41, 55, 46, 245, 40, 244, 102, 143, 54, 65, 25, 63, 161, 1, 216, 80, 73, 209, 76, 132, 187, 208,
  89, 18, 169, 200, 196, 135, 130, 116, 188, 159, 86, 164, 100, 109, 198, 173, 186, 3, 64, 52, 217,
  226, 250, 124, 123, 5, 202, 38, 147, 118, 126, 255, 82, 85, 212, 207, 206, 59, 227, 47, 16, 58,
  17, 182, 189, 28, 42, 223, 183, 170, 213, 119, 248, 152, 2, 44, 154, 163, 70, 221, 153, 101, 155,
  167, 43, 172, 9, 129, 22, 39, 253, 19, 98, 108, 110, 79, 113, 224, 232, 178, 185, 112, 104, 218,
  246, 97, 228, 251, 34, 242, 193, 238, 210, 144, 12, 191, 179, 162, 241, 81, 51, 145, 235, 249, 14,
  239, 107, 49, 192, 214, 31, 181, 199, 106, 157, 184, 84, 204, 176, 115, 121, 50, 45, 127, 4, 150,
  254, 138, 236, 205, 93, 222, 114, 67, 29, 24, 72, 243, 141, 128, 195, 78, 66, 215, 61, 156, 180,
];
const gradients = [
  [1.0, 1.0, 0.0],
  [-1.0, 1.0, 0.0],
  [1.0, -1.0, 0.0],
  [-1.0, -1.0, 0.0],
  [1.0, 0.0, 1.0],
  [-1.0, 0.0, 1.0],
  [1.0, 0.0, -1.0],
  [-1.0, 0.0, -1.0],
  [0.0, 1.0, 1.0],
  [0.0, -1.0, 1.0],
  [0.0, 1.0, -1.0],
  [0.0, -1.0, -1.0],
  [1.0, 1.0, 0.0],
  [-1.0, 1.0, 0.0],
  [0.0, -1.0, 1.0],
  [0.0, -1.0, -1.0],
];
/** Small deterministic generator for repeatable effects and debugging.
 * Named channels keep properties stable across frames without emulating an engine RNG. */
export class ParticleRandom {
  private state: number;
  constructor(seed: number, channel = '') {
    this.state = seed >>> 0;
    for (let i = 0; i < channel.length; i++)
      this.state = Math.imul(this.state ^ channel.charCodeAt(i), 16777619) >>> 0;
  }
  uint(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }
  value(): number {
    return this.uint() / 4294967296;
  }
}
/** RecordEmit's per-parent gate uses a private seed, shared by all links. */
export function birthProbability(seed: number, probability: number): boolean {
  const p = probability;
  return p !== 0 && p >= new ParticleRandom(seed, 'birth-probability').value();
}
// UnityPlayer StartSingleSidedEdge<Random> (0xEFECC0), before the shape transform.
export function sampleSingleSidedEdge(random: ParticleRandom, radius: number) {
  const distance = random.value() * radius;
  return { position: [distance * 2 + -radius, 0, 0], direction: [0, 1, 0] };
}
/** Uniform samples inside the emitter's unit cube. */
export function sampleBox(random: ParticleRandom): number[] {
  return Array.from({ length: 3 }, () => random.value() - 0.5);
}
/** Angles are stored in turns by the emitter samplers. */
export function cosineTurns(turns: number): number {
  return Math.cos(turns * 2 * Math.PI);
}
export function randomUnitVector(
  random: ParticleRandom,
  hemisphere = false,
  arc = 360,
  longitude?: number,
): number[] {
  const turns = ((longitude ?? random.value()) * arc) / 360;
  const latitude = random.value(),
    z = (hemisphere ? latitude * 0.5 + 0.5 : latitude) * 2 - 1,
    radius = Math.sqrt(1 - z * z);
  return [cosineTurns(turns) * radius, cosineTurns(turns - 0.25) * radius, z];
}
/** EmitterStoreData normalizes the starting direction, blends random then
 * radial direction, and normalizes the result before applying start speed. */
export function emissionDirection(
  random: ParticleRandom,
  initial: number[],
  position: number[],
  randomAmount: number,
  sphericalAmount: number,
  shapeScale: number[] = [1, 1, 1],
  shapeBasis?: number[],
): number[] {
  const unit = (v: number[]) => {
    const length = Math.hypot(...v);
    return length * length > 1e-30 ? v.map((x) => x / length) : [0, 0, 1];
  };
  const mix = (from: number[], to: number[], weight: number) =>
    from.map((x, i) => x + (to[i] - x) * weight);
  let direction = unit(initial);
  if (randomAmount > 0) direction = mix(direction, randomUnitVector(random), randomAmount);
  if (sphericalAmount > 0) direction = mix(direction, unit(position), sphericalAmount);
  if (shapeBasis)
    return unit(
      [0, 1, 2].map(
        (i) =>
          shapeBasis[i] * direction[0] +
          shapeBasis[i + 4] * direction[1] +
          shapeBasis[i + 8] * direction[2],
      ),
    );
  return unit(direction.map((v, i) => v * shapeScale[i]));
}
/** ParticleSystemRenderer's billboard corner remap (UnityPlayer 0xECB6C0).
 * The X and Y decisions use separate streams and remain stable for a particle's life. */
export function billboardFlip(seed: number, x: number, y: number): [boolean, boolean] {
  return [
    new ParticleRandom(seed, 'flip-x').value() < x,
    new ParticleRandom(seed, 'flip-y').value() < y,
  ];
}
/** InitialModule birth velocity, UnityPlayer StartVelocity (0xAD04E0). */
export function inheritBirthVelocity(
  base: number[],
  emitter: number[],
  curve: NativeCurve,
  seed: number,
): number[] {
  const weight = sampleCurve(curve, 0, new ParticleRandom(seed, 'inherit-velocity').value());
  return base.map((v, i) => v + weight * emitter[i]);
}
/** StartHemiSphere<3> (0xEFCA10): a full turn excludes its repeated endpoint.
 * Partial arcs include both endpoints. The angle consumes no random sample. */
export function burstLongitude(index: number, count: number, arc: number): number {
  return index * (1 / Math.max(1, arc === 360 ? count : count - 1));
}
export function sampleSphere(
  random: ParticleRandom,
  radius: number,
  thickness: number,
  hemisphere = false,
  arc = 360,
  longitude?: number,
) {
  const direction = randomUnitVector(random, hemisphere, arc, longitude),
    u = random.value();
  const inner = Math.pow(1 - Math.min(1, Math.max(0, thickness)), 3);
  const distance = radius * Math.cbrt(1 - u + u * inner);
  return { direction, position: direction.map((v) => v * distance) };
}
/** Snap angular spread and wrap in either direction within the authored arc. */
export function circleLoopAngle(
  arc: number,
  spread: number,
  turns: number,
  cachedRadians?: number,
): number {
  const radians = arc * (Math.PI / 180),
    step = radians * spread;
  if (Math.abs(radians) < 1e-6) return 0;
  let phase = cachedRadians ?? turns * 2 * Math.PI;
  if (step > 0) phase = Math.floor(phase / step) * step;
  const remainder = phase % radians;
  return remainder < 0 ? radians + remainder : remainder;
}
export function sampleCircle(
  random: ParticleRandom,
  radius: number,
  thickness: number,
  arc: number,
  spread = 0,
  pingPongTurns?: number,
  arcMode = 2,
  cachedRadians?: number,
): {
  position: number[];
  direction: number[];
} {
  const radians = arc * (Math.PI / 180),
    step = radians * spread;
  let angle: number;
  if (pingPongTurns === undefined) {
    const first = random.value();
    angle = radians * first;
    if (step > 0) angle = Math.floor(first * Math.ceil(radians / step)) * step;
  } else if (arcMode === 1) angle = circleLoopAngle(arc, spread, pingPongTurns, cachedRadians);
  else if (Math.abs(radians) < 1e-6) angle = 0;
  else {
    // StartCircle<2> / 0xF061A0 snaps radians before folding each alternate pass.
    let phase = cachedRadians ?? pingPongTurns * 2 * Math.PI;
    if (step > 0) phase = Math.floor(phase / step) * step;
    let t = Math.abs((phase * (1 / radians)) % 2);
    if (t >= 1) t = 2 - t - 1e-6;
    angle = (t - Math.floor(t)) * radians;
  }
  const turns = angle * (1 / (2 * Math.PI)),
    unit = random.value();
  const inner = Math.max(0.01, radius - radius * thickness),
    r = inner * unit + (1 - unit) * radius,
    x = cosineTurns(turns),
    y = cosineTurns(turns - 0.25);
  return { position: [x * r, y * r, 0], direction: r > 0 ? [x, y, 0] : [0, 0, 1] };
}
/** StartConeVolume<0..3> (0xEF8DC0/EF7030/EF79A0/EF8320).
 * Length is a distance along the normalized ray, not axial height. In
 * particular a 90-degree cone stays finite and lies in the emission plane.
 * Return the raw direction for EmitterStoreData's blend/shape-transform step. */
type ConeShape = {
  radius: number;
  thickness: number;
  angle: number;
  length: number;
  arc: number;
  spread: number;
  mode: number;
  turns: number;
  index: number;
  count: number;
  cachedRadians?: number;
};
function sampleConeDisk(random: ParticleRandom, o: ConeShape) {
  const radians = o.arc * (Math.PI / 180),
    step = radians * o.spread;
  let angle: number;
  if (o.mode === 3) {
    angle = burstLongitude(o.index, o.count, o.arc) * radians;
    if (step > 0) angle = Math.floor(angle / step) * step;
  } else if (o.mode === 1) angle = circleLoopAngle(o.arc, o.spread, o.turns, o.cachedRadians);
  else if (o.mode === 2) {
    let phase = o.cachedRadians ?? o.turns * 2 * Math.PI;
    if (step > 0) phase = Math.floor(phase / step) * step;
    let t = Math.abs((phase * (1 / radians)) % 2);
    if (t >= 1) t = 2 - t - 1e-6;
    angle = Math.abs(radians) < 1e-6 ? 0 : (t - Math.floor(t)) * radians;
  } else {
    const first = random.value();
    angle = radians * first;
    if (step > 0) angle = Math.floor((first * step * Math.ceil(radians / step)) / step) * step;
  }
  const turns = angle * (1 / (2 * Math.PI)),
    u = random.value(),
    disk = Math.sqrt(1 - u + u * Math.max(0.01, 1 - o.thickness));
  const x = disk * cosineTurns(turns),
    y = disk * cosineTurns(turns - 0.25);
  const theta = o.angle * (Math.PI / 180) * (1 / (2 * Math.PI)),
    sin = cosineTurns(theta - 0.25),
    cos = cosineTurns(theta);
  return {
    position: [o.radius * x, o.radius * y, 0],
    direction: [sin * x, sin * y, cos],
    x,
    y,
    sin,
    cos,
  };
}
/** StartCone: random direction blends a second disk before the cone angle;
 * unlike other primitives it does not use StoreData's 3D random blend. */
export function sampleCone(random: ParticleRandom, o: ConeShape, randomAmount = 0) {
  const { position, direction, x, y, sin, cos } = sampleConeDisk(random, o);
  if (randomAmount > 0) {
    const turns = random.value(),
      u = random.value(),
      r = Math.sqrt(1 - u + 0.01 * u);
    const rx = r * cosineTurns(turns),
      ry = r * cosineTurns(turns - 0.25);
    return {
      position,
      direction: [(x + (rx - x) * randomAmount) * sin, (y + (ry - y) * randomAmount) * sin, cos],
    };
  }
  return { position, direction };
}
export function sampleConeVolume(random: ParticleRandom, o: ConeShape) {
  const disk = sampleConeDisk(random, o),
    direction = disk.direction,
    distance = random.value() * o.length,
    norm = Math.hypot(...direction);
  const position = disk.position.map(
    (v, i) => v + distance * (norm * norm > 1e-30 ? direction[i] / norm : 0),
  );
  return { position, direction };
}
/** Sample shell faces or edges before applying the authored shape transform. */
export function sampleBoxShell(
  random: ParticleRandom,
  thickness: number[],
  edge = false,
): number[] {
  const point = [random.value(), random.value(), random.value()],
    axis = random.uint() % 3;
  // BoxShell snaps one coordinate; BoxEdge keeps that coordinate and snaps the other two.
  for (let i = 0; i < 3; i++)
    if (edge ? i !== axis : i === axis) point[i] = point[i] >= 0.5 ? 1 : 0;
  return point.map((v, i) => {
    const r = random.value(),
      scale = 1 - r + (1 - thickness[i]) * r;
    return v * scale - 0.5;
  });
}
export interface CurveKey {
  time: number;
  value: number;
  inSlope: number | null;
  outSlope: number | null;
  weightedMode?: number;
  inWeight?: number;
  outWeight?: number;
}
export interface NativeCurve {
  minMaxState: number;
  scalar: number;
  minScalar: number;
  maxCurve: {
    m_Curve: CurveKey[];
  };
  minCurve: {
    m_Curve: CurveKey[];
  };
}
function segment(a: CurveKey, b: CurveKey, u: number): number {
  const h = b.time - a.time;
  if (
    a.outSlope === null ||
    b.inSlope === null ||
    !Number.isFinite(a.outSlope) ||
    !Number.isFinite(b.inSlope)
  )
    return a.value;
  if ((a.weightedMode ?? 0) & 2 || (b.weightedMode ?? 0) & 1) {
    const wa = (a.weightedMode ?? 0) & 2 ? (a.outWeight ?? 1 / 3) : 1 / 3,
      wb = (b.weightedMode ?? 0) & 1 ? (b.inWeight ?? 1 / 3) : 1 / 3;
    let lo = 0,
      hi = 1,
      t = u;
    for (let i = 0; i < 24; i++) {
      const v = 1 - t,
        x = 3 * v * v * t * wa + 3 * v * t * t * (1 - wb) + t * t * t;
      if (x < u) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    const v = 1 - t;
    return (
      v * v * v * a.value +
      3 * v * v * t * (a.value + a.outSlope * h * wa) +
      3 * v * t * t * (b.value - b.inSlope * h * wb) +
      t * t * t * b.value
    );
  }
  const u2 = u * u,
    u3 = u2 * u;
  return (
    (2 * u3 - 3 * u2 + 1) * a.value +
    (u3 - 2 * u2 + u) * h * a.outSlope +
    (-2 * u3 + 3 * u2) * b.value +
    (u3 - u2) * h * b.inSlope
  );
}
export function sampleKeys(keys: CurveKey[], time: number): number {
  if (!keys.length) return 0;
  if (time <= keys[0].time) return keys[0].value;
  for (let i = 1; i < keys.length; i++)
    if (time < keys[i].time)
      return segment(
        keys[i - 1],
        keys[i],
        (time - keys[i - 1].time) / (keys[i].time - keys[i - 1].time),
      );
  return keys.at(-1)!.value;
}
export function sampleCurve(c: NativeCurve, time: number, random = 1): number {
  if (c.minMaxState === 0) return c.scalar;
  if (c.minMaxState === 3) return c.minScalar + (c.scalar - c.minScalar) * random;
  const hi = sampleKeys(c.maxCurve.m_Curve, time),
    value =
      c.minMaxState === 2
        ? sampleKeys(c.minCurve.m_Curve, time) +
          (hi - sampleKeys(c.minCurve.m_Curve, time)) * random
        : hi;
  return value * c.scalar;
}
/** Integrate authored curves, optionally twice for acceleration displacement. */
export function integrateKeys(keys: CurveKey[], time: number, twice = false): number {
  if (!keys.length || time <= 0) return 0;
  let sum = 0,
    at = 0;
  const constant = (value: number, start: number, end: number) =>
    value * (end - start) * (twice ? time - (start + end) / 2 : 1);
  if (keys[0].time > 0) {
    at = Math.min(time, keys[0].time);
    sum += constant(keys[0].value, 0, at);
  }
  for (let i = 1; i < keys.length && at < time; i++) {
    const a = keys[i - 1],
      b = keys[i],
      start = Math.max(0, a.time),
      end = Math.min(time, b.time),
      h = b.time - a.time;
    if (end <= start) continue;
    if (
      a.outSlope === null ||
      b.inSlope === null ||
      !Number.isFinite(a.outSlope) ||
      !Number.isFinite(b.inSlope)
    )
      sum += constant(a.value, start, end);
    else if (a.weightedMode || b.weightedMode) {
      // Weighted Bezier time requires inversion; Simpson integration is sufficient for motion.
      const steps = 32,
        dt = (end - start) / steps;
      for (let j = 0; j <= steps; j++) {
        const t = start + j * dt,
          value = segment(a, b, (t - a.time) / h) * (twice ? time - t : 1);
        sum += (value * (j === 0 || j === steps ? 1 : j % 2 ? 4 : 2) * dt) / 3;
      }
    } else {
      const coefficients = [
        a.value,
        h * a.outSlope,
        -3 * a.value + 3 * b.value - h * (2 * a.outSlope + b.inSlope),
        2 * a.value - 2 * b.value + h * (a.outSlope + b.inSlope),
      ];
      const lo = (start - a.time) / h,
        hi = (end - a.time) / h;
      coefficients.forEach((c, power) => {
        const integral = (h * c * (hi ** (power + 1) - lo ** (power + 1))) / (power + 1);
        sum += twice
          ? (time - a.time) * integral -
            (h * h * c * (hi ** (power + 2) - lo ** (power + 2))) / (power + 2)
          : integral;
      });
    }
    at = end;
  }
  if (at < time) sum += constant(keys.at(-1)!.value, at, time);
  return sum;
}
export function integrateCurve(c: NativeCurve, time: number, random = 1, twice = false): number {
  if (c.minMaxState === 0 || c.minMaxState === 3)
    return sampleCurve(c, 0, random) * time * (twice ? time / 2 : 1);
  const hi = integrateKeys(c.maxCurve.m_Curve, time, twice),
    lo = c.minMaxState === 2 ? integrateKeys(c.minCurve.m_Curve, time, twice) : 0;
  return (c.minMaxState === 2 ? lo + (hi - lo) * random : hi) * c.scalar;
}
// Return dNoise/dx and dNoise/dy, as the original floatNx2 function does.
export function perlinDerivatives(position: number[], frequency: number): number[] {
  const p = position.map((v) => v * frequency),
    base = p.map(Math.floor),
    r = p.map((v, i) => v - base[i]);
  const fade = r.map((t) => t * t * t * (t * (6 * t + -15) + 10)),
    derivative = r.map((t) => 30 * t * t * (t * (t - 2) + 1));
  const corners: number[][] = [];
  for (let z = 0; z < 2; z++)
    for (let y = 0; y < 2; y++)
      for (let x = 0; x < 2; x++) {
        const perm = (n: number) => permutation[n & 255];
        const g = gradients[perm(perm(perm(base[0] + x) + base[1] + y) + base[2] + z) & 15];
        corners.push([(r[1] - y) * g[1] + (r[2] - z) * g[2] + (r[0] - x) * g[0], g[0], g[1]]);
      }
  const [x, y, z] = fade,
    lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const bilinear = (a: number, b: number, c: number, d: number, u: number, v: number) =>
    lerp(lerp(a, b, u), lerp(c, d, u), v);
  const interpolate = (values: number[]) =>
    lerp(
      bilinear(values[0], values[1], values[2], values[3], x, y),
      bilinear(values[4], values[5], values[6], values[7], x, y),
      z,
    );
  const [a, b, c, d, e, g, h, i] = corners.map((v) => v[0]);
  const slopes = [
    bilinear(b - a, d - c, g - e, i - h, y, z),
    bilinear(c - a, d - b, h - e, i - g, x, z),
  ];
  return [1, 2].map(
    (axis) =>
      (slopes[axis - 1] * derivative[axis - 1] + interpolate(corners.map((v) => v[axis]))) *
      frequency,
  );
}
export function octaveDerivatives(
  position: number[],
  frequency: number,
  octaves = 1,
  scale = 2,
  multiplier = 0.5,
): number[] {
  let value = perlinDerivatives(position, frequency),
    weight = 1,
    total = 1;
  for (let i = 1; i < octaves; i++) {
    frequency = frequency * scale;
    weight = weight * multiplier;
    total = total + weight;
    const next = perlinDerivatives(position, frequency);
    value = value.map((v, j) => v + weight * next[j]);
  }
  return value.map((v) => v / total);
}
const diagonal = 1 / Math.sqrt(2);
const gradients2D = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [diagonal, diagonal],
  [-diagonal, diagonal],
  [diagonal, -diagonal],
  [-diagonal, -diagonal],
];
// Perlin2D (UnityPlayer 0xEEA420) returns spatial derivatives, not the noise value.
function mediumDerivatives(x: number, y: number, frequency: number): number[] {
  const px = x * frequency,
    py = y * frequency,
    ix = Math.floor(px),
    iy = Math.floor(py);
  const u = px - ix,
    v = py - iy;
  function fade(t: number) {
    return t * t * t * (t * (6 * t + -15) + 10);
  }
  function slope(t: number) {
    return 30 * t * t * (t * (t - 2) + 1);
  }
  const fu = fade(u),
    fv = fade(v),
    corners: number[][] = [];
  for (let j = 0; j < 2; j++)
    for (let i = 0; i < 2; i++) {
      const hash = permutation[(permutation[(ix + i) & 255] + iy + j) & 255] & 7,
        [gx, gy] = gradients2D[hash];
      corners.push([(u - i) * gx + (v - j) * gy, gx, gy]);
    }
  const [a, b, c, d] = corners,
    norm = Math.SQRT2 * frequency;
  const cross = (axis: number) => d[axis] - c[axis] - b[axis] + a[axis];
  return [1, 2].map((axis) => {
    const gradient =
      fu * (b[axis] - a[axis]) + (fv * (c[axis] - a[axis] + fu * cross(axis)) + a[axis]);
    const derivative =
      axis === 1
        ? (fv * cross(0) + (b[0] - a[0])) * slope(u)
        : (fu * cross(0) + (c[0] - a[0])) * slope(v);
    return norm * (derivative + gradient);
  });
}
// CalculateNoiseJob adds half the angular amount (degrees -> radians)
// per time step. UpdateSize multiplies the base diameter without accumulating.
export function noiseAngleDelta(noiseZ: number, amount: number, dt: number): number {
  return (Math.PI / 360) * dt * amount * noiseZ;
}
export function noiseSizeFactor(noiseX: number, amount: number): number {
  return Math.max(0, 1 + 0.5 * amount * noiseX);
}
// Original Perlin1D (UnityPlayer 0xEEA160) returns the analytic derivative
// times 2*frequency and a zero second component, not a sampled 3D curl.
export function lowCurlNoise(
  position: number[],
  frequency: number,
  scroll: number,
  offset: number[],
): number[] {
  const [x, y, z] = position.map((v, i) => v + offset[i] * 100);
  const derivative = (p: number) => {
    const n = p * frequency,
      cell = Math.floor(n),
      t = n - cell,
      a = permutation[cell & 255] & 1 ? -1 : 1,
      b = permutation[(cell + 1) & 255] & 1 ? -1 : 1;
    const fade = t * t * t * (t * (6 * t + -15) + 10);
    const slope = 30 * t * t * ((t - 2) * t + 1);
    const value = (b * (t - 1) - t * a) * slope + a + (b - a) * fade;
    return 2 * frequency * value;
  };
  return [derivative(y + scroll), derivative(z + scroll), derivative(x + 100 + scroll)];
}
export function mediumCurlNoise(
  position: number[],
  frequency: number,
  scroll: number,
  offset: number[],
): number[] {
  const [x, y, z] = position.map((v, i) => v + offset[i] * 100);
  const a = mediumDerivatives(z, y + scroll, frequency);
  const b = mediumDerivatives(x + 100, z + scroll, frequency);
  const c = mediumDerivatives(y, x + 100 + scroll, frequency);
  return [c[0] - b[1], a[0] - c[1], b[0] - a[1]];
}
export function curlNoise(
  position: number[],
  frequency: number,
  scroll: number,
  offset: number[],
  octaves = 1,
  scale = 2,
  multiplier = 0.5,
): number[] {
  const [x, y, z] = position.map((v, i) => v + offset[i] * 100);
  const sample = (p: number[]) => octaveDerivatives(p, frequency, octaves, scale, multiplier);
  const a = sample([z, y, x + scroll]),
    b = sample([x + 100, z, y + scroll]),
    c = sample([y, x + 100, z + scroll]);
  return [c[0] - b[1], a[0] - c[1], b[0] - a[1]];
}
// UnityPlayer DragUpdateTpl<0>, 0xAEF510. Drag reduces the combined speed
// and writes only the base velocity back, leaving animated velocity intact.
export function applyParticleDrag(
  base: number[],
  animated: number[],
  drag: number,
  diameter: number,
  bySize: boolean,
  bySpeed: boolean,
  dt: number,
): number[] {
  const velocity = base.map((v, i) => v + animated[i]);
  const squared = velocity[1] * velocity[1] + velocity[2] * velocity[2] + velocity[0] * velocity[0];
  const speed = Math.sqrt(squared),
    radius = diameter * 0.5;
  const area = bySize ? radius * Math.PI * radius : 1;
  const loss = area * drag * (bySpeed ? squared : 1) * dt;
  const remaining = Math.max(0, speed - loss);
  return velocity.map((v, i) => remaining * (speed > 1e-15 ? v / speed : 0) - animated[i]);
}
// UnityPlayer ClampVelocityModule::Update, 0xAFBA40: time-normalized damping.
export function limitParticleVelocity(
  base: number[],
  animated: number[],
  limit: number,
  dampen: number,
  dt: number,
): number[] {
  if (dampen <= 0) return [...base];
  const v = base.map((x, i) => x + animated[i]),
    squared = v[1] * v[1] + v[2] * v[2] + v[0] * v[0];
  if (squared <= 1e-30) return animated.map((x) => -x);
  const magnitude = Math.sqrt(squared),
    damping = 1 - Math.pow(1 - dampen, Math.abs(dt) * 30);
  const target = magnitude > limit ? magnitude + (limit - magnitude) * damping : magnitude,
    inverse = particleNormalizeInverse(squared);
  return v.map((x, i) => x * inverse * target - animated[i]);
}
