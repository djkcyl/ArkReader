import { lineRules } from './line-rules.ts';
export interface GlyphBox {
  char: string;
  index: number;
  end: number;
  x: number;
  advance: number;
  left: number;
  right: number;
}
export interface GlyphLine extends Array<GlyphBox> {
  alignmentAdvance?: number;
  emptyWrap?: boolean;
}
export function lineAdvance(line: GlyphLine): number {
  const last = line.at(-1);
  return line.alignmentAdvance ?? (last ? f(last.x + last.advance) : 0);
}
const f = Math.fround;
/** UnityPlayer NativeTextGenerator::TryCompressLineForPunctuation, 0xA85060.
 * Only whitespace between ink bounds is removed; glyph shapes aren't scaled. */
export function compressPunctuation(
  glyphs: GlyphBox[],
  width: number,
  protectedFrom = -1,
  allowTail = true,
): boolean {
  const last = glyphs.length - 1,
    current = glyphs[last];
  if (width <= 0 || last < 1 || current.advance <= 0) return false;
  let need = f(f(current.x + current.advance) - width);
  if (need <= 0) return true;
  const ink = Math.max(f(current.right - current.x), 0),
    tail = allowTail && current.advance > ink ? f(current.advance - ink) : 0;
  let remaining = need,
    hypothetical = 0;
  for (let i = last - 1; i >= 0 && remaining > 1e-4; i--)
    if ((protectedFrom < 0 || i < protectedFrom) && glyphs[i].advance > 0) {
      const space = Math.max(f(f(glyphs[i + 1].left - hypothetical) - glyphs[i].right), 0),
        take = Math.min(remaining, space, glyphs[i].advance);
      remaining = f(remaining - take);
      hypothetical = f(hypothetical + take);
    }
  if (remaining > 1e-4 && f(remaining - Math.min(remaining, tail)) > 1e-4) return false;
  for (let i = last - 1; i >= 0 && need > 1e-4; i--)
    if ((protectedFrom < 0 || i < protectedFrom) && glyphs[i].advance > 0) {
      const space = Math.max(f(glyphs[i + 1].left - glyphs[i].right), 0),
        take = Math.min(need, space, glyphs[i].advance);
      if (take > 0) {
        for (let j = i + 1; j <= last; j++) {
          glyphs[j].x = f(glyphs[j].x - take);
          glyphs[j].left = f(glyphs[j].left - take);
          glyphs[j].right = f(glyphs[j].right - take);
        }
        glyphs[i].advance = f(glyphs[i].advance - take);
        need = f(need - take);
      }
    }
  if (need > 1e-4) current.advance = f(current.advance - Math.min(need, tail));
  return true;
}
function allowedStart(text: string, index: number, lineStart: number): boolean {
  return lineRules.allowed.some((rule) => {
    const start = index - rule.characterIndex;
    return start >= lineStart && text.startsWith(rule.token, start);
  });
}
export function forbiddenStart(
  text: string,
  index: number,
  lineStart: number,
): { start: number; end: number } | null {
  if (allowedStart(text, index, lineStart)) return null;
  for (const token of lineRules.start)
    for (let offset = 0; offset < token.length; offset++) {
      const start = index - offset;
      if (start >= lineStart && text.startsWith(token, start))
        return { start, end: start + token.length };
    }
  return null;
}
export function forbiddenEnd(text: string, index: number, lineStart: number): number | null {
  for (const token of lineRules.end)
    for (let offset = 0; offset < token.length; offset++) {
      const start = index - 1 - offset;
      if (start >= lineStart && text.startsWith(token, start)) return start;
    }
  return null;
}
function periodRun(text: string, index: number): number | null {
  if (text[index] !== '.') return null;
  let start = index,
    end = index + 1;
  while (start > 0 && text[start - 1] === '.') start--;
  while (end < text.length && text[end] === '.') end++;
  return end - start >= 4 ? start : null;
}
export interface GlyphMetrics {
  advance: number;
  left: number;
  right: number;
}
/** Portable glyph metrics feed the original punctuation compression rule.
 * Full font rasterization/shaping is still supplied by the browser canvas. */
