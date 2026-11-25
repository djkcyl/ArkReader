/** Preserve significant whitespace. Numeric character suffixes are normalized
 * when selecting a sprite, not by silently trimming the asset's lookup key. */
export function resourceKey(value: unknown): string {
  return String(value ?? '')
    .replace(/\\/g, '/')
    .split('/')
    .at(-1)!
    .replace(/\.(png|jpg|wav|ogg)$/i, '')
    .toLowerCase();
}
