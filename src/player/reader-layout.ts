import type { ReaderCell } from '../core/reader-model';
import { readingMarkup } from '../core/sticker-color';
import { layoutDialogText } from './dialog-layout';

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
): number {
  const name = layoutDialogText(
    ctx,
    cell.name,
    undefined,
    READER_LAYOUT.nameWidth,
    size,
    scale,
    0.7,
  ).height;
  if (cell.decision && cell.decisionIndex < 0)
    return name + cell.text.split(';').length * READER_LAYOUT.optionStep;
  // main_texta7862e.bytes: COMMON_AVGREADER_ENDTIP_SPACE is four newlines.
  const raw = cell.endtip ? '\n\n\n\n' : readerCellText(cell),
    markup = readingMarkup(raw);
  return Math.max(
    name,
    layoutDialogText(ctx, markup?.plain ?? raw, markup, READER_LAYOUT.textWidth, size, scale, 0.9)
      .height + 3,
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
