/** Command.TryGetParam(float[]) RVA 0x419B020: stringify, trim, split on
 * commas, discard empty fields and parse each float. JSON arrays stringify
 * with brackets in Json.NET and consequently fail this conversion.
 */
export function nativeVector(
  value: unknown,
  field: 'posfrom' | 'posto' | 'poszoom',
): [number, number] {
  if (value === undefined) return [1, 1];
  const raw =
    typeof value === 'string'
      ? value
      : value === null
        ? ''
        : typeof value === 'object'
          ? JSON.stringify(value)
          : String(value);
  const tokens = raw
    .trim()
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!tokens.length) return [1, 1];
  const float = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
  if (tokens.length >= 2 && tokens.every((t) => float.test(t))) {
    return [Math.fround(Number(tokens[0])), Math.fround(Number(tokens[1]))];
  }
  // _ExecuteCharslot keeps the from/zoom sentinel after conversion failure,
  // while a nonempty malformed destination explicitly falls back to zero.
  return field === 'posto' ? [0, 0] : [1, 1];
}
