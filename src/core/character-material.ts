/** AVG_Char_AlphaSplit, native DXBC black-mask branch. Alpha is unchanged.
 * UV.y is measured from the bottom; invalid/equal endpoints disable the mask.
 */
export function blackMask(uvY: number, start: number, end: number, inverse = false): number {
  if (!(start >= 0 && start < end && end <= 1)) return 1;
  return Math.max(0, Math.min(1, (inverse ? uvY - start : end - uvY) / (end - start)));
}
