import { layoutStickerText, type GlyphLine } from '../core/line-breaking';
import { readingFont, type StickerColorText } from '../core/sticker-color';
import { nativeLineMetrics } from '../core/font-metrics';

export interface DialogLines {
  lines: GlyphLine[];
  height: number;
  ascent: number;
  spacing: number;
  baselines: number[];
  fontSize: number;
  scale: number;
}

/** Shared backing height for text canvases and the rows that contain them. */
export function textCanvasPixelHeight(
  layout: DialogLines,
  size: number,
  scale: number,
  pixelRatio = 1,
): number {
  return Math.ceil(Math.max(layout.height + 5, size) * scale * pixelRatio);
}

// GetTextOffset anchors the rect and FixLineHorizontalOffset offsets the
// individual line. Both round to raster pixels before adding the positions.
export function alignedTextOffset(
  width: number,
  advance: number,
  alignment: string,
  scale: number,
): number {
  const fraction = alignment === 'center' ? 0.5 : alignment === 'right' ? 1 : 0;
  return (
    (Math.round(Math.fround(width * scale * fraction)) -
      Math.round(Math.fround(advance * scale * fraction))) /
    scale
  );
}

/** Measured at the dynamic font's raster size, returned in 1280×720 canvas units. */
export function layoutDialogText(
  ctx: CanvasRenderingContext2D,
  text: string,
  markup: StickerColorText | undefined,
  width: number,
  size: number,
  scale: number,
  lineSpacing: number,
  minSize = size,
): DialogLines {
  let raster = Math.max(1, Math.floor(size * scale));
  const minRaster = Math.max(1, Math.floor(minSize * scale));
  ctx.save();
  ctx.fontKerning = 'none';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const measure = (char: string, index: number) => {
    ctx.font = markup ? readingFont(markup, index, raster) : raster + 'px ArkNative';
    const m = ctx.measureText(char);
    return {
      advance: Math.round(m.width) / scale,
      left: -m.actualBoundingBoxLeft / scale,
      right: m.actualBoundingBoxRight / scale,
    };
  };
  // WordWrap clears the horizontal-fit flag when it must break a single
  // uninterrupted word. The name Text allows integer sizes down to 25.
  if (raster > minRaster) {
    const words = text.matchAll(/[^ \t\n]+/gu);
    for (const word of words) {
      while (raster > minRaster) {
        let advance = 0,
          index = word.index;
        for (const char of word[0]) {
          advance += measure(char, index).advance;
          index += char.length;
        }
        if (advance <= width) break;
        raster--;
      }
    }
  }
  ctx.font = raster + 'px ArkNative';
  const tabWidth = Math.trunc(Math.fround(ctx.measureText(' ').width * 4)) / scale;
  const lines = layoutStickerText(text, width > 0 ? width : Infinity, measure, tabWidth);
  const { ascent, spacing } = nativeLineMetrics(raster, lineSpacing);
  // RegisterNewLine falls back to the font's original size (16) when a
  // first glyph overflows before any character belongs to the wrapped line.
  const baselines: number[] = [];
  let baseline = 0,
    previousDescent = 0,
    height = 0;
  for (const line of lines) {
    const metrics = nativeLineMetrics(line.emptyWrap ? 16 : raster, lineSpacing);
    const leading =
      Math.round((line.emptyWrap ? 16 : raster) * 1.5) - (metrics.ascent - metrics.descent);
    baseline += baselines.length
      ? Math.round(
          Math.fround(
            Math.fround(metrics.ascent - previousDescent + leading) * Math.fround(lineSpacing),
          ),
        )
      : metrics.ascent;
    baselines.push(baseline / scale);
    height = Math.max(height, (baseline - metrics.descent) / scale);
    previousDescent = metrics.descent;
  }
  ctx.restore();
  return {
    lines,
    height,
    ascent: ascent / scale,
    spacing: spacing / scale,
    baselines,
    fontSize: raster / scale,
    scale,
  };
}
