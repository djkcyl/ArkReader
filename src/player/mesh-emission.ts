import type { ParticleRandom } from './particle-math.ts';

export function randomEmissionVertex(triangles: number[][], random: ParticleRandom): number {
  const triangle = triangles[random.uint() % triangles.length];
  return triangle[random.uint() % 3];
}

export function emissionVertexColor(initial: number[], meshBytes: number[]): number[] {
  return initial.map((v, i) => (v * meshBytes[i]) / 255);
}

type SurfaceMesh = {
  positions: number[][];
  normals: number[][];
  colorBytes?: number[][];
  triangles: number[][];
};

const areaTables = new WeakMap<SurfaceMesh, number[]>();

/** ShapeModule::DidModifyMeshData uses cumulative local-space triangle areas. */
export function meshAreaEnds(mesh: SurfaceMesh): number[] {
  const cached = areaTables.get(mesh);
  if (cached) return cached;
  const ends: number[] = [];
  let total = 0;
  mesh.triangles.forEach(([a, b, c], i) => {
    const origin = mesh.positions[a],
      u = mesh.positions[b].map((v, j) => v - origin[j]),
      v = mesh.positions[c].map((x, j) => x - origin[j]);
    const cross = [0, 1, 2].map((j) => {
      const k = (j + 1) % 3,
        l = (j + 2) % 3;
      return u[k] * v[l] - u[l] * v[k];
    });
    total += 0.5 * Math.hypot(...cross);
    ends[i] = total;
  });
  areaTables.set(mesh, ends);
  return ends;
}

/** Select by triangle area, then interpolate position, normal and color. */
export function randomSurfacePoint(mesh: SurfaceMesh, random: ParticleRandom) {
  const ends = meshAreaEnds(mesh),
    at = random.value() * ends[ends.length - 1];
  let lo = 0,
    hi = ends.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (ends[mid] >= at) hi = mid;
    else lo = mid + 1;
  }
  const ids = mesh.triangles[lo];
  let u = random.value(),
    v = random.value();
  if (u + v > 1) {
    u = 1 - u;
    v = 1 - v;
  }
  const w = 1 - u - v;
  const interpolate = (data: number[][]) =>
    [0, 1, 2].map((i) => w * data[ids[2]][i] + (v * data[ids[1]][i] + u * data[ids[0]][i]));
  const weights = [u, v, w];
  const bytes = mesh.colorBytes;
  const color = bytes
    ? [0, 1, 2, 3].map((i) => ids.reduce((sum, id, j) => sum + weights[j] * bytes[id][i], 0))
    : undefined;
  return { position: interpolate(mesh.positions), normal: interpolate(mesh.normals), color };
}

/** GetPositionMesh<Triangle,Edge,ColorRGBA32> uses the same area table as
 * surface emission. Its residual face sample traverses three equal edge
 * intervals, independent of their lengths, and consumes no further RNG. */
export function randomMeshEdgePoint(mesh: SurfaceMesh, random: ParticleRandom) {
  const ends = meshAreaEnds(mesh),
    at = random.value() * ends[ends.length - 1];
  let face = 0;
  while (face < ends.length - 1 && ends[face] < at) face++;
  const ids = mesh.triangles[face],
    start = face ? ends[face - 1] : 0,
    weight = ends[face] - start;
  const t = weight > 0 ? ((at - start) / weight) * 3 : 0;
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  const a = clamp(t - 1),
    b = clamp(t - 2);
  const weights = [clamp(1 - t) + b, clamp(t) - a, a - b];
  const interpolate = (data: number[][]) =>
    [0, 1, 2].map(
      (i) =>
        weights[2] * data[ids[2]][i] +
        (weights[1] * data[ids[1]][i] + weights[0] * data[ids[0]][i]),
    );
  const bytes = mesh.colorBytes;
  const color = bytes
    ? [0, 1, 2, 3].map((i) => ids.reduce((sum, id, j) => sum + weights[j] * bytes[id][i], 0))
    : undefined;
  return { position: interpolate(mesh.positions), normal: interpolate(mesh.normals), color };
}
