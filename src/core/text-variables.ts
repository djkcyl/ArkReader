// VariableTranslater.TryTranslate 0x41E6520 and SimpleVariableGetter 0x417FE20.
export const textVariablePattern = /\{@([a-zA-Z0-9_.]+)}/g;
export function translateText(
  value: unknown,
  variables: Record<string, unknown>,
  nickname: string,
): string {
  return String(value ?? '').replace(textVariablePattern, (_whole, key: string) => {
    key = key.toLowerCase();
    if (key === 'nickname') return nickname;
    const v = Object.hasOwn(variables, key) ? variables[key] : null;
    if (v == null) return '';
    if (typeof v === 'boolean') return v ? 'True' : 'False';
    if (typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v))) return String(v);
    throw new Error('不支持的文本变量类型：' + key);
  });
}
