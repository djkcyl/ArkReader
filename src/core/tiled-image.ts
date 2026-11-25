/** UGUI Image.GenerateTiledSprite (0x6E8A1B0), centre region of a borderless
 * sprite. Positions are referenced to the bottom-left of the adjusted rect. */
export function tileSize(
  width: number,
  height: number,
  nativeWidth: number,
  nativeHeight: number,
  repeatUV = false,
): [number, number] {
  const columns = Math.ceil(width / nativeWidth),
    rows = Math.ceil(height / nativeHeight);
  if (repeatUV || columns * rows <= 16250) return [nativeWidth, nativeHeight];
  const ratio = columns / rows;
  return [
    width / Math.max(1, Math.floor(Math.sqrt(16250 * ratio))),
    height / Math.max(1, Math.floor(Math.sqrt(16250 / ratio))),
  ];
}

export function* tileQuads(
  left: number,
  top: number,
  width: number,
  height: number,
  tw: number,
  th: number,
) {
  for (let row = 0; row < Math.ceil(height / th); row++) {
    const h = Math.min(th, height - row * th),
      y = top + height - row * th - h;
    for (let col = 0; col < Math.ceil(width / tw); col++) {
      const w = Math.min(tw, width - col * tw);
      yield {
        rect: [left + col * tw, y, w, h] as [number, number, number, number],
        uv: [0, 1 - h / th, w / tw, h / th] as [number, number, number, number],
      };
    }
  }
}
