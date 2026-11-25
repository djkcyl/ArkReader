// Font #360 and UnityPlayer RegisterNewLine (0xA83E60). The spacing setting
// multiplies the pixel-rounded line height before the second rounding step.
export function nativeLineMetrics(size: number, lineSpacing = 1) {
  return {
    ascent: Math.round(size * 0.88),
    descent: Math.round(size * -0.12),
    spacing: Math.round(Math.fround(Math.round(size * 1.5) * Math.fround(lineSpacing))),
  };
}
