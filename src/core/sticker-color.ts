/** Supported style ranges in Unity TextGenerator markup. Indexes refer to
 * UTF-16 units, as in AVGTypeWriterText's original message string. */
export interface StickerColorText {
  plain: string;
  bold: boolean[];
  italic: boolean[];
  sourceIndex: number[];
  colors: string[];
  tagEnd: Map<number, number>;
}
export interface ReadingMarkup extends StickerColorText {
  raw: string;
}
export function readingMarkup(raw: string): ReadingMarkup | undefined {
  if (!/<(?:color=|i>|b>)/.test(raw)) return undefined;
  const colors: string[] = [],
    sourceIndex: number[] = [],
    tagEnd = new Map<number, number>();
  const stack: { tag: string; color: string; italic: boolean; bold: boolean }[] = [
    { tag: '', color: '#ffffff', italic: false, bold: false },
  ];
  const italic: boolean[] = [],
    bold: boolean[] = [],
    tags = /<color=(#[0-9a-fA-F]{6})>|<[bi]>|<\/(color|i|b)>/y;
  let plain = '';
  for (let i = 0; i < raw.length;) {
    if (raw[i] === '<') {
      tags.lastIndex = i;
      const tag = tags.exec(raw);
      if (!tag) return undefined;
      const current = stack[stack.length - 1];
      if (tag[1]) stack.push({ ...current, tag: 'color', color: tag[1] });
      else if (tag[0] === '<b>') stack.push({ ...current, tag: 'b', bold: true });
      else if (tag[0] === '<i>') stack.push({ ...current, tag: 'i', italic: true });
      else if (tag[2] === current.tag && stack.length > 1) stack.pop();
      else return undefined;
      tagEnd.set(i, tags.lastIndex);
      i = tags.lastIndex;
    } else {
      const style = stack[stack.length - 1];
      sourceIndex.push(i);
      colors.push(style.color);
      italic.push(style.italic);
      bold.push(style.bold);
      plain += raw[i++];
    }
  }
  return stack.length === 1 ? { plain, colors, sourceIndex, tagEnd, italic, bold, raw } : undefined;
}

export const stickerColorText = readingMarkup;

export function readingFont(markup: StickerColorText, index: number, size: number): string {
  const italic = markup.italic[index] ? 'italic ' : '',
    bold = markup.bold[index] ? 'bold ' : '';
  return italic + bold + size + 'px ArkNative';
}
