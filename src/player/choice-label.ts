import { lineAdvance } from '../core/line-breaking';
import { readingFont, readingMarkup } from '../core/sticker-color';

import { alignedTextOffset, layoutDialogText } from './dialog-layout';
import { stageSize } from './stage-geometry';

export function drawChoiceLabel(canvas: HTMLCanvasElement, text: string): void {
  const rect = stageSize(canvas);
  if (!rect.width || !rect.height) return;
  const ratio = window.devicePixelRatio || 1,
    scale = (rect.width * ratio) / 480;
  const width = 480 * scale,
    height = Math.ceil(rect.height * ratio);
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, height);
  const ctx = canvas.getContext('2d')!;
  const markup = readingMarkup(text),
    plain = markup?.plain ?? text;
  function layout(size: number) {
    const measured = layoutDialogText(ctx, plain, markup, width, size, 1, 1);
    return {
      ...measured,
      size,
      extent: measured.height,
      fits:
        measured.height <= height &&
        measured.lines.every((line) => line.every((g) => g.x + g.advance <= width)),
    };
  }
  // GetStringRenderInfo (0xA7FFD0) searches integer raster sizes in the
  // serialized best-fit range. The starting candidate is the regular font size.
  let low = Math.max(1, Math.min(500, Math.floor(2 * scale)));
  let high = Math.max(low, Math.min(500, Math.floor(300 * scale)));
  let fitted = layout(Math.min(high, Math.max(low, Math.floor(25 * scale))));
  while (low < high) {
    if (fitted.fits) low = fitted.size;
    else high = Math.max(low, fitted.size - 1);
    fitted = layout(Math.ceil((low + high) / 2));
  }
  ctx.textBaseline = 'alphabetic';
  for (const [index, line] of fitted.lines.entries()) {
    const baseline = (height - fitted.extent) / 2 + fitted.baselines[index];
    const offset = alignedTextOffset(canvas.width, lineAdvance(line), 'center', 1);
    for (const glyph of line) {
      ctx.font = markup
        ? readingFont(markup, glyph.index, fitted.size)
        : fitted.size + 'px ArkNative';
      ctx.fillStyle = markup?.colors[glyph.index] ?? '#fff';
      ctx.fillText(glyph.char, offset + glyph.x, baseline);
    }
  }
}
