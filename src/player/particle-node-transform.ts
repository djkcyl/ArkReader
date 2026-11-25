import {
  particleTransformSetup,
  inverseParticleMatrix,
  type ParticleTransform,
} from './particle-transform.ts';
import { flipRotation, type EffectPose } from './effect-motion.ts';
import { EFFECT_WORLD_Z } from './particle-geometry.ts';
type V = number[];
interface Transform {
  m_LocalPosition: {
    x: number;
    y: number;
    z: number;
  };
  m_LocalScale: {
    x: number;
    y: number;
    z: number;
  };
  m_LocalRotation: {
    x: number;
    y: number;
    z: number;
    w: number;
  };
}
interface Node {
  transforms: Transform[];
  main?: {
    scalingMode?: number;
    ui?: boolean;
  };
}
const xyz = (v: { x: number; y: number; z: number }) => [v.x, v.y, v.z];
type Result = ReturnType<typeof calculate>;
const cache = new WeakMap<Node, Map<string, Result>>();
export function invalidateParticleTransform(node: Node) {
  cache.delete(node);
}
function calculate(node: Node, root: EffectPose) {
  const q = root.rotation ?? flipRotation(root.flip),
    mode = node.main?.scalingMode ?? 1;
  const chain: ParticleTransform[] = node.transforms.map((t, i) => ({
    position: i === 0 ? [root.x, root.y, root.z ?? 0] : xyz(t.m_LocalPosition),
    rotation:
      i === 0
        ? [q.x, q.y, q.z, q.w]
        : [t.m_LocalRotation.x, t.m_LocalRotation.y, t.m_LocalRotation.z, t.m_LocalRotation.w],
    scale: xyz(t.m_LocalScale),
  }));
  // Scene EffectCanvas is at z=90 with 0.01 world scale. UIParticle instead
  // simulates in UI units and converts its mesh into this shared draw space.
  if (!node.main?.ui)
    chain.unshift({
      position: [0, 0, EFFECT_WORLD_Z],
      rotation: [0, 0, 0, 1],
      scale: [0.01, 0.01, 0.01],
    });
  const input = { chain, mode },
    native = particleTransformSetup(chain, mode);
  if (!node.main?.ui) return { ...native, input };
  const matrix = native.matrix.map((v, i) => (i % 4 === 3 ? v : v * 0.01));
  matrix[14] = matrix[14] + EFFECT_WORLD_Z;
  return {
    ...native,
    matrix,
    inverse: inverseParticleMatrix(matrix),
    scale: native.scale.map((v) => v * 0.01),
    input,
  };
}
export function particleNodeTransform(node: Node, root: EffectPose) {
  const q = root.rotation ?? flipRotation(root.flip),
    key = [
      root.x,
      root.y,
      root.z ?? 0,
      q.x,
      q.y,
      q.z,
      q.w,
      node.main?.scalingMode ?? 1,
      !!node.main?.ui,
    ].join(',');
  let entries = cache.get(node);
  if (!entries) {
    entries = new Map();
    cache.set(node, entries);
  }
  let value = entries.get(key);
  if (!value) {
    value = calculate(node, root);
    if (entries.size >= 8) entries.clear();
    entries.set(key, value);
  }
  return value;
}
/** Transform positions and directions using the same cached matrix. */
export function particleMatrixVector(matrix: V, vector: V, point = false): V {
  const v = vector.slice();
  return [0, 1, 2].map((i) => {
    const value = matrix[i] * v[0] + matrix[i + 4] * v[1] + matrix[i + 8] * v[2];
    return point ? value + matrix[i + 12] : value;
  });
}
