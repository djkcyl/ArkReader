import { previewAt, type ScriptSource } from '../core/script-preview';
import type { PlaybackPosition } from '../core/playback-position';

export interface ReadingPreview {
  state: 'loading' | 'ready' | 'changed' | 'unavailable';
  speaker: string;
  text: string;
}
export function previewText(preview?: ReadingPreview): string {
  if (!preview) return '';
  if (preview.state === 'loading') return '正在读取台词…';
  if (preview.state === 'changed') return '剧情内容已更新';
  if (preview.state === 'unavailable') return '暂时无法读取台词';
  return preview.speaker ? `${preview.speaker}：${preview.text}` : preview.text;
}

/** Display-only data. The shelf persists positions, never script excerpts. */
export class ReadingPreviews {
  private sources = new Map<string, Promise<ScriptSource>>();
  private previews = new Map<string, ReadingPreview>();
  private queue: (() => Promise<void>)[] = [];
  private active = 0;
  constructor(
    private load: (id: string) => Promise<ScriptSource>,
    private nickname: () => string,
    private changed: (id: string) => void,
  ) {}
  source(id: string, source: ScriptSource): void {
    this.sources.set(id, Promise.resolve(source));
    for (const key of this.previews.keys())
      if (key.startsWith(id + '\n')) this.previews.delete(key);
  }
  get(id: string, position: PlaybackPosition): ReadingPreview {
    const nickname = this.nickname();
    const key = [id, position.script, position.index, nickname].join('\n');
    const cached = this.previews.get(key);
    if (cached) return cached;
    const preview: ReadingPreview = { state: 'loading', speaker: '', text: '' };
    this.previews.set(key, preview);
    this.queue.push(async () => {
      try {
        let source = this.sources.get(id);
        if (!source) {
          source = this.load(id);
          this.sources.set(id, source);
        }
        const value = previewAt(await source, position, nickname);
        Object.assign(preview, value ? { ...value, state: 'ready' } : { state: 'changed' });
      } catch {
        this.sources.delete(id);
        preview.state = 'unavailable';
      }
      this.changed(id);
    });
    this.drain();
    return preview;
  }
  private drain(): void {
    while (this.active < 3 && this.queue.length) {
      this.active++;
      void this.queue.shift()!().finally(() => {
        this.active--;
        this.drain();
      });
    }
  }
}
