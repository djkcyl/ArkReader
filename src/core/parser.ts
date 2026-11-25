import JSON5 from 'json5';
import type { Command } from './scheduler';

// Recovered regex, AVGParser..cctor RVA 0x41CF830. No trimming before matching.
// Native RegexOptions is 256 (ECMAScript), not Compiled. Preserve its ASCII
// whitespace/word classes and .NET dot semantics (excludes LF only).
const commandPattern =
  /^\[[ \f\n\r\t\v]*(?:([^\n]*?)\(([^\n]*)\)|(?:([\.|\w]*)|([^\n]*)))[ \f\n\r\t\v]*\][ \f\n\r\t\v]*([^\n]*)/;
const commentPattern = /^\s* \/\/.*$/;

/** RVA 0x41CF700: only double quotes toggle the equals-sign replacement. */
export function replaceEquals(value: string): string {
  let quotes = 0;
  return [...value]
    .map((char, i, chars) => {
      if (char === '=' && quotes % 2 === 0) return ':';
      if (char === '"' && (i === 0 || chars[i - 1] !== '\\')) quotes++;
      return char;
    })
    .join('');
}

/** Observed Newtonsoft.Json 13 behavior: undefined values before commas, and
 * unsigned leading-zero integer literals. Do not normalize inside string literals.
 * This adapter targets the game's parameter corpus, not every Json.NET extension.
 */
export function parseParameters(source: string): Record<string, unknown> {
  let result = '';
  let quote = '';
  let expectingValue = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quote) {
      result += char;
      if (char === '\\' && i + 1 < source.length) result += source[++i];
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      expectingValue = false;
      result += char;
      continue;
    }
    if (char === ':') {
      expectingValue = true;
      result += char;
      continue;
    }
    if (expectingValue && /\s/.test(char)) {
      result += char;
      continue;
    }
    if (expectingValue && char === ',') {
      result += 'null,';
      expectingValue = false;
      continue;
    }
    if (expectingValue && source.startsWith('undefined', i)) {
      result += 'null';
      i += 8;
      expectingValue = false;
      continue;
    }
    if (expectingValue && /[+0-9.-]/.test(char)) {
      const token = source.slice(i).match(/^[^\s,}\]]+/)![0];
      if (token.startsWith('+')) throw new Error('Json.NET does not accept a leading plus sign');
      if (/^0[^.xX]/.test(token) && token.length > 1) {
        if (!/^0[0-7]+$/.test(token)) throw new Error('Invalid Json.NET octal literal: ' + token);
        result += String(Number.parseInt(token, 8));
      } else if (/^-0[0-9]*$/.test(token)) result += String(Number(token));
      else result += token;
      i += token.length - 1;
      expectingValue = false;
      continue;
    }
    if (expectingValue && !/\s/.test(char)) expectingValue = false;
    result += char;
  }
  return JSON5.parse(result);
}

/** Parser port under conformance testing; JSON5 is not a claim of full
 * Newtonsoft.Json equivalence. Original line numbers and case-sensitive keys survive.
 */
export function parseScript(script: string, variables: Record<string, unknown> = {}): Command[] {
  const lines = script.split(/\r\n|\n|\r/);
  const commands: Command[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = i + 1;
    let block = lines[i];
    // RVA 0x41CF560: a final backslash joins physical lines without a newline.
    while (block.endsWith('\\')) {
      block = block.slice(0, -1);
      if (++i >= lines.length) break;
      block += lines[i];
    }
    if (!block || /^\s+$/.test(block) || commentPattern.test(block)) continue;
    const match = block.match(commandPattern);
    if (!match) {
      commands.push({ name: 'dialog', text: block, params: {}, line });
      continue;
    }
    const name = (match[3] || match[1] || 'dialog').toLowerCase();
    const paramsText = match[2] || match[4];
    let params: Record<string, unknown> = {};
    if (paramsText) {
      try {
        params = parseParameters('{' + replaceEquals(paramsText) + '}');
      } catch (error) {
        throw new Error(`第 ${line} 行参数解析失败：${String(error)}`);
      }
      for (const key of Object.keys(params)) {
        const value = params[key];
        if (
          typeof value === 'string' &&
          value.startsWith('$') &&
          Object.hasOwn(variables, value.slice(1))
        )
          params[key] = variables[value.slice(1)];
      }
    }
    commands.push({ name, text: match[5] || null, params, line });
  }
  // RVA 0x41CE640 + AVGUtils.GenerateEndtipCommand 0x4196880.
  if (commands.at(-1)?.name !== 'endtip')
    commands.push({ name: 'endtip', text: null, params: { block: true }, line: 0 });
  return commands;
}
