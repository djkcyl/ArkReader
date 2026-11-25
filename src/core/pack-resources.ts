/** Keep missing bindings separate from failed downloads/decodes. */
export function requirePackResources(pack: { missing: string[]; errors: unknown[] }): void {
  if (!pack.missing.length && !pack.errors.length) return;
  const messages = ['剧情资源不完整，尚未开始播放。'];
  if (pack.missing.length) messages.push('当前资源中未找到：' + pack.missing.join('、') + '。');
  if (pack.errors.length) {
    const details = pack.errors.map((value) => {
      if (value && typeof value === 'object') {
        const record = value as Record<string, unknown>;
        return (
          [record.bundle, record.error]
            .filter((v) => v != null)
            .map(String)
            .join('：') || JSON.stringify(value)
        );
      }
      return String(value);
    });
    messages.push('资源准备失败：' + details.join('；') + '。可重试加载。');
  } else messages.push('可选择其他剧情；缺失资源可用后再重试。');
  throw new Error(messages.join('\n'));
}
