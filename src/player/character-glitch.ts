/** AVGGlitchMaterialSettings / AVGMaterialTweenWrapper.Batch (linear, parallel). */
export interface GlitchPreset {
  glichSpeed: number;
  glichThreshold: number;
  glichIntensity: number;
  glichLineNum: number;
  maskColor: {
    r: number;
    g: number;
    b: number;
    a: number;
  };
  filterColor: {
    r: number;
    g: number;
    b: number;
    a: number;
  };
  lineColor: {
    r: number;
    g: number;
    b: number;
    a: number;
  };
}
export const glitchPresetNames = [
  'glitch_none',
  ...['green', 'blue', 'red'].flatMap((color) =>
    ['weak', 'middle', 'strong'].map((level) => `${color}screen_${level}`),
  ),
];
export function copyGlitch(p: GlitchPreset): GlitchPreset {
  return structuredClone(p);
}
export function interpolateGlitch(a: GlitchPreset, b: GlitchPreset, t: number): GlitchPreset {
  const result = copyGlitch(a),
    lerp = (x: number, y: number) => x + (y - x) * Math.max(0, Math.min(1, t));
  for (const k of ['glichSpeed', 'glichThreshold', 'glichIntensity', 'glichLineNum'] as const)
    result[k] = lerp(a[k], b[k]);
  for (const k of ['maskColor', 'filterColor', 'lineColor'] as const)
    for (const c of ['r', 'g', 'b', 'a'] as const) result[k][c] = lerp(a[k][c], b[k][c]);
  return result;
}
