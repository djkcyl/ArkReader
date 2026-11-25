import type { Command } from './scheduler';
import { nativeBoolean } from './values';

const general = new Set([
  'background',
  'image',
  'largebg',
  'verticalbg',
  'gridbg',
  'showitem',
  'hideitem',
  'hidecgitem',
]);
const aliases: Record<string, string> = {
  l: 'left',
  left: 'left',
  m: 'middle',
  middle: 'middle',
  r: 'right',
  right: 'right',
};
const str = (c: Command, key: string) => String(c.params[key] ?? '');
const copied = (c: Command) =>
  ['isCopy', 'iscopy', 'IsCopy'].some((key) => nativeBoolean(c.params[key] ?? false));
const axis = (c: Command, key: string) =>
  Object.hasOwn(c.params, key) ? Math.fround(Number(c.params[key])) : NaN;

/** AVGReaderModePerformanceViewModel. It rebuilds from a context snapshot and
 * deliberately has a smaller command set than the ordinary scene renderer. */
export class ReaderPerformanceState {
  readonly commands = new Map<string, Command>();
  readonly characters = new Map<string, Command>();
  readonly scales = new Map<string, { x: number; y: number }>();
  readonly cgItems = new Map<string, Command>();
  hiddenForVideo = false;
  reset(): void {
    this.commands.clear();
    this.characters.clear();
    this.scales.clear();
    this.cgItems.clear();
    this.hiddenForVideo = false;
  }
  render(commands: readonly Command[] = []): void {
    this.reset();
    for (const command of commands) this.apply(command);
  }
  private scale(slot: string, x: number, y: number, reset = false): void {
    const previous = reset ? { x: 1, y: 1 } : (this.scales.get(slot) ?? { x: 1, y: 1 });
    this.scales.set(slot, {
      x: Number.isNaN(x) ? previous.x : x,
      y: Number.isNaN(y) ? previous.y : y,
    });
  }
  private apply(c: Command): void {
    const name = c.name.toLowerCase();
    if (name === 'video') {
      this.hiddenForVideo = true;
      return;
    }
    if (general.has(name)) {
      this.commands.set(name, c);
      return;
    }
    if (name === 'cgitem') {
      this.commands.set(name, c);
      const key = str(c, 'id') || str(c, 'image');
      if (key) this.cgItems.set(key, c);
      return;
    }
    if (name === 'character') {
      if (copied(c)) return;
      this.characters.clear();
      this.scales.clear();
      this.commands.set(name, c);
      const first = str(c, 'name'),
        second = str(c, 'name2');
      if (first && !second) this.scale('middle', axis(c, 'xscale'), axis(c, 'yscale'), true);
      else if (second) {
        if (first) this.scale('left', axis(c, 'xscale'), axis(c, 'yscale'), true);
        this.scale('right', axis(c, 'xscale2'), axis(c, 'yscale2'), true);
      }
      return;
    }
    if (name === 'charslot') {
      if (str(c, 'action') || copied(c)) return;
      const slot = str(c, 'slot').toLowerCase(),
        portrait = str(c, 'name');
      if (!slot && !portrait) {
        this.characters.clear();
        this.scales.clear();
        return;
      }
      const key = aliases[slot];
      if (!key) return;
      if (portrait) {
        this.commands.delete('character');
        this.characters.set(key, c);
      }
      this.scale(key, axis(c, 'xscale'), axis(c, 'yscale'));
    }
  }
}
