/** Quantize only at byte-oriented resource/rendering boundaries. */
export function nativeColorByte(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 255);
}
export const nativeColorUnit = (value: number) => nativeColorByte(value) / 255;
