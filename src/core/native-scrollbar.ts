export const clampScrollbar = (v: number) => Math.max(0, Math.min(1, v));
export function scrollbarPage(value: number, size: number, towardTop: boolean): number {
  return clampScrollbar(value + (towardTop ? size : -size));
}
export function scrollbarDrag(
  pointerFromBottom: number,
  offset: number,
  trackHeight: number,
  size: number,
): number | undefined {
  const travel = (1 - size) * trackHeight;
  if (travel <= 0) return undefined;
  return clampScrollbar((pointerFromBottom - offset - size * trackHeight * 0.5) / travel);
}
/** Original EventSystem default is 10 screen pixels, not the usual Unity 5.
 * PointerInputModule.ShouldStartDrag uses >= on squared distance. */
export function scrollbarStartsDrag(dx: number, dy: number, threshold = 10): boolean {
  return dx * dx + dy * dy >= threshold * threshold;
}
