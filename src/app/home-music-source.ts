import type { Pack } from '../player/runtime';
import { resourceRequest, waitForPoll, type OperationStatus } from './resource-api';

export interface MusicTrack {
  id: string;
  name: string;
  backgrounds: string[];
}
export interface MusicCatalog {
  version: string | null;
  default: string | null;
  tracks: MusicTrack[];
}
export interface MusicPack {
  id: string;
  name: string;
  intro: string;
  loop: string;
  volume: number;
  assets: Pack['assets'];
}
export const storageKey = 'arkreader.homeMusic';

export async function prepareMusic(
  id: string,
  signal: AbortSignal,
  update: (value: OperationStatus<MusicPack>) => void,
): Promise<MusicPack> {
  const operation = await resourceRequest<OperationStatus<MusicPack>>(
    `/api/home-music/${encodeURIComponent(id)}/prepare`,
    {},
  );
  const url = `/api/home-music/operations/${operation.id}`;
  const cancel = () => {
    void resourceRequest(url + '/cancel', {}).catch(() => {});
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    if (signal.aborted) {
      cancel();
      signal.throwIfAborted();
    }
    for (;;) {
      const value = await resourceRequest<OperationStatus<MusicPack>>(url, undefined, signal);
      update(value);
      if (value.state === 'completed') return value.result!;
      if (value.state === 'failed') throw Error(value.error || '音乐暂时未能播放');
      if (value.state === 'cancelled') throw new DOMException('已取消', 'AbortError');
      await waitForPoll(180, signal);
    }
  } finally {
    signal.removeEventListener('abort', cancel);
  }
}

export interface MusicSettings {
  enabled: boolean;
  volume: number;
  track: string;
}
export interface StartupMusicPayload {
  catalog?: MusicCatalog;
  pack?: MusicPack;
}
export function musicSettings(): MusicSettings {
  const value = { enabled: true, volume: 0.25, track: '' };
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? '{}');
    value.enabled = saved.enabled !== false;
    if (typeof saved.track === 'string') value.track = saved.track;
    if (typeof saved.volume === 'number' && Number.isFinite(saved.volume))
      value.volume = Math.max(0, Math.min(1, saved.volume));
  } catch {}
  return value;
}
export function saveMusicSettings(value: MusicSettings) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(value));
  } catch {}
}
export async function prepareStartupMusic(
  signal: AbortSignal,
  update: (value: OperationStatus<MusicPack>) => void,
): Promise<StartupMusicPayload> {
  const settings = musicSettings();
  if (!settings.enabled) return {};
  const catalog = await resourceRequest<MusicCatalog>('/api/home-music', undefined, signal);
  signal.throwIfAborted();
  if (!catalog.tracks.length) return { catalog };
  if (!catalog.tracks.some((track) => track.id === settings.track)) {
    settings.track = catalog.default ?? catalog.tracks[0].id;
    saveMusicSettings(settings);
  }
  const pack = await prepareMusic(settings.track, signal, update);
  signal.throwIfAborted();
  return { catalog, pack };
}
