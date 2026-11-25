/** Unity TRS in canvas coordinates (Y down). Keep depth until final projection:
 * tilted parents can turn a child's Z translation back into visible X/Y. */
export function uiTransform(
  x: number,
  y: number,
  z: number,
  scale: { x: number; y: number; z?: number },
  rotation: { x?: number; y?: number; z: number; w: number },
): number[] {
  const length = Math.hypot(rotation.x ?? 0, rotation.y ?? 0, rotation.z, rotation.w);
  const q =
    length > 0
      ? [rotation.x ?? 0, rotation.y ?? 0, rotation.z, rotation.w].map((v) => v / length)
      : [0, 0, 0, 1];
  const [a, b, c, d] = q,
    sx = scale.x,
    sy = scale.y,
    sz = scale.z ?? 1;
  return [
    (1 - 2 * (b * b + c * c)) * sx,
    -2 * (a * b + c * d) * sx,
    2 * (a * c - b * d) * sx,
    0,
    -2 * (a * b - c * d) * sy,
    (1 - 2 * (a * a + c * c)) * sy,
    -2 * (b * c + a * d) * sy,
    0,
    2 * (a * c + b * d) * sz,
    -2 * (b * c - a * d) * sz,
    (1 - 2 * (a * a + b * b)) * sz,
    0,
    x,
    -y,
    z,
    1,
  ];
}
