/** Authored Euler angles use Z, then X, then Y rotation. */
export function particleEulerQuaternion(degrees: number[]): number[] {
  const radians = degrees.map((v) => (v * Math.PI) / 360),
    [sx, sy, sz] = radians.map(Math.sin),
    [cx, cy, cz] = radians.map(Math.cos);
  return [
    sx * cy * cz + cx * sy * sz,
    cx * sy * cz - sx * cy * sz,
    cx * cy * sz - sx * sy * cz,
    cx * cy * cz + sx * sy * sz,
  ];
}
export function particleRotationColumns([x, y, z, w]: number[]): number[][] {
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0],
    [2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0],
    [2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0],
  ];
}
export function multiplyParticleQuaternions(
  [x, y, z, w]: number[],
  [a, b, c, d]: number[],
): number[] {
  return [
    w * a + x * d + y * c - z * b,
    w * b - x * c + y * d + z * a,
    w * c + x * b - y * a + z * d,
    w * d - x * a - y * b - z * c,
  ];
}
