import { childLocalRotation } from './particle-child.ts';
import {
  particleEulerQuaternion,
  particleRotationColumns,
  multiplyParticleQuaternions,
} from './particle-rotation.ts';
type V = number[];
export interface ParticleTransform {
  position: V;
  rotation: V;
  scale: V;
}
const rotationColumns = particleRotationColumns;
const mul = (x: V, y: V) => x.map((v, i) => v * y[i]);
const splat = (v: number) => [v, v, v, v];
const add = (x: V, y: V) => x.map((v, i) => v + y[i]);
export function particleShapeBasis(degrees: V): V {
  return rotationColumns(particleEulerQuaternion(degrees)).flat();
}
function columnsVector(columns: V[], v: V): V {
  return [0, 1, 2, 3].map(
    (i) => columns[0][i] * v[0] + columns[1][i] * v[1] + columns[2][i] * v[2],
  );
}
export function particleBasisVector(basis: V, vector: V): V {
  return columnsVector([basis.slice(0, 4), basis.slice(4, 8), basis.slice(8, 12)], vector).slice(
    0,
    3,
  );
}
function globalRotation(chain: ParticleTransform[]): V {
  let q = chain.at(-1)!.rotation.slice();
  for (let i = chain.length - 2; i >= 0; i--) {
    const parent = chain[i],
      sign = parent.scale.map((v) => (v < 0 || Object.is(v, -0) ? -1 : 1));
    // Reflections change the handedness of the child's local rotation.
    q = q.map((v, j) => (j < 3 ? v * sign[(j + 1) % 3] * sign[(j + 2) % 3] : v));
    q = multiplyParticleQuaternions(parent.rotation, q);
  }
  return q;
}
function globalPosition(chain: ParticleTransform[]): V {
  return hierarchyMatrix(chain)[3];
}
function hierarchyMatrix(chain: ParticleTransform[]): V[] {
  const last = chain.at(-1)!,
    columns = rotationColumns(last.rotation).map((v, i) => mul(v, splat(last.scale[i])));
  let matrix = [...columns, [...last.position, 0]];
  for (let i = chain.length - 2; i >= 0; i--) {
    const t = chain[i],
      parent = rotationColumns(t.rotation).map((v, i) => mul(v, splat(t.scale[i])));
    matrix = matrix.map((v, j) =>
      j === 3 ? add(columnsVector(parent, v), [...t.position, 0]) : columnsVector(parent, v),
    );
  }
  return matrix;
}
function normalize(q: V): V {
  const length = Math.hypot(...q);
  return length > 1e-15 ? q.map((v) => v / length) : [0, 0, 0, 1];
}
/** InvertMatrix4x4_General3D, including its singular zero-matrix result. */
export function inverseParticleMatrix(v: V): V {
  const triple = (i: number, j: number, k: number) => v[i] * v[j] * v[k];
  const det =
    triple(0, 5, 10) +
    0 +
    triple(1, 6, 8) +
    triple(2, 4, 9) -
    triple(2, 5, 8) -
    triple(4, 1, 10) -
    triple(6, 0, 9);
  if (det * det < 1e-25) return Array(16).fill(0);
  const inv = 1 / det,
    co = (i: number, j: number, k: number, l: number, negative = false) =>
      (negative ? -(v[i] * v[j] - v[k] * v[l]) : v[i] * v[j] - v[k] * v[l]) * inv;
  const out = [
    co(10, 5, 9, 6),
    co(10, 1, 2, 9, true),
    co(1, 6, 2, 5),
    0,
    co(10, 4, 8, 6, true),
    co(10, 0, 8, 2),
    co(0, 6, 2, 4, true),
    0,
    co(4, 9, 8, 5),
    co(0, 9, 8, 1, true),
    co(0, 5, 4, 1),
    0,
    0,
    0,
    0,
    1,
  ];
  out[12] = -(v[13] * out[4] + out[0] * v[12] + v[14] * out[8]);
  out[13] = -(out[1] * v[12] + v[13] * out[5] + v[14] * out[9]);
  out[14] = -(out[2] * v[12] + v[13] * out[6] + v[14] * out[10]);
  return out;
}
/** UpdateLocalToWorldMatrixAndScales for authored local/world simulation.
 * Mode 0 preserves hierarchy shear; mode 1 uses global rotation and local scale.
 * Shape mode is represented here but remains gated by resource admission. */
export function particleTransformSetup(chain: ParticleTransform[], mode: number) {
  const raw = hierarchyMatrix(chain),
    q = globalRotation(chain),
    rot = rotationColumns(q),
    last = chain.at(-1)!;
  const unrotate = rotationColumns(q.map((v, i) => (i < 3 ? -v : v)));
  const hierarchyScale = raw.slice(0, 3).map((v, i) => columnsVector(unrotate, v)[i]);
  const scale = mode === 0 ? hierarchyScale : mode === 1 ? last.scale.slice() : [1, 1, 1];
  const columns =
    mode === 0 ? raw : [...rot.map((v, i) => mul(v, splat(scale[i]))), globalPosition(chain)];
  const matrix = columns.flatMap((v, i) => [
    v[0],
    v[1],
    v[2],
    i === 3 ? 1 : mode === 1 ? 0 * scale[i] : 0,
  ]);
  const local = normalize(last.rotation.slice());
  const rotation = normalize(q);
  return {
    matrix,
    inverse: inverseParticleMatrix(matrix),
    scale,
    shapeScale: mode === 2 ? hierarchyScale : [1, 1, 1],
    rotation,
    renderBasis: rotationColumns(rotation).flat(),
    localQuaternion: { x: local[0], y: local[1], z: local[2], w: local[3] },
    localRotation: childLocalRotation({
      x: local[0],
      y: local[1],
      z: local[2],
      w: local[3],
    }).flat(),
  };
}
/** Update1b measures against unscaled frame time and retains the previous
 * velocity at tiny/zero deltas. Update2 then commits the current position. */
export function particleEmitterVelocity(
  origin: V,
  previous: V,
  frameDelta: number,
  velocity: V,
): V {
  const dt = frameDelta;
  return dt > 0.0001 ? origin.map((v, i) => (v - previous[i]) / dt) : velocity.slice();
}
