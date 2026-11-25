export type ScriptTokenKind =
  | 'command'
  | 'parameter'
  | 'string'
  | 'number'
  | 'boolean'
  | 'variable'
  | 'comment'
  | 'text'
  | 'punctuation';
export interface ScriptToken {
  kind: ScriptTokenKind;
  text: string;
}
interface SyntaxState {
  depth: number;
  quote: string;
}

/** Highlight source without modifying it or introducing a second executable parser. */
export function sourceTokens(
  lines: readonly string[],
  comments: ReadonlySet<number>,
): ScriptToken[][] {
  let state: SyntaxState = { depth: 0, quote: '' };
  return lines.map((line, index) => {
    if (index === 0 || !lines[index - 1].endsWith('\\')) state = { depth: 0, quote: '' };
    if (comments.has(index + 1) && /^\s*\/\//.test(line)) return [{ kind: 'comment', text: line }];
    if (!state.depth && !line.startsWith('[')) return [{ kind: 'text', text: line }];
    const tokens: ScriptToken[] = [];
    const add = (kind: ScriptTokenKind, text: string) => {
      const last = tokens.at(-1);
      if (last?.kind === kind) last.text += text;
      else tokens.push({ kind, text });
    };
    let at = 0;
    while (at < line.length) {
      const char = line[at];
      if (state.quote || char === '"' || char === "'") {
        const start = at;
        if (!state.quote) state.quote = line[at++];
        while (at < line.length) {
          const next = line[at++];
          if (next === '\\') {
            if (at < line.length) at++;
            continue;
          }
          if (next === state.quote) {
            state.quote = '';
            break;
          }
        }
        const text = line.slice(start, at);
        const variable = /\{@[a-zA-Z0-9_.]+\}|\$[a-zA-Z_][\w.]*/g;
        let offset = 0;
        for (const match of text.matchAll(variable)) {
          add('string', text.slice(offset, match.index));
          add('variable', match[0]);
          offset = match.index + match[0].length;
        }
        add('string', text.slice(offset));
        continue;
      }
      if (char === '[') {
        state.depth++;
        add('punctuation', char);
        at++;
        continue;
      }
      if (char === ']') {
        state.depth--;
        add('punctuation', char);
        at++;
        if (!state.depth) {
          add('text', line.slice(at));
          break;
        }
        continue;
      }
      const rest = line.slice(at),
        number = rest.match(/^-?(?:0[xX][\da-fA-F]+|\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/);
      if (number) {
        add('number', number[0]);
        at += number[0].length;
        continue;
      }
      const word = rest.match(/^[a-zA-Z_$][\w.$]*/);
      if (word) {
        const value = word[0],
          tail = rest.slice(value.length);
        add(
          value.startsWith('$')
            ? 'variable'
            : /^(true|false|null|undefined)$/i.test(value)
              ? 'boolean'
              : /^\s*[=:]/.test(tail)
                ? 'parameter'
                : /^\s*[(\]]/.test(tail)
                  ? 'command'
                  : 'text',
          value,
        );
        at += value.length;
        continue;
      }
      add(/[(),{}:=;]/.test(char) ? 'punctuation' : 'text', char);
      at++;
    }
    return tokens;
  });
}

export function readableTokens(text: string): ScriptToken[] {
  const pattern = /「[^」]*」|“[^”]*”|-?\d+(?:\.\d+)?(?:%|°)?/g,
    tokens: ScriptToken[] = [];
  let offset = 0;
  for (const match of text.matchAll(pattern)) {
    tokens.push({ kind: 'text', text: text.slice(offset, match.index) });
    tokens.push({ kind: /^[「“]/.test(match[0]) ? 'string' : 'number', text: match[0] });
    offset = match.index + match[0].length;
  }
  tokens.push({ kind: 'text', text: text.slice(offset) });
  return tokens;
}
