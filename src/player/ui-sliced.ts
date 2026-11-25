export interface UISlice {
  border: number[];
  padding: number[];
  inner: number[];
  fillCenter: boolean;
}
// Image.GenerateSlicedSprite: borders and padding are in canvas units;
// shrinking a rect scales both opposite borders together, never the UVs.
export function slicedQuads(width: number, height: number, uv: number[], slice: UISlice) {
  const b = [...slice.border],
    p = slice.padding,
    inner = slice.inner;
  for (let axis = 0; axis < 2; axis++) {
    const size = axis ? height : width,
      sum = b[axis] + b[axis + 2];
    if (sum > size && sum !== 0) {
      b[axis] *= size / sum;
      b[axis + 2] *= size / sum;
    }
  }
  const x = [p[0], b[0], width - b[2], width - p[2]],
    y = [p[1], b[1], height - b[3], height - p[3]],
    u = [uv[0], inner[0], inner[2], uv[2]],
    v = [uv[1], inner[1], inner[3], uv[3]];
  const quads: number[][] = [];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      if (slice.fillCenter || i !== 1 || j !== 1)
        quads.push([x[i], y[j], x[i + 1], y[j + 1], u[i], v[j], u[i + 1], v[j + 1]]);
  return quads;
}
