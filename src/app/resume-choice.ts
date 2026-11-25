import { highestProgress, type SavedProgress } from './reading-state';
import type { PlaybackTarget } from '../player/restore-position';
import type { ReadingPreview } from './reading-preview';

export interface ResumeChoice {
  target: PlaybackTarget;
  percent: number;
  preview?: ReadingPreview;
  approximate: boolean;
}
export function resumeChoice(record: SavedProgress | undefined): ResumeChoice | undefined {
  if (!record || record.complete) return;
  const percent = highestProgress(record);
  if (percent === null || percent <= 0) return;
  if (record.position && record.position.percent >= percent) {
    const position = structuredClone(record.position);
    return { target: { position }, percent, approximate: false };
  }
  const route = record.position?.actions.length
    ? { position: structuredClone(record.position) }
    : {};
  return { target: { percent, ...route }, percent, approximate: true };
}
