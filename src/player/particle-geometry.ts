/** Mesh alignment Local: scale the authored mesh, rotate around the default
 * particle axis +Z, then apply emitter rotation. Unlike billboards, these
 * vertices are not clipped by maxParticleSize. Native matrix RVA 0xE90780. */
// EffectCanvas: ScreenSpaceCamera, planeDistance=100; AVGCamera_Scene z=-10.
// UI::Canvas::AlignCanvasRectTransformWithCamera (0xC4F500) puts it at z=90.
export const EFFECT_WORLD_Z = 90,
  SCENE_CAMERA_Z = -10;
export function meshVertexOffset(
  vertex: number[],
  size: number[],
  angle: number | number[],
): number[] {
  if (Array.isArray(angle)) {
    const [ax, ay, az] = angle,
      [x, y, z] = vertex.map((v, i) => v * size[i]);
    const zx = x * Math.cos(az) - y * Math.sin(az),
      zy = x * Math.sin(az) + y * Math.cos(az),
      xy = zy * Math.cos(ax) - z * Math.sin(ax),
      xz = zy * Math.sin(ax) + z * Math.cos(ax);
    return [zx * Math.cos(ay) + xz * Math.sin(ay), xy, -zx * Math.sin(ay) + xz * Math.cos(ay)];
  }
  const x = vertex[0] * size[0],
    y = vertex[1] * size[1],
    c = Math.cos(angle),
    s = Math.sin(angle);
  return [x * c - y * s, x * s + y * c, vertex[2] * size[2]];
}
/** MeshRenderLocal prepares the pivot in mesh coordinates from current
 * unscaled particle size, before MeshMatrices applies the normal vertex matrix. */
export function meshPivotOffset(
  pivot: {
    x: number;
    y: number;
    z: number;
  },
  rawSize: number[],
): number[] {
  return [pivot.x * rawSize[0], -pivot.z * rawSize[1], pivot.y * rawSize[2]];
}
/** Velocity mesh kernel 0xE923A0: build a world-space basis from total
 * velocity, then apply particle rotation and size within that basis. */
export function velocityMeshOffset(
  vertex: number[],
  size: number[],
  rotation: number | number[],
  worldVelocity: number[],
): number[] {
  const unit = (v: number[], fallback: number[]) => {
    const length = Math.hypot(...v);
    return length * length > 1e-30 ? v.map((x) => x / length) : fallback;
  };
  const forward = unit(worldVelocity, [0, 0, 1]),
    right = unit([forward[2], 0, -forward[0]], [1, 0, 0]);
  const up = [
    forward[1] * right[2] - forward[2] * right[1],
    forward[2] * right[0] - forward[0] * right[2],
    forward[0] * right[1] - forward[1] * right[0],
  ];
  const [x, y, z] = meshVertexOffset(vertex, size, rotation);
  return right.map((v, i) => v * x + up[i] * y + forward[i] * z);
}
export interface StretchOptions {
  position: number[];
  velocity: number[];
  size: number[];
  scale: number[];
  pivot: number[];
  lengthScale: number;
  velocityScale: number;
  minParticleSize: number;
  maxParticleSize: number;
}
/** Legacy (non-freeform) stretch kernels 0xE98540 / 0xE96CF0. The head stays
 * at the particle, length follows 3D velocity, and U runs head-to-tail. Screen
 * limits clamp cross-section size, not the stretched length. */
