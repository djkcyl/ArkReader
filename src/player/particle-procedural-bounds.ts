import { particleEulerQuaternion } from './particle-rotation.ts';
import { childLocalRotation } from './particle-child.ts';
import { particleCurveRange, particleIntegratedCurveRange } from './particle-curve.ts';
import {
  expandParticleBounds,
  particleWorldBounds,
  type OrdinaryParticleBoundsInput,
} from './particle-bounds.ts';
const xyz = (v: any): number[] => [v.x, v.y, v.z];
/** Shared authored Euler rotation for both emission and visibility bounds. */
export const particleShapeRotation = particleEulerQuaternion;
function shapeMatrix(shape: any, rotationOnly = false): number[] {
  const [x, y, z, w] = particleShapeRotation(xyz(shape.m_Rotation)),
    columns = childLocalRotation({ x, y, z, w }),
    scale = rotationOnly ? [1, 1, 1] : xyz(shape.m_Scale);
  return columns
    .flatMap((col, i) => [...col.map((v) => v * scale[i]), 0])
    .concat(rotationOnly ? [0, 0, 0, 1] : [...xyz(shape.m_Position), 1]);
}
/** Transform the range with the same center/extent calculation as live bounds. */
export function transformParticleRange(bounds: number[], matrix: number[]): number[] {
  const { center, extent } = particleWorldBounds(bounds, matrix, 0);
  return [...center.map((v, i) => v - extent[i]), ...center.map((v, i) => v + extent[i])];
}
export function particleShapeBounds(
  shape: any,
  shapeScale: number[],
  travel: number[],
  initial: number[],
  meshBounds?: {
    center: number[];
    extent: number[];
  },
): number[] | undefined {
  const type = shape.type,
    r = shape.radius.value,
    sine = Math.sin(shape.angle * (Math.PI / 180));
  let bounds = initial.slice(),
    direction: number[];
  const symmetric = (x: number, y = x, z = x) => [-x, -y, -z, x, y, z];
  if (type === 0) bounds = symmetric(r);
  else if (type === 2) bounds = [-r, -r, 0, r, r, r];
  else if (type === 4) bounds = symmetric(r, r, 0);
  else if ([5, 15, 16].includes(type)) bounds = symmetric(0.5);
  else if ([6, 13, 14, 19, 20].includes(type)) {
    if (!meshBounds) return;
    bounds = [
      ...meshBounds.center.map((v, i) => v - meshBounds.extent[i]),
      ...meshBounds.center.map((v, i) => v + meshBounds.extent[i]),
    ];
  } else if (type === 8) {
    const radius = sine * shape.length + r;
    bounds = [
      -radius,
      -radius,
      0,
      radius,
      radius,
      Math.cos(shape.angle * (Math.PI / 180)) * shape.length,
    ];
  } else if (type === 10) bounds = symmetric(r, r, 0.1);
  else if (type === 12) bounds = symmetric(r, 0.1, 0.1);
  else if (type === 17)
    bounds = symmetric(shape.donutRadius + r, shape.donutRadius + r, shape.donutRadius);
  else if (type === 18) bounds = symmetric(0.5, 0.5, 0);
  else return;
  bounds = transformParticleRange(bounds, shapeMatrix(shape)).map((v, i) => v * shapeScale[i % 3]);
  const distance = travel.slice();
  if (shape.randomDirectionAmount > 0 && type !== 4 && type !== 7) {
    direction = symmetric(1);
    distance[0] = Math.abs(distance[0]);
    distance[1] = Math.abs(distance[1]);
  } else if ([0, 6, 10, 13, 14, 17].includes(type)) direction = symmetric(1);
  else if (type === 2) direction = [-1, -1, 0, 1, 1, 1];
  else if (type === 4 || type === 8) direction = [-sine, -sine, 0, sine, sine, 1];
  else if ([5, 15, 16, 18, 19, 20].includes(type)) direction = [0, 0, 0, 0, 0, 1];
  else if (type === 12) direction = [0, 0, 0, 0, 1, 0];
  else return;
  direction = transformParticleRange(direction, shapeMatrix(shape, true));
  for (let axis = 0; axis < 3; axis++) {
    bounds[axis] = Math.min(distance[1] * direction[axis] + bounds[axis], bounds[axis]);
    bounds[axis + 3] = Math.max(
      distance[1] * direction[axis + 3] + bounds[axis + 3],
      bounds[axis + 3],
    );
    const left = distance[0] * direction[axis],
      right = distance[0] * direction[axis + 3];
    bounds[axis] = Math.min(right, left, bounds[axis]);
    bounds[axis + 3] = Math.max(right, left, bounds[axis + 3]);
  }
  return bounds;
}
export function proceduralParticleBounds(
  c: OrdinaryParticleBoundsInput & {
    modules: Record<string, any>;
    inverse: number[];
    shapeScale: number[];
    emissionMeshBounds?: {
      center: number[];
      extent: number[];
    };
  },
): number[] | undefined {
  const m = c.modules,
    life = particleCurveRange(m.InitialModule.startLifetime)[1],
    speed = particleCurveRange(m.InitialModule.startSpeed),
    travel = speed.map((v) => v * life);
  let bounds = [0, 0, Math.min(0, ...travel), 0, 0, Math.max(0, ...travel)];
  if (m.ShapeModule.enabled) {
    const shape = particleShapeBounds(
      m.ShapeModule,
      c.shapeScale,
      travel,
      bounds,
      c.emissionMeshBounds,
    );
    if (!shape) return;
    bounds = shape;
  }
  const extend = (range: number[]) => {
    for (let i = 0; i < 3; i++) {
      bounds[i] = Math.min(bounds[i] + range[i], bounds[i]);
      bounds[i + 3] = Math.max(bounds[i + 3] + range[i + 3], bounds[i + 3]);
    }
  };
  const vector = (v: number[]) =>
    [0, 1, 2].map((i) => v[0] * c.inverse[i] + v[1] * c.inverse[i + 4] + v[2] * c.inverse[i + 8]);
  let gravity = [0, -9.81 * life * life * 0.5 * m.InitialModule.gravityModifier.scalar, 0];
  if (c.space !== 1) gravity = vector(gravity);
  extend([...gravity.map((v) => Math.min(0, v)), ...gravity.map((v) => Math.max(0, v))]);
  for (const name of ['VelocityModule', 'ForceModule']) {
    const module = m[name];
    if (!module.enabled) continue;
    const twice = name === 'ForceModule',
      ranges = ['x', 'y', 'z'].map((k) =>
        particleIntegratedCurveRange(module[k], twice).map((v) =>
          twice ? v * life * life : v * life,
        ),
      );
    let range = [...ranges.map((r) => r[0]), ...ranges.map((r) => r[1])];
    if (module.inWorldSpace) {
      const matrix = c.inverse.slice();
      matrix.splice(12, 3, 0, 0, 0);
      range = transformParticleRange(range, matrix);
    }
    extend(range);
  }
  if (c.renderMode === 1) {
    let stretch = Math.abs(c.velocityScale);
    if (speed[1] > 0.00001)
      stretch =
        stretch +
        (Math.abs(c.lengthScale) *
          particleCurveRange(m.InitialModule[c.size3D ? 'startSizeY' : 'startSize'])[1]) /
          speed[1];
    const radius = speed[1] * stretch;
    bounds = bounds.map((v, i) => (i < 3 ? v - radius : v + radius));
  }
  return expandParticleBounds(bounds, c);
}
