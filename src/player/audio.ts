import type { Pack, AudioPort } from './runtime';

type Envelope = { from: number; to: number; start: number; end: number; stop: boolean };
type Track = {
  gain: GainNode;
  sources: AudioBufferSourceNode[];
  key?: string;
  level: number;
  envelope?: Envelope;
  marker?: AudioBufferSourceNode;
  closed?: boolean;
  ui?: boolean;
};
const clampVolume = (v: number) => Math.max(0, Math.min(1, v));
export class StoryAudio implements AudioPort {
  readonly context: AudioContext;
  readonly master: GainNode;
  readonly buffers = new Map<string, AudioBuffer>();
  private bgm: Track[] = [];
  private sounds = new Map<string, Track>();
  private all = new Set<Track>();
  constructor(context: AudioContext = new AudioContext()) {
    this.context = context;
    this.master = context.createGain();
    this.master.gain.value = 1;
    this.master.connect(this.context.destination);
  }
  private closing?: Promise<void>;
  async load(
    pack: Pick<Pack, 'assets'>,
    signal?: AbortSignal,
    progress?: (done: number, total: number, resource: string) => void,
  ): Promise<void> {
    let done = 0;
    const assets = Object.entries(pack.assets).flatMap(([key, asset]) => {
      if (asset.kind === 'audio') return [{ key, url: asset.url, label: key }];
      if (asset.kind === 'video' && asset.audio)
        return [{ key: asset.audio.url, url: asset.audio.url, label: '影片音轨 · ' + key }];
      return [];
    });
    const total = assets.length;
    await Promise.all(
      assets.map(async ({ key, url, label }) => {
        progress?.(done, total, '读取音频 · ' + label);
        const response = await fetch(url, { signal });
        if (!response.ok) throw new Error(`音频加载失败：${label}`);
        const decoded = await this.context.decodeAudioData(await response.arrayBuffer());
        if (!this.closing && !signal?.aborted) this.buffers.set(key, decoded);
        if (!signal?.aborted) progress?.(++done, total, '已解码音频 · ' + label);
      }),
    );
  }
  async unlock(): Promise<void> {
    await this.context.resume();
  }
  setVolume(value: number): void {
    this.master.gain.setValueAtTime(value, this.context.currentTime);
  }
  private track(volume: number, ui = false): Track {
    const gain = this.context.createGain();
    gain.gain.value = clampVolume(volume);
    gain.connect(this.master);
    const t = { gain, sources: [], level: volume, ui };
    this.all.add(t);
    return t;
  }
  private source(key: string, track: Track, at: number, loop = false, offset = 0): void {
    const buffer = this.buffers.get(key);
    if (!buffer) throw new Error(`音频未解码 ${key}`);
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.loop = loop;
    source.connect(track.gain);
    source.start(at, offset);
    track.sources.push(source);
    source.onended = () => {
      source.onended = null;
      source.disconnect();
      track.sources = track.sources.filter((s) => s !== source);
      if (!track.sources.length) this.finish(track);
    };
  }
  private levelAt(track: Track, time = this.context.currentTime): number {
    const e = track.envelope;
    if (!e) return track.level;
    if (time <= e.start) return e.from;
    if (time >= e.end) return e.to;
    return e.from + ((e.to - e.from) * (time - e.start)) / (e.end - e.start);
  }
  private cancelMarker(track: Track): void {
    const m = track.marker;
    track.marker = undefined;
    if (m) {
      m.onended = null;
      try {
        m.stop();
      } catch {
        /* expired */
      }
      m.disconnect();
    }
  }
  private finish(track: Track): void {
    if (track.closed) return;
    track.closed = true;
    this.cancelMarker(track);
    for (const source of track.sources) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        /* ended */
      }
      source.disconnect();
    }
    track.sources = [];
    track.gain.disconnect();
    this.all.delete(track);
    this.bgm = this.bgm.filter((t) => t !== track);
    for (const [name, t] of this.sounds) if (t === track) this.sounds.delete(name);
  }
  private current(track: Track | undefined): Track | undefined {
    if (track?.envelope?.stop && this.context.currentTime >= track.envelope.end) this.finish(track);
    return track?.closed ? undefined : track;
  }
  private ramp(
    track: Track,
    to: number,
    duration: number,
    stop = false,
    at = this.context.currentTime,
  ): void {
    const now = this.context.currentTime,
      from = this.levelAt(track, now),
      gain = track.gain.gain;
    this.cancelMarker(track);
    // Firefox lacks cancelAndHoldAtTime. Our channel envelope already knows
    // the instantaneous level, including script values outside the gain range.
    if (typeof gain.cancelAndHoldAtTime === 'function') gain.cancelAndHoldAtTime(now);
    else gain.cancelScheduledValues(now);
    gain.setValueAtTime(clampVolume(from), now);
    track.level = from;
    track.envelope = undefined;
    // A negative tween target is AudioChannel's disabled-tween sentinel.
    if (to < 0) return;
    const start = Math.max(now, at),
      end = start + Math.max(0, duration);
    track.envelope = { from, to, start, end, stop };
    gain.setValueAtTime(clampVolume(from), start);
    // Clamp at the AudioSource boundary, retaining the unclamped channel value.
    // This also preserves plateaus when a script tweens from volume > 1.
    if (end > start && from !== to) {
      const crossings = [0, 1]
        .map((level) => ({ level, f: (level - from) / (to - from) }))
        .filter((x) => x.f > 0 && x.f < 1)
        .sort((a, b) => a.f - b.f);
      for (const crossing of crossings)
        gain.linearRampToValueAtTime(crossing.level, start + (end - start) * crossing.f);
    }
    gain.linearRampToValueAtTime(clampVolume(to), end);
    if (stop) {
      // A cancellable silent clock event reclaims the channel. Scheduling stop()
      // on its audible sources would make SoundVolume unable to cancel a fade.
      const marker = this.context.createBufferSource();
      marker.buffer = this.context.createBuffer(1, 1, this.context.sampleRate);
      marker.connect(this.master);
      track.marker = marker;
      marker.onended = () => {
        if (track.marker === marker) this.finish(track);
      };
      marker.start(end);
    }
  }
  private retire(track: Track, fade = 0, at = this.context.currentTime): void {
    if (fade <= 0.01 && at <= this.context.currentTime) {
      this.finish(track);
      return;
    }
    this.ramp(track, 0, fade, true, at);
  }
  music(
    intro: string,
    loop: string,
    volume: number,
    delay: number,
    fade: number,
    offset = 0,
  ): void {
    const key = intro + '|' + loop;
    const same = this.current(this.bgm.find((t) => t.key === key));
    if (same) {
      this.ramp(same, volume, 0);
      return;
    }
    const crossing = this.bgm.length > 0 && fade > 0.01;
    const at = this.context.currentTime + Math.max(0, delay);
    for (const old of this.bgm) this.retire(old, fade, at);
    const next = this.track(crossing ? 0 : volume);
    next.key = key;
    this.bgm = [next];
    if (crossing) this.ramp(next, volume, fade, false, at);
    const introDuration = intro ? this.buffers.get(intro)!.duration : 0;
    if (intro && offset < introDuration) this.source(intro, next, at, false, offset);
    // Both nodes scheduled on the same audio sample clock; no onended/JS timer gap.
    if (loop)
      this.source(
        loop,
        next,
        at + Math.max(0, introDuration - offset),
        true,
        Math.max(0, offset - introDuration) % this.buffers.get(loop)!.duration,
      );
  }
  stopMusic(fade: number): void {
    for (const track of [...this.bgm]) this.retire(track, fade);
  }
  musicVolume(volume: number, fade: number): void {
    const track = this.current(this.bgm.at(-1));
    if (track) this.ramp(track, volume, fade);
  }
  soundVolume(channel: string, volume: number, fade: number): void {
    const track = this.current(this.sounds.get(channel));
    if (track) this.ramp(track, volume, fade);
  }
  stopSound(channel: string, fade: number): void {
    const track = this.current(this.sounds.get(channel));
    if (track) this.retire(track, fade);
  }
  sound(
    key: string,
    channel: string,
    volume: number,
    delay: number,
    loop: boolean,
    offset = 0,
  ): void {
    const old = this.sounds.get(channel);
    if (old) this.retire(old);
    const track = this.track(volume);
    this.sounds.set(channel, track);
    this.source(
      key,
      track,
      this.context.currentTime + Math.max(0, delay),
      loop,
      loop ? offset % this.buffers.get(key)!.duration : offset,
    );
  }
  stop(): void {
    for (const track of [...this.all]) if (!track.ui) this.retire(track);
    this.sounds.clear();
    this.bgm = [];
  }
  pause(paused: boolean): void {
    if (this.closing || this.context.state === 'closed') return;
    // Leaving the story can close the context while a browser suspend/resume
    // request is pending. Edge rejects that pending request with InvalidStateError.
    void (paused ? this.context.suspend() : this.context.resume()).catch((error) => {
      if (!(this.closing && error?.name === 'InvalidStateError')) throw error;
    });
  }
  close(): Promise<void> {
    if (!this.closing) {
      for (const track of [...this.all]) this.retire(track);
      this.sounds.clear();
      this.bgm = [];
      this.buffers.clear();
      this.master.disconnect();
      this.closing = this.context.close();
    }
    return this.closing;
  }
}
