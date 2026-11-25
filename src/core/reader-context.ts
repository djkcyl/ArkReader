import type { Command } from './scheduler';
import { nativeBoolean } from './values';

const textCommands = new Set(['dialog', 'aside', 'subtitle', 'multiline', 'sticker']);
const overrides = new Set([
  'dialog',
  'blocker',
  'aside',
  'subtitle',
  'soundvolume',
  'musicvolume',
  'image',
  'bgeffect',
  'imgeffect',
  'avgdisplay',
]);
const backgrounds = new Set(['background', 'largebg', 'verticalbg', 'gridbg']);
const str = (c: Command, key: string) => String(c.params[key] ?? '');
const cgKey = (c: Command) => (str(c, 'id') || str(c, 'image')).toLowerCase();

/** Native Dictionary enumerates entry slots and reuses the last removed slot. */
class ContextCgItems {
  private keys = new Map<string, number>();
  private entries: (Command | undefined)[] = [];
  private free: number[] = [];
  set(key: string, command: Command) {
    const index = this.keys.get(key) ?? this.free.pop() ?? this.entries.length;
    this.keys.set(key, index);
    this.entries[index] = command;
  }
  delete(key: string) {
    const index = this.keys.get(key);
    if (index === undefined) return;
    this.keys.delete(key);
    this.entries[index] = undefined;
    this.free.push(index);
  }
  clear() {
    this.keys.clear();
    this.entries = [];
    this.free = [];
  }
  values() {
    return this.entries.filter((c): c is Command => !!c);
  }
}

/** AVGContextStateBuilder and RegisterDefaults, independent of live playback.
 * This deliberately stores commands, not the current animated scene state. */
export class ReaderContextState {
  private override = new Map<string, Command>();
  private background?: Command;
  private music?: Command;
  private item?: Command;
  private cgitem?: Command;
  private decision?: Command;
  private cgitems = new ContextCgItems();
  private slots: Partial<Record<'l' | 'm' | 'r', Command>> = {};
  private stickers: Command[] = [];
  private multiline: Command[] = [];
  apply(c: Command): void {
    const name = c.name.toLowerCase();
    if (overrides.has(name)) {
      this.override.set(name, c);
      return;
    }
    if (backgrounds.has(name)) {
      this.background = c;
      return;
    }
    switch (name) {
      case 'showitem':
        this.item = c;
        break;
      case 'hideitem':
        this.item = undefined;
        break;
      case 'cgitem': {
        this.cgitem = c;
        const key = cgKey(c);
        if (key) this.cgitems.set(key, c);
        break;
      }
      case 'hidecgitem': {
        const key = cgKey(c);
        if (!key) {
          this.cgitem = undefined;
          this.cgitems.clear();
        } else {
          this.cgitems.delete(key);
          if (this.cgitem && cgKey(this.cgitem) === key) this.cgitem = undefined;
        }
        break;
      }
      case 'playmusic':
        this.music = c;
        break;
      case 'stopmusic':
        this.music = undefined;
        break;
      case 'decision':
        this.decision = c;
        break;
      case 'predicate':
        this.decision = undefined;
        break;
      case 'sticker':
      case 'timersticker':
        this.stickers.push(c);
        break;
      case 'stickerclear':
      case 'timerclear':
        this.stickers = [];
        break;
      case 'multiline':
        if (nativeBoolean(c.params.end ?? false)) this.multiline = [];
        else this.multiline.push(c);
        break;
      case 'charslot': {
        // Action-only and focus-only updates must not replace the last portrait.
        if (str(c, 'action')) break;
        if (!str(c, 'name') && str(c, 'focus')) break;
        const aliases: Record<string, 'l' | 'm' | 'r'> = {
          left: 'l',
          l: 'l',
          middle: 'm',
          m: 'm',
          right: 'r',
          r: 'r',
        };
        const slot = str(c, 'slot').toLowerCase(),
          key = aliases[slot];
        if (!slot) this.slots = {};
        else if (key) this.slots[key] = c;
        break;
      }
      case 'character':
        if (['isCopy', 'iscopy', 'IsCopy'].some((k) => nativeBoolean(c.params[k] ?? false))) break;
        if (!str(c, 'name') && !str(c, 'name2')) {
          this.override.delete('character');
          this.slots = {};
        } else this.override.set('character', c);
        break;
      // RegisterDefaults explicitly ignores transition/effect commands. Unregistered
      // commands (including video) also do not mutate this context builder.
    }
  }
  snapshot(): Command[] {
    const cg = this.cgitems.values();
    // Sticker/multiline buffers are not appended by the native ToContextList.
    return [
      ...this.override.values(),
      this.background,
      this.item,
      ...(cg.length ? cg : [this.cgitem]),
      this.music,
      this.decision,
      this.slots.l,
      this.slots.m,
      this.slots.r,
    ].filter((c): c is Command => !!c);
  }
}

export interface ReaderCommandContext {
  commandIndex: number;
  startIndex: number;
  endIndex: number;
  commands: Command[];
}
/** AVGCommandUtils.BuildTextCommandContexts preprocesses authored order without
 * evaluating choices. Only its five native text command kinds create entries. */
export function buildReaderContexts(
  commands: readonly Command[],
): Map<number, ReaderCommandContext> {
  const state = new ReaderContextState(),
    result = new Map<number, ReaderCommandContext>();
  let previous = -1;
  commands.forEach((command, index) => {
    state.apply(command);
    if (!textCommands.has(command.name.toLowerCase())) return;
    result.set(command.line > 0 ? command.line : index, {
      commandIndex: index,
      startIndex: previous + 1,
      endIndex: index,
      commands: state.snapshot(),
    });
    previous = index;
  });
  return result;
}
