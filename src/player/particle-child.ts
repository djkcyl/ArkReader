import { childEmitterAxes } from './particle-geometry.ts';
import { MAX_PARTICLE_STEP } from './particle-timing.ts';
/** Emit (AC4CF0) consumes only full catch-up steps from the PARENT pending
 * time. It neither scales that time by child speed nor consumes its tail. */
export function childPreSimulationSteps(pending: number, duration: number, flags = 0): number[] {
  let remaining = pending,
    step = MAX_PARTICLE_STEP;
  const result: number[] = [];
  if (!(flags & 4)) {
    if (remaining > 10 && step <= 1) step = Math.min(duration, 1);
    else if (remaining > 5 && step <= 0.2) step = Math.min(duration, 0.2);
  }
  if (step <= 0.0001) return result;
  while (remaining >= step) {
    result.push(step);
    remaining = remaining - step;
  }
  return result;
}
export interface ChildBirthTransform {
  velocity: number[];
  forward: number[];
  up: number[];
  rotation: {
    x: number;
    y: number;
    z: number;
    w: number;
  };
  scale: number[];
  origin: number[];
  inverse?: number[];
}
/** Quaternion rotation as column vectors. */
export function childLocalRotation(q: ChildBirthTransform['rotation']): number[][] {
  const [x, y, z, w] = [q.x, q.y, q.z, q.w].slice(),
    xx = x * (x + x),
    yy = y * (y + y),
    zz = z * (z + z);
  const xy = x * (y + y),
    xz = x * (z + z),
    yz = y * (z + z),
    wx = w * (x + x),
    wy = w * (y + y),
    wz = w * (z + z);
  return [
    [1 - (zz + yy), wz + xy, xz - wy],
    [xy - wz, 1 - (zz + xx), wx + yz],
    [wy + xz, yz - wx, 1 - (yy + xx)],
  ];
}
/** Build the child orientation in its simulation space, then apply scale. */
export function childBirthMatrix(input: ChildBirthTransform): number[] {
  const axes = childEmitterAxes(input.velocity, input.forward, input.up),
    local = childLocalRotation(input.rotation);
  let matrix = local
    .flatMap((column) => [
      ...axes[0].map(
        (_, i) => axes[0][i] * column[0] + axes[1][i] * column[1] + axes[2][i] * column[2],
      ),
      0,
    ])
    .concat([...input.origin.slice(), 1]);
  if (input.inverse) {
    const inverse = input.inverse.slice(),
      b = matrix;
    matrix = Array.from({ length: 16 }, (_, index) => {
      const row = index % 4,
        col = Math.floor(index / 4);
      if (row === 3) return col === 3 ? 1 : 0;
      const value =
        inverse[row] * b[col * 4] +
        inverse[4 + row] * b[col * 4 + 1] +
        inverse[8 + row] * b[col * 4 + 2];
      return col === 3 ? value + inverse[12 + row] : value;
    });
  }
  for (let col = 0; col < 3; col++)
    for (let row = 0; row < 4; row++)
      matrix[col * 4 + row] = matrix[col * 4 + row] * input.scale[col];
  return matrix;
}
export function childBirthVector(matrix: number[], vector: number[], point = false): number[] {
  const v = vector.slice();
  return [0, 1, 2].map((row) => {
    const value = matrix[row] * v[0] + matrix[4 + row] * v[1] + matrix[8 + row] * v[2];
    return point ? value + matrix[12 + row] : value;
  });
}
