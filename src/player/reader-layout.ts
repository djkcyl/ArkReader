import type { ReaderCell } from '../core/reader-model';
import { readingMarkup } from '../core/sticker-color';
import { layoutDialogText, textCanvasPixelHeight } from './dialog-layout';

// avg_reader_text_item and avg_reader_main_dialog from avg/[uc]common.ab.
export const READER_LAYOUT = {
  padding: 300,
  bottom: 47.1521,
  left: 5,
  width: 1220,
  nameWidth: 237.7612,
  textX: 283.200012,
  textY: 3.990047,
  textWidth: 924.5979,
  optionX: 245.170059,
  optionWidth: 962.630005,
  optionStep: 178 / 3,
};
export function readerCellText(cell: ReaderCell): string {
  return cell.decision
    ? cell.text
        .split(';')
        .map((s, i) => (i === cell.decisionIndex ? `<color=#00a0e9>【${s}】</color>` : `【${s}】`))
        .join('\n')
    : cell.text;
}
export function measureReaderCell(
  ctx: CanvasRenderingContext2D,
  cell: ReaderCell,
  size: number,
  scale: number,
  nameSize = 30,
  pixelRatio = 1,
): number {
  const nameMarkup = readingMarkup(cell.name),
    nameText = nameMarkup?.plain ?? cell.name;
  const name = layoutDialogText(
    ctx,
    nameText,
    nameMarkup,
    READER_LAYOUT.nameWidth,
    nameSize,
    scale,
    0.7,
    24,
  );
  if (cell.decision && cell.decisionIndex < 0)
    return (
      layoutDialogText(ctx, '', undefined, READER_LAYOUT.nameWidth, size, scale, 0.7).height +
      cell.text.split(';').length * READER_LAYOUT.optionStep
    );
  // main_texta7862e.bytes: COMMON_AVGREADER_ENDTIP_SPACE is four newlines.
  const raw = cell.endtip ? '\n\n\n\n' : readerCellText(cell),
    markup = readingMarkup(raw),
    body = layoutDialogText(
      ctx,
      markup?.plain ?? raw,
      markup,
      READER_LAYOUT.textWidth,
      size,
      scale,
      0.9,
    );
  if (cell.endtip) return body.height + 3;
  return Math.max(
    nameText ? textCanvasPixelHeight(name, nameSize, scale, pixelRatio) / (scale * pixelRatio) : 0,
    READER_LAYOUT.textY +
      textCanvasPixelHeight(body, size, scale, pixelRatio) / (scale * pixelRatio),
  );
}
export function readerVisibleRange(
  tops: readonly number[],
  heights: readonly number[],
  top: number,
  bottom: number,
): [number, number] {
  let lo = 0,
    hi = tops.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (tops[mid] + heights[mid] < top) lo = mid + 1;
    else hi = mid;
  }
  const first = lo;
  hi = tops.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (tops[mid] <= bottom) lo = mid + 1;
    else hi = mid;
  }
  return [first, lo];
}
