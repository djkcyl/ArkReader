/** AVGUtils.CreateRotateTween (0x41959A0): directed world-Z addition,
 * RotateMode.WorldAxisAdd=3. inverse selects positive travel; circles are added
 * in that direction. This is deliberately not shortest-path interpolation. */
export function imageRotationDelta(
  from: number,
  to: number,
  inverse: boolean,
  circles: number,
): number {
  const repeat = (a: number) => Math.max(0, Math.min(360, a - Math.floor(a / 360) * 360));
  let delta = repeat(repeat(to) - repeat(from));
  if (delta > 180) delta = delta - 360;
  if (inverse) {
    if (delta < 0) delta = delta + 360;
    return delta + circles * 360;
  }
  if (delta > 0) delta = delta - 360;
  return delta - circles * 360;
}
