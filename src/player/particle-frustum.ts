/** Orthographic story camera: half-height 3.6, 16:9 stage, z=-10,
 * near=.3, far=1000. Planes face inward in particle world coordinates. */
export function storyParticlePlanes(camera: { x: number; y: number }): number[][] {
  const x = camera.x * 0.01,
    y = camera.y * 0.01;
  return [
    [1, 0, 0, 6.4 + x],
    [-1, 0, 0, 6.4 - x],
    [0, 1, 0, 3.6 + y],
    [0, -1, 0, 3.6 - y],
    [0, 0, 1, 9.7],
    [0, 0, -1, 990],
  ];
}
/** An axis-aligned bound is visible unless it lies wholly outside a plane. */
export function particleFrustumVisible(
  center: number[],
  extent: number[],
  planes: number[][],
): boolean {
  return planes.every(([x, y, z, d]) => {
    const radius = Math.abs(y) * extent[1] + Math.abs(x) * extent[0] + Math.abs(z) * extent[2];
    const distance = x * center[0] + d + y * center[1] + z * center[2];
    return !(radius + distance < 0);
  });
}
