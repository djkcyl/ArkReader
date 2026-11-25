export function stampParagraphs(text: string): string[] | undefined {
  const parts: string[] = [];
  let end = 0;
  for (const match of text.matchAll(/<p=([12])>([^<>]*)<\/>/g)) {
    if (match.index !== end || parts[Number(match[1]) - 1] !== undefined) return undefined;
    parts[Number(match[1]) - 1] = match[2].replace(/\\n/g, '\n');
    end = match.index + match[0].length;
  }
  return end === text.length && end > 0 ? parts : undefined;
}