export function layoutStickerText(
  text: string,
  width: number,
  measure: (char: string, index: number) => GlyphMetrics,
  tabWidth?: number,
): GlyphLine[] {
  const source: { char: string; index: number; end: number; metrics: GlyphMetrics }[] = [];
  let offset = 0;
  for (const char of text) {
    source.push({ char, index: offset, end: offset + char.length, metrics: measure(char, offset) });
    offset += char.length;
  }
  const lines: GlyphLine[] = [];
  let glyphs: GlyphLine = [],
    pen = 0,
    wrapPen = 0,
    wordStart = 0,
    breakEnd = 0,
    whitespace = 0;
  const fitStarts = new Map<GlyphBox, number>();
  const tab = (tabWidth ?? Math.trunc(f(measure(' ', 0).advance * 4))) || 16;
  const finish = (line: GlyphLine, advance?: number) => {
    if (advance !== undefined) {
      Object.defineProperty(line, 'alignmentAdvance', { value: advance });
      if (!line.length) Object.defineProperty(line, 'emptyWrap', { value: true });
    }
    lines.push(line);
  };
  for (const s of source) {
    if (s.char === '\n') {
      finish(glyphs);
      glyphs = [];
      pen = 0;
      wrapPen = 0;
      wordStart = 0;
      breakEnd = 0;
      whitespace = 0;
      continue;
    }
    const isSpace = s.char === ' ',
      isTab = s.char === '\t';
    if (isSpace || isTab) {
      if (!whitespace) breakEnd = glyphs.length - (isSpace ? 1 : 0);
      whitespace++;
    } else if (whitespace) {
      wordStart = glyphs.length;
      whitespace = 0;
    }
    const m = s.metrics,
      advance = isTab ? f((Math.floor(wrapPen / tab) + 1) * tab - wrapPen) : m.advance;
    // Native whitespace has explicit quad bounds even though it draws no ink:
    // spaces span their advance, while all four tab vertices sit at the tab end.
    const g: GlyphBox = {
      char: s.char,
      index: s.index,
      end: s.end,
      x: pen,
      advance,
      left: f(pen + (isTab ? advance : isSpace ? 0 : m.left)),
      right: f(pen + (isSpace || isTab ? advance : m.right)),
    };
    glyphs.push(g);
    fitStarts.set(g, wrapPen);
    if (!isSpace && width > 0 && f(wrapPen + advance) > width) {
      const lineStart = glyphs[0].index,
        token = forbiddenStart(text, s.index, lineStart),
        endToken = forbiddenEnd(text, s.index, lineStart),
        dots = periodRun(text, s.index);
      const protectedIndex = dots ?? token?.start ?? endToken;
      const protectedFrom =
        protectedIndex === null
          ? -1
          : glyphs.findIndex((x) => x.index >= Math.max(lineStart, protectedIndex));
      const previousX = glyphs.map((g) => g.x);
      if (
        !isTab &&
        protectedIndex !== null &&
        compressPunctuation(glyphs, width, protectedFrom, false)
      ) {
        for (const [i, glyph] of glyphs.entries())
          fitStarts.set(glyph, f(fitStarts.get(glyph)! + f(glyph.x - previousX[i])));
        pen = f(g.x + g.advance);
        wrapPen = pen;
        continue;
      }
      let cut = wordStart;
      const forced = cut === 0;
      if (cut === 0) {
        cut = glyphs.length - 1;
        if (token) {
          const start = glyphs.findIndex((x) => x.index >= token.start);
          cut = start > 0 ? start - 1 : 0;
        }
        if (endToken !== null) {
          const prior = forbiddenStart(text, endToken, lineStart),
            start = glyphs.findIndex((x) => x.index >= endToken);
          cut = prior?.start === endToken && start > 0 ? start - 1 : start;
        }
        if (dots !== null) {
          const start = glyphs.findIndex((x) => x.index >= dots);
          cut = start > 0 ? start - 1 : 0;
        }
        breakEnd = cut - 1;
      }
      const offset = glyphs[cut].x,
        end = glyphs[breakEnd],
        align = end ? f(end.x + end.advance) : 0;
      const fitOffset = isTab && forced ? f(wrapPen + advance) : fitStarts.get(glyphs[cut])!;
      wrapPen = f(wrapPen - fitOffset);
      finish(glyphs.slice(0, cut), align);
      glyphs = glyphs.slice(cut);
      for (const moved of glyphs) {
        fitStarts.set(moved, f(fitStarts.get(moved)! - fitOffset));
        moved.x = f(moved.x - offset);
        moved.left = f(moved.left - offset);
        moved.right = f(moved.right - offset);
      }
      wordStart = 0;
      breakEnd = 0;
    }
    pen = f(g.x + g.advance);
    wrapPen = f(wrapPen + advance);
  }
  // GenerateVertices registers the final sentinel too, including empty input
  // and the empty line following a trailing newline.
  finish(glyphs);
  return lines;
}
