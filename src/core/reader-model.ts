import type { Command } from './scheduler';
import { buildReaderContexts, type ReaderCommandContext } from './reader-context';
import { removeReaderRichText, splitReaderText } from './reader-text';
import { nativeBoolean } from './values';
import { ReaderPerformanceState } from './reader-performance';

export interface ReaderCell {
  name: string;
  text: string;
  current: boolean;
  decision: boolean;
  decisionIndex: number;
  line: number;
  endtip: boolean;
}
export interface ReaderTextEvent {
  line: number;
  length: number;
  endtip: boolean;
}

/** AVGReaderModeAdapter + AVGReaderModeViewModel. Records executed commands even
 * in normal mode; context snapshots, in contrast, come from authored order. */
export class ReaderModel {
  readonly cells: ReaderCell[] = [];
  readonly contexts: Map<number, ReaderCommandContext>;
  readonly performance = new ReaderPerformanceState();
  version = 0;
  context: ReaderCommandContext | undefined;
  private multiline: ReaderCell | undefined;
  constructor(
    commands: readonly Command[],
    private translate: (value: unknown) => string,
  ) {
    this.contexts = buildReaderContexts(commands);
  }
  private finishMultiline() {
    this.multiline = undefined;
  }
  private resetCurrent() {
    const cell = this.cells.at(-1);
    if (cell?.current) {
      cell.current = false;
      this.version++;
    }
  }
  private add(text: string, name = '', line = 0, decision = false, endtip = false): ReaderCell {
    this.resetCurrent();
    const cell = {
      name,
      text,
      current: !decision && !endtip,
      decision,
      decisionIndex: -1,
      line,
      endtip,
    };
    this.cells.push(cell);
    this.version++;
    return cell;
  }
  updateDecision(line: number, index: number): boolean {
    if (line <= 0) return false;
    const cell = this.cells.findLast((c) => c.decision && c.line === line);
    if (!cell || cell.decisionIndex === index) return false;
    cell.decisionIndex = index;
    this.version++;
    return true;
  }
  opened(selected: ReadonlyMap<number, number>): void {
    // Unlike UpdateDecisionCellByLine, opening refreshes every occurrence.
    for (const cell of this.cells) {
      const index = selected.get(cell.line);
      if (
        cell.decision &&
        cell.line > 0 &&
        index !== undefined &&
        index >= 0 &&
        index !== cell.decisionIndex
      ) {
        cell.decisionIndex = index;
        this.version++;
      }
    }
  }
  reset(): void {
    this.cells.length = 0;
    this.multiline = undefined;
    this.context = undefined;
    this.performance.reset();
    this.version++;
  }
  process(command: Command, selected: ReadonlyMap<number, number>): ReaderTextEvent | undefined {
    const { name, text, params: p, line } = command,
      plain = (value: unknown) => removeReaderRichText(this.translate(value));
    let raw = '',
      speaker = '',
      display: string | undefined,
      length = 0;
    switch (name) {
      case 'dialog':
      case 'aside':
        if (!text) return;
        this.finishMultiline();
        raw = text;
        speaker = name === 'dialog' ? this.translate(p.name) : '';
        break;
      case 'multiline':
        if (!text) return;
        raw = text;
        speaker = this.translate(p.name);
        break;
      case 'subtitle':
        if (nativeBoolean(p.hidelog ?? false) || !String(p.text ?? '')) return;
        this.finishMultiline();
        raw = String(p.text);
        break;
      case 'sticker':
        this.finishMultiline();
        if (nativeBoolean(p.hidelog ?? false)) return;
        raw = String(p.text ?? '').trim();
        if (!raw) return;
        break;
      case 'spellsticker': {
        this.finishMultiline();
        if (nativeBoolean(p.hidelog ?? false)) return;
        raw = splitReaderText(this.translate(text)).get(0) ?? '';
        if (!raw) return;
        display = removeReaderRichText(raw);
        break;
      }
      case 'animtext': {
        this.finishMultiline();
        if (!text) return;
        raw = text;
        display = '';
        for (const value of splitReaderText(this.translate(text)).values())
          display += (display.length ? '\n' : '') + removeReaderRichText(value);
        break;
      }
      case 'decision':
        if (String(p.options ?? '')) this.add(plain(p.options), '', line, true);
        return;
      case 'predicate': {
        const cell = this.cells.findLast((c) => c.decision),
          index = cell && selected.get(cell.line);
        if (cell && index !== undefined && index >= 0) this.updateDecision(cell.line, index);
        return;
      }
      case 'endtip':
        this.add('', '', 0, false, true);
        return { line, length: 0, endtip: true };
      default:
        return;
    }
    // Only positive line IDs trigger native performance-context lookup. Missing
    // entries pass an empty context instead of borrowing the live animated scene.
    if (line > 0) {
      this.context = this.contexts.get(line);
      this.performance.render(this.context?.commands);
    }
    length = raw.length;
    const content = display ?? plain(raw);
    if (name === 'multiline') {
      if (this.multiline) {
        this.multiline.text += content;
        this.version++;
      } else this.multiline = this.add(content, speaker);
      if (nativeBoolean(p.end ?? false)) this.finishMultiline();
    } else this.add(content, speaker);
    return { line, length, endtip: false };
  }
}
