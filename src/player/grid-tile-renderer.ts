/** Sample each panorama tile at its authored transform. A pixel on a shared
 * edge belongs to one quad, even when the edge falls between device pixels. */
export class GridTileRenderer {
  private patterns = new WeakMap<CanvasImageSource, CanvasPattern>();

  draw(
    ctx: CanvasRenderingContext2D,
    image: CanvasImageSource,
    width: number,
    height: number,
    left: number,
    top: number,
    w: number,
    h: number,
    uv: readonly number[] = [0, 0, 1, 1],
  ) {
    const matrix = ctx.getTransform();
    const x0 = matrix.a * left + matrix.e,
      x1 = matrix.a * (left + w) + matrix.e;
    const y0 = matrix.d * top + matrix.f,
      y1 = matrix.d * (top + h) + matrix.f;
    const firstPixel = (a: number, b: number) => Math.ceil(Math.min(a, b) - 0.5);
    const lastPixel = (a: number, b: number) => Math.ceil(Math.max(a, b) - 0.5);
    const x = firstPixel(x0, x1),
      y = firstPixel(y0, y1);
    const right = lastPixel(x0, x1),
      bottom = lastPixel(y0, y1);
    if (right <= x || bottom <= y) return;

    let pattern = this.patterns.get(image);
    if (!pattern) {
      // Replicate the border texels for bilinear filtering at UV 0 and 1.
      // The center and eight gutter rectangles never overlap in the texture.
      const padded = document.createElement('canvas');
      padded.width = width + 2;
      padded.height = height + 2;
      const p = padded.getContext('2d')!;
      const xs = [
        [0, 1, 0],
        [0, width, 1],
        [width - 1, 1, width + 1],
      ];
      const ys = [
        [0, 1, 0],
        [0, height, 1],
        [height - 1, 1, height + 1],
      ];
      for (const [sy, sh, dy] of ys)
        for (const [sx, sw, dx] of xs) p.drawImage(image, sx, sy, sw, sh, dx, dy, sw, sh);
      pattern = ctx.createPattern(padded, 'repeat')!;
      this.patterns.set(image, pattern);
    }
    pattern.setTransform(
      matrix
        .translate(left, top)
        .scale(w / (width * uv[2]), h / (height * uv[3]))
        .translate(-1 - width * uv[0], -1 - height * uv[1]),
    );
    ctx.save();
    ctx.resetTransform();
    ctx.fillStyle = pattern;
    ctx.fillRect(x, y, right - x, bottom - y);
    ctx.restore();
  }
}