export function stretchedVertices(
  o: StretchOptions,
  camera = { x: 0, y: 0 },
  ui = false,
): {
  vertices: number[][];
  uv: number[][];
} {
  const [sx, sy, sz] = o.scale.slice(),
    [w, h] = o.size.slice(),
    v = [o.velocity[0], o.velocity[1], -o.velocity[2]];
  // UI uses ParticleGeometryUtils, whose size clamp precedes lossyScale and
  // whose camera-facing width matrix scales X/Y. Scene jobs use X/Z instead.
  const maxSize = Math.max(w, h, ui ? 1e-5 : 1e-6),
    minimum = ui ? o.minParticleSize * 720 : (o.minParticleSize / Math.max(sx, 1e-5)) * 7.2,
    maximum = ui ? o.maxParticleSize * 720 : (o.maxParticleSize / Math.max(sx, 1e-5)) * 7.2;
  let half = minimum >= 0 ? Math.max(maxSize, minimum) * 0.5 : 0;
  if (maximum >= 0) half = Math.min(half, maximum * 0.5);
  const halfWidth = w * (half / maxSize);
  const speed2 = v[1] * v[1] + v[2] * v[2] + v[0] * v[0],
    inv = speed2 > 1e-10 ? 1 / Math.sqrt(speed2) : 0;
  const amount = h * o.lengthScale * sx * inv + o.velocityScale,
    pivotAlong = inv * o.pivot[1] * 2 * h;
  const head = [
    o.position[0] + camera.x * 0.01,
    o.position[1] + camera.y * 0.01,
    SCENE_CAMERA_Z - o.position[2],
  ].map((p, i) => p + v[i] * pivotAlong);
  const tail = head.map((p, i) => p - v[i] * amount),
    nx = head[2] * tail[1] - head[1] * tail[2],
    ny = tail[2] * head[0] - tail[0] * head[2];
  const n2 = nx * nx + ny * ny,
    normalize = n2 > 1e-10 ? 1 / Math.sqrt(n2) : 0;
  const side = [halfWidth * nx * normalize, halfWidth * ny * normalize],
    pivotAcross = o.pivot[0] * 2;
  for (let i = 0; i < 2; i++) {
    const shift = side[i] * pivotAcross;
    head[i] = head[i] + shift;
    tail[i] = tail[i] + shift;
  }
  const offset = [side[0] * sx, side[1] * (ui ? sy : sz)];
  const point = (p: number[], sign: number) => [
    p[0] + offset[0] * sign - camera.x * 0.01,
    p[1] + offset[1] * sign - camera.y * 0.01,
    SCENE_CAMERA_Z - p[2],
  ];
  return {
    vertices: [point(head, 1), point(tail, 1), point(tail, -1), point(head, -1)],
    uv: [
      [0, 1],
      [1, 1],
      [1, 0],
      [0, 0],
    ],
  };
}
/** Velocity-facing billboard, UnityPlayer 0xEAF030. The emitter transforms
 * the normal and tangent independently before the job constructs the third axis. */
export function velocityQuad(
  velocity: number[],
  size: number[],
  angles: number[],
  transform: (v: number[]) => number[],
  pivotOffset: number[] = [0, 0, 0],
): number[][] {
  const unit = (v: number[], fallback: number[]) => {
    const length = Math.hypot(...v);
    return length * length > 1e-30 ? v.map((c) => c / length) : fallback;
  };
  const direction = unit(velocity, [0, 0, 1]);
  const normal = unit(transform(direction), [0, 0, 1]);
  const right = unit(transform([-direction[1], direction[0], 0]), [1, 0, 0]);
  const up = [
    normal[1] * right[2] - normal[2] * right[1],
    normal[2] * right[0] - normal[0] * right[2],
    normal[0] * right[1] - normal[1] * right[0],
  ];
  const rotation = angles.map((a) => -a);
  return [
    [-0.5, 0.5, 0],
    [0.5, 0.5, 0],
    [0.5, -0.5, 0],
    [-0.5, -0.5, 0],
  ].map((corner) => {
    // VelocityRender computes this shift from the unclamped size, then the
    // quad kernel rotates it together with the screen-clamped corners.
    const shifted = corner.map((v, i) => v * (size[i] ?? 1) + pivotOffset[i]);
    const [x, y, z] = meshVertexOffset(shifted, [1, 1, 1], rotation);
    return right.map((r, i) => r * x + up[i] * y + normal[i] * z);
  });
}
/** ParticleSystem::Emit, 0xAC4D88–0xAC5105. The world forward/up
 * vectors include emitter scale; the final local rotation has no scale. */
export function childEmitterAxes(velocity: number[], forward: number[], up: number[]): number[][] {
  const identity = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ],
    v = velocity.slice(),
    squared = (v: number[]) => v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
  const length = Math.sqrt(squared(v));
  if (length <= 1e-5) return identity;
  const initial = v.map((x) => x / length),
    weight = Math.abs(initial[0] * forward[0] + initial[1] * forward[1] + initial[2] * forward[2]);
  const hint = forward.map((x, i) => x * (1 - weight) + up[i] * weight);
  const z = initial;
  const cross = (a: number[], b: number[]) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const right = cross(hint, z),
    rightNorm = Math.sqrt(squared(right));
  if (rightNorm < 1e-5) return identity;
  const x = right.map((v) => v / rightNorm),
    y = cross(z, x);
  return [x, y, z];
}
