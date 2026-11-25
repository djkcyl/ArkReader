import type { Command } from './scheduler';
import { nativeBoolean } from './values.ts';

export interface StoryHeader {
  present: boolean;
  id: string;
  title: string;
  isTutorial: boolean;
  isSkippable: boolean;
  isAutoable: boolean;
  isVideoOnly: boolean;
  denyAutoSwitchScene: boolean;
  dontClearGameObjectPoolOnStart: boolean;
  fitMode: number;
  characterSortType: number;
  parameters: Record<string, unknown>;
}
const sorts = [
  'LEVEL',
  'RARITY',
  'GAIN_TIME',
  'NAME',
  'COST',
  'HP',
  'ATK',
  'DEF',
  'RES',
  'FAVOR',
  'RESPAWN',
  'BLOCKNUM',
  'ATKSPEED',
  'HANDBOOKSTAGE',
].flatMap((s) => [`BY_${s}_UP`, `BY_${s}_DOWN`]);
export function nativeHeaderEnum(
  value: unknown,
  names: readonly string[],
  fallback: number,
): number {
  if (value === undefined || value === null) return fallback;
  const text = String(value).trim();
  if (/^[+-]?\d+$/.test(text)) {
    const n = Number(text);
    return Number.isInteger(n) && n >= -2147483648 && n <= 2147483647 ? n : fallback;
  }
  const values = text
    .toUpperCase()
    .split(',')
    .map((part) => names.indexOf(part.trim()));
  return values.some((n) => n < 0) ? fallback : values.reduce((a, b) => a | b, 0);
}
/** AVGParser.TryParse RVA 0x41CDFF0: only command zero supplies metadata. */
export function parseStoryHeader(commands: Command[]): StoryHeader {
  const first = commands[0],
    present = first?.name === 'header';
  const result: StoryHeader = {
    present,
    id: '',
    title: '',
    isTutorial: false,
    isSkippable: false,
    isAutoable: false,
    isVideoOnly: false,
    denyAutoSwitchScene: false,
    dontClearGameObjectPoolOnStart: false,
    fitMode: 0,
    characterSortType: 0,
    parameters: {},
  };
  if (!present) return result;
  const p = first.params,
    b = (key: string, fallback = false) =>
      Object.hasOwn(p, key) ? nativeBoolean(p[key]) : fallback;
  result.parameters = { ...p };
  result.id = String(p.key ?? '');
  result.title = first.text ?? '';
  result.isTutorial = b('is_tutorial');
  result.isVideoOnly = b('is_video_only');
  result.isSkippable = b('is_skippable', !result.isTutorial);
  result.isAutoable = b('is_autoable', !result.isTutorial && !result.isVideoOnly);
  result.denyAutoSwitchScene = b('deny_auto_switch_scene');
  result.dontClearGameObjectPoolOnStart = b('dont_clear_gameobjectpool_onstart');
  result.fitMode = nativeHeaderEnum(p.fit_mode, ['DEFAULT', 'BLACK_MASK'], 0);
  result.characterSortType = nativeHeaderEnum(p.char_sort_type, sorts, 5);
  return result;
}
