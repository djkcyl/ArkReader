export type AudioChannel = 'ui' | 'theme' | 'player';
type SettingsStorage = Pick<Storage, 'getItem' | 'setItem'>;
const homeMusicKey = 'arkreader.homeMusic';
const percent = (value: unknown, fallback: number) => {
  const number =
    typeof value === 'number' || (typeof value === 'string' && value.trim()) ? Number(value) : NaN;
  return Number.isFinite(number) ? Math.round(Math.max(0, Math.min(100, number))) : fallback;
};
function browserStorage(): SettingsStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return;
  }
}

export class AudioLevels {
  private values: Record<AudioChannel, number> = { ui: 100, theme: 25, player: 100 };
  private listeners = new Set<(channel: AudioChannel, value: number) => void>();
  constructor(private storage = browserStorage()) {
    try {
      this.values.player = percent(storage?.getItem('arkreader.volume'), 100);
      this.values.ui = percent(storage?.getItem('arkreader.uiVolume'), this.values.player);
      const music = JSON.parse(storage?.getItem(homeMusicKey) ?? '{}');
      this.values.theme = typeof music?.volume === 'number' ? percent(music.volume * 100, 25) : 25;
    } catch {
      /* Unavailable settings do not prevent audio playback. */
    }
  }
  get(channel: AudioChannel): number {
    return this.values[channel];
  }
  set(channel: AudioChannel, value: number): void {
    const next = percent(value, this.values[channel]);
    if (next === this.values[channel]) return;
    this.values[channel] = next;
    try {
      this.storage?.setItem('arkreader.volume', String(this.values.player));
      this.storage?.setItem('arkreader.uiVolume', String(this.values.ui));
      let music: Record<string, unknown> = {};
      try {
        const saved = JSON.parse(this.storage?.getItem(homeMusicKey) ?? '{}');
        if (saved && typeof saved === 'object' && !Array.isArray(saved)) music = saved;
      } catch {
        /* Save valid settings after a malformed value. */
      }
      this.storage?.setItem(
        homeMusicKey,
        JSON.stringify({ ...music, volume: this.values.theme / 100 }),
      );
    } catch {
      /* Continue with the current session's settings. */
    }
    for (const listener of this.listeners) listener(channel, next);
  }
  subscribe(listener: (channel: AudioChannel, value: number) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
export const audioLevels = new AudioLevels();
