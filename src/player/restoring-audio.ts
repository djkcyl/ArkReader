import type { AudioPort } from './runtime';
import type { StoryAudio } from './audio';
type Track = {
  intro: string;
  loop: string;
  at: number;
  level: number;
  from: number;
  start: number;
  end: number;
  stop: boolean;
};
/** A silent scene-clock ledger during seeking; publish only sounds still alive
 * at the landing point, using the decoded clips' actual durations. */
export class RestoringAudio implements AudioPort {
  restoring = false;
  private bgm?: Track;
  private sounds = new Map<string, Track>();
  constructor(
    private real: StoryAudio,
    private time: () => number,
  ) {}
  private track(intro: string, loop: string, volume: number, delay: number): Track {
    return {
      intro,
      loop,
      at: this.time() + Math.max(0, delay),
      level: volume,
      from: volume,
      start: 0,
      end: 0,
      stop: false,
    };
  }
  private volume(t: Track) {
    return t.end <= t.start
      ? t.level
      : t.from +
          (t.level - t.from) *
            Math.max(0, Math.min(1, (this.time() - t.start) / (t.end - t.start)));
  }
  private alive(t: Track) {
    return (
      !(t.stop && this.time() >= t.end) &&
      (!!t.loop || this.time() - t.at < (this.real.buffers.get(t.intro)?.duration ?? 0))
    );
  }
  private ramp(t: Track | undefined, volume: number, fade: number, stop = false) {
    if (t) {
      t.from = this.volume(t);
      t.level = volume;
      t.start = this.time();
      t.end = t.start + Math.max(0, fade);
      t.stop = stop;
    }
  }
  music(intro: string, loop: string, volume: number, delay: number, fade: number) {
    if (!this.restoring) return this.real.music(intro, loop, volume, delay, fade);
    if (this.bgm && !this.alive(this.bgm)) this.bgm = undefined;
    if (this.bgm?.intro === intro && this.bgm.loop === loop) {
      this.ramp(this.bgm, volume, 0);
      return;
    }
    this.bgm = this.track(intro, loop, volume, delay);
  }
  stopMusic(fade: number) {
    if (!this.restoring) return this.real.stopMusic(fade);
    this.ramp(this.bgm, 0, fade, true);
  }
  musicVolume(volume: number, fade: number) {
    if (!this.restoring) return this.real.musicVolume(volume, fade);
    if (volume >= 0 && this.bgm && this.alive(this.bgm)) this.ramp(this.bgm, volume, fade);
  }
  sound(key: string, channel: string, volume: number, delay: number, loop: boolean) {
    if (!this.restoring) return this.real.sound(key, channel, volume, delay, loop);
    this.sounds.set(channel, this.track(loop ? '' : key, loop ? key : '', volume, delay));
  }
  stopSound(channel: string, fade: number) {
    if (!this.restoring) return this.real.stopSound(channel, fade);
    this.ramp(this.sounds.get(channel), 0, fade, true);
  }
  soundVolume(channel: string, volume: number, fade: number) {
    if (!this.restoring) return this.real.soundVolume(channel, volume, fade);
    const track = this.sounds.get(channel);
    if (volume >= 0 && track && this.alive(track)) this.ramp(track, volume, fade);
  }
  stop() {
    if (!this.restoring) return this.real.stop();
    this.bgm = undefined;
    this.sounds.clear();
  }
  pause(paused: boolean) {
    if (!this.restoring) this.real.pause(paused);
  }
  finish() {
    this.restoring = false;
    const delay = (t: Track) => Math.max(0, t.at - this.time()),
      offset = (t: Track) => Math.max(0, this.time() - t.at);
    if (this.bgm && this.alive(this.bgm)) {
      const t = this.bgm;
      this.real.music(t.intro, t.loop, this.volume(t), delay(t), 0, offset(t));
      if (t.end > this.time()) {
        if (t.stop) this.real.stopMusic(t.end - this.time());
        else this.real.musicVolume(t.level, t.end - this.time());
      }
    }
    for (const [channel, t] of this.sounds)
      if (this.alive(t)) {
        this.real.sound(t.intro || t.loop, channel, this.volume(t), delay(t), !!t.loop, offset(t));
        if (t.end > this.time()) {
          if (t.stop) this.real.stopSound(channel, t.end - this.time());
          else this.real.soundVolume(channel, t.level, t.end - this.time());
        }
      }
    this.bgm = undefined;
    this.sounds.clear();
  }
}
