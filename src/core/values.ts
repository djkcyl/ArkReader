/** System.Convert.ToBoolean primitive semantics used by native Command helpers. */
export function nativeBoolean(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const text = value.trim().toLowerCase();
    if (text === 'true') return true;
    if (text === 'false') return false;
  }
  throw new Error(`无法转换为原版布尔值：${String(value)}`);
}

/** .NET/JToken Int32 conversion: integral strings, checked range, ties-to-even. */
export function nativeInt(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'string' && !/^[+-]?\d+$/.test(value.trim()))
    throw new Error('无效原版整数：' + value);
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error('无效原版整数：' + String(value));
  const low = Math.floor(n),
    fraction = n - low,
    result = fraction < 0.5 ? low : fraction > 0.5 ? low + 1 : low + Math.abs(low % 2);
  if (result < -2147483648 || result > 2147483647) throw new Error('原版整数超出范围');
  return result;
}
