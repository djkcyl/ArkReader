/** SharedFormatUtil.FormatRichTextTag / RichTextIgnoreTagsHandler.
 * This is not HTML: unknown and mismatched closing tags remain literal. */
export function removeReaderRichText(text: string): string {
  return formatReaderText(text);
}

/** ListDict preserves authored insertion order, rather than sorting p IDs.
 * Reader spell stickers select key zero; AnimText joins the recorded values. */
export function splitReaderText(text: string): Map<number, string> {
  const paragraphs = new Map<number, string>();
  formatReaderText(text.replace(/\\n/g, '\n'), paragraphs);
  return paragraphs;
}

function formatReaderText(text: string, paragraphs?: Map<number, string>): string {
  let position = 0;
  const start = (tag: string) =>
    tag === 'b' ||
    tag === 'i' ||
    ['color', '@', '$', 'p='].some((prefix) => tag.startsWith(prefix));
  const end = (parent: string, tag: string) =>
    (parent === 'b' && tag === '/b') ||
    (parent === 'i' && tag === '/i') ||
    (parent.startsWith('color') && tag === '/color') ||
    ((parent.startsWith('@') || parent.startsWith('$')) && tag === '/');
  const read = (parent: string): string => {
    let result = '',
      tag = '',
      inside = false;
    while (position < text.length) {
      const char = text[position++];
      if (char === '<') {
        if (inside && tag.length) result += '<' + tag;
        tag = '';
        inside = true;
      } else if (char === '>' && inside) {
        inside = false;
        if (paragraphs && parent.startsWith('p=') && tag === '/') {
          const raw = parent.slice(2).trim(),
            id = Number(raw);
          if (/^[+-]?\d+$/.test(raw) && Number.isInteger(id) && id > 0 && id <= 2147483647)
            paragraphs.set(id - 1, result);
          return result;
        }
        if (parent && end(parent, tag))
          return paragraphs && (parent === 'b' || parent === 'i' || parent.startsWith('color'))
            ? '<' + parent + '>' + result + '<' + tag + '>'
            : result;
        result += start(tag) ? read(tag) : '<' + tag + '>';
        tag = '';
      } else if (inside) tag += char;
      else result += char;
    }
    if (tag.length) result += '<' + tag;
    return result;
  };
  return read('');
}
