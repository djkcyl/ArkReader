/** AVGSharedCharacter._LoadImage: body suffix first, alias before numeric index.
 * RVAs 0x41FC550, 0x41FCCE0, 0x41FCFD0, 0x41FD0F0. Alias retains its '@'.
 */
export function parseCharacterKey(value: string): {
  key: string;
  index: number;
  alias: string | null;
  body: number;
} {
  let key = value;
  let body = -1;
  const suffix = (token: string): number | null => {
    const offset = key.lastIndexOf(token);
    if (offset < 0) return null;
    const text = key.slice(offset + 1).trim();
    if (!/^[+-]?[0-9]+$/.test(text)) return null;
    const number = Number(text);
    if (!Number.isInteger(number) || number < -2147483648 || number > 2147483647) return null;
    key = key.slice(0, offset);
    return (number - 1) | 0;
  };
  body = suffix('$') ?? -1;
  const at = key.lastIndexOf('@');
  if (at >= 0) return { key: key.slice(0, at), index: 0, alias: key.slice(at), body };
  const index = suffix('#') ?? 0;
  return { key, index, alias: null, body };
}
