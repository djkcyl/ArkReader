import type { ViewingProgress } from '../core/viewing-progress';
import { parsePosition, type PlaybackPosition } from '../core/playback-position';

export interface ReadingRecord {
  id: string;
  at: number;
  complete: boolean;
}
export interface SavedProgress {
  percent: number | null;
  complete: boolean;
  skipped: boolean;
  position?: PlaybackPosition;
}
export type ProgressLedger = Record<string, SavedProgress>;
export interface ShelfData {
  recent: ReadingRecord[];
  favorites: string[];
  progress: ProgressLedger;
}
export const emptyShelf = (): ShelfData => ({ recent: [], favorites: [], progress: {} });
export function highestProgress(record: SavedProgress): number | null {
  if (record.complete) return 100;
  const values = [record.percent, record.position?.percent].filter(
    (n): n is number => typeof n === 'number' && Number.isFinite(n),
  );
  return values.length ? Math.min(99, Math.max(0, Math.floor(Math.max(...values)))) : null;
}
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const safeId = (id: unknown): id is string =>
  typeof id === 'string' &&
  id.length > 0 &&
  !['__proto__', 'constructor', 'prototype'].includes(id);
export function parseShelf(value: string | null): ShelfData {
  try {
    const raw: unknown = JSON.parse(value ?? '{}');
    if (!object(raw)) return emptyShelf();
    const progress: ProgressLedger = {};
    if (object(raw.progress))
      for (const [id, row] of Object.entries(raw.progress)) {
        if (!safeId(id) || !object(row)) continue;
        const complete = row.complete === true;
        progress[id] = {
          percent: complete
            ? 100
            : typeof row.percent === 'number' && Number.isFinite(row.percent)
              ? Math.floor(Math.max(0, Math.min(99, row.percent)))
              : null,
          complete,
          skipped: !complete && row.skipped === true,
        };
        const position = parsePosition(row.position);
        if (position) progress[id].position = position;
        progress[id].percent = highestProgress(progress[id]);
      }
    const recent: ReadingRecord[] = [],
      seen = new Set<string>();
    if (Array.isArray(raw.recent))
      for (const row of raw.recent) {
        if (
          !object(row) ||
          !safeId(row.id) ||
          typeof row.at !== 'number' ||
          !Number.isFinite(row.at) ||
          seen.has(row.id)
        )
          continue;
        seen.add(row.id);
        if (!progress[row.id]) continue;
        recent.push({ id: row.id, at: row.at, complete: progress[row.id].complete });
        if (recent.length === 12) break;
      }
    return {
      recent,
      progress,
      favorites: Array.isArray(raw.favorites)
        ? [...new Set(raw.favorites.filter(safeId))].slice(0, 200)
        : [],
    };
  } catch {
    return emptyShelf();
  }
}
export function rememberStory(data: ShelfData, id: string, at = Date.now()): ShelfData {
  const previous = data.progress[id];
  return {
    ...data,
    progress: {
      ...data.progress,
      [id]: previous ?? { percent: 0, complete: false, skipped: false },
    },
    recent: [
      { id, at, complete: previous?.complete ?? false },
      ...data.recent.filter((r) => r.id !== id),
    ].slice(0, 12),
  };
}
export function forgetStory(data: ShelfData, id: string): void {
  data.recent = data.recent.filter((record) => record.id !== id);
  delete data.progress[id];
}
export function recordProgress(
  data: ShelfData,
  id: string,
  value: ViewingProgress,
  position?: PlaybackPosition,
): boolean {
  const previous = data.progress[id];
  const complete = previous?.complete === true || value.complete;
  const percent = complete
    ? 100
    : Math.max(
        previous ? (highestProgress(previous) ?? 0) : 0,
        Math.min(99, Math.max(0, Math.floor(value.percent), Math.floor(position?.percent ?? 0))),
      );
  const skipped = !complete && (previous?.skipped === true || value.skipped);
  // The bookmark advances with the highest progress. Restarting or rewinding
  // never replaces it with an earlier scene, even when percentages round alike.
  const best = previous?.position;
  const advances =
    position &&
    position.percent >= percent &&
    (!best ||
      position.script !== best.script ||
      position.index > best.index ||
      (position.index === best.index && position.step >= best.step));
  const changedPosition =
    advances &&
    (!best ||
      position.script !== best.script ||
      position.step !== best.step ||
      position.actions.length !== best.actions.length);
  if (
    previous?.percent === percent &&
    previous.complete === complete &&
    previous.skipped === skipped &&
    !changedPosition
  )
    return false;
  const checkpoint = advances ? (parsePosition(position) ?? best) : best;
  data.progress[id] = {
    percent,
    complete,
    skipped,
    ...(checkpoint ? { position: checkpoint } : {}),
  };
  const recent = data.recent.find((row) => row.id === id);
  if (recent) recent.complete = complete;
  return true;
}
export function chapterProgress(ids: string[], ledger: ProgressLedger) {
  const unique = [...new Set(ids)],
    complete = unique.filter((id) => ledger[id]?.complete).length;
  const total = unique.length,
    percent = total
      ? Math.floor(unique.reduce((sum, id) => sum + (ledger[id]?.percent ?? 0), 0) / total)
      : 0;
  return {
    percent: complete === total && total ? 100 : Math.min(99, percent),
    complete,
    total,
    unknown: unique.filter((id) => ledger[id]?.percent === null).length,
  };
}
