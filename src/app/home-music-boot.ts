import { StoryAudio } from '../player/audio';
import { musicSettings, type StartupMusicPayload } from './home-music-source';

export interface PreparedStartupMusic extends StartupMusicPayload {
  audio?: StoryAudio;
}
let prepared: PreparedStartupMusic | undefined;
export function clearStartupMusic() {
  const previous = prepared;
  prepared = undefined;
  void previous?.audio?.close().catch(() => {});
}
/** The startup screen and home share one document and one decoded audio context. */
export async function preloadStartupMusic(
  payload: StartupMusicPayload,
  signal: AbortSignal,
  onProgress?: (done: number, total: number) => void,
) {
  clearStartupMusic();
  if (!musicSettings().enabled || !payload.pack) {
    prepared = { catalog: payload.catalog };
    return;
  }
  const audio = new StoryAudio();
  audio.setVolume(0);
  try {
    await audio.load(payload.pack, signal, onProgress);
    signal.throwIfAborted();
    prepared = { ...payload, audio };
  } catch (error) {
    await audio.close().catch(() => {});
    throw error;
  }
}
export function adoptStartupMusic(): PreparedStartupMusic | undefined {
  const result = prepared;
  prepared = undefined;
  return result;
}
