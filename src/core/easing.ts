/** Independent evaluation of the native DOTween Ease enum (default amplitude
 * 1.70158, period 0). Names and numeric strings follow the original enum values.
 */
const names = [
  'Unset',
  'Linear',
  'InSine',
  'OutSine',
  'InOutSine',
  'InQuad',
  'OutQuad',
  'InOutQuad',
  'InCubic',
  'OutCubic',
  'InOutCubic',
  'InQuart',
  'OutQuart',
  'InOutQuart',
  'InQuint',
  'OutQuint',
  'InOutQuint',
  'InExpo',
  'OutExpo',
  'InOutExpo',
  'InCirc',
  'OutCirc',
  'InOutCirc',
  'InElastic',
  'OutElastic',
  'InOutElastic',
  'InBack',
  'OutBack',
  'InOutBack',
  'InBounce',
  'OutBounce',
  'InOutBounce',
  'Flash',
  'InFlash',
  'OutFlash',
  'InOutFlash',
];
export function nativeEase(value: unknown = 1): number | null {
  const n =
    typeof value === 'number'
      ? value
      : /^[+-]?\d+$/.test(String(value))
        ? Number(value)
        : names.indexOf(String(value));
  return Number.isInteger(n) && n >= 0 && n < names.length ? n : null;
}
function bounce(t: number): number {
  const breaks = [1 / 2.75, 2 / 2.75, 2.5 / 2.75, Infinity],
    centers = [0, 1.5 / 2.75, 2.25 / 2.75, 2.625 / 2.75],
    heights = [0, 0.75, 0.9375, 0.984375];
  const i = breaks.findIndex((v) => t < v);
  return 7.5625 * (t - centers[i]) ** 2 + heights[i];
}
export function nativeEaseAt(code: number, t: number): number {
  if (code === 0) code = 6;
  if (code === 1) return t;
  if (code >= 32) {
    const phase = t * 1.70158,
      triangle = 1 - Math.abs(1 - (phase % 2));
    return code === 32
      ? triangle
      : code === 33
        ? triangle ** 2
        : code === 34
          ? 1 - (1 - triangle) ** 2
          : triangle < 0.5
            ? 2 * triangle ** 2
            : 1 - 2 * (1 - triangle) ** 2;
  }
  const group = Math.floor((code - 2) / 3),
    mode = (code - 2) % 3;
  if (group === 7) {
    if (t === 0 || t === 1) return t;
    const a = 1.70158,
      period = mode === 2 ? 0.45 : 0.3,
      s = (period / (2 * Math.PI)) * Math.asin(1 / a),
      wave = (v: number) => Math.sin(((v - s) * 2 * Math.PI) / period);
    if (mode === 0) return -a * 2 ** (10 * (t - 1)) * wave(t - 1);
    if (mode === 1) return 1 + a * 2 ** (-10 * t) * wave(t);
    const q = 2 * t - 1;
    return q < 0 ? -0.5 * a * 2 ** (10 * q) * wave(q) : 1 + 0.5 * a * 2 ** (-10 * q) * wave(q);
  }
  const inside = (x: number) => {
    if (group === 0) return 1 - Math.cos((x * Math.PI) / 2);
    if (group <= 4) return x ** (group + 1);
    if (group === 5) return x === 0 ? 0 : 2 ** (10 * (x - 1));
    if (group === 6) return 1 - Math.sqrt(Math.max(0, 1 - x * x));
    if (group === 8) {
      const s = 1.70158 * (mode === 2 ? 1.525 : 1);
      return x * x * ((s + 1) * x - s);
    }
    return 1 - bounce(1 - x);
  };
  return mode === 0
    ? inside(t)
    : mode === 1
      ? 1 - inside(1 - t)
      : t < 0.5
        ? inside(2 * t) / 2
        : 1 - inside(2 - 2 * t) / 2;
}
