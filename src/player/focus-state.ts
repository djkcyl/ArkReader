import type { FocusConfig } from './focus-filter';
export interface FocusCommand {
  type: string;
  id: string;
  from: number;
  to: number;
  duration: number;
  block: boolean;
}
interface Job {
  key: string;
  from: number;
  to: number;
  begin: number;
  duration: number;
  done?: () => void;
}
const epsilon = 1e-5;
// FOCUSOUT_CHANNELS["lbg"], in the order bound by LargeBackgroundPanel.
export const panoramaFocusKeys = ['ck_lbg_1', 'ck_lbg_2', 'ck_lbg_3', 'ck_lbg_4'] as const;
export class FocusState {
  readonly amounts = new Map<string, number>();
  readonly config: FocusConfig = { blur: true, color: 'none', highResolution: false };
  private jobs: Job[] = [];
  get deadlines(): number[] {
    return this.jobs.map((j) => j.begin + j.duration);
  }
  get active(): boolean {
    return [...this.amounts.values()].some((n) => n > epsilon);
  }
  get(type: string): number {
    return this.amounts.get(type === 'lbg' ? panoramaFocusKeys[0] : type) ?? 0;
  }
  forget(key: string): void {
    if (key === 'lbg') {
      for (const channel of panoramaFocusKeys) this.forget(channel);
      return;
    }
    this.amounts.delete(key);
    const old = this.jobs.filter((job) => job.key === key);
    this.jobs = this.jobs.filter((job) => job.key !== key);
    for (const job of old) job.done?.();
  }
  configure(blur: boolean, effect: string): void {
    this.config.blur = blur;
    this.config.color =
      effect === 'Grayscale' ? 'grayscale' : effect === 'Colorinverse' ? 'inverse' : 'none';
  }
  execute(p: FocusCommand, time: number, done: () => void): void {
    const key = ['bg', 'cg', 'char'].includes(p.type)
      ? p.type
      : p.type === 'cgitem' && p.id
        ? 'cgitem:' + p.id
        : '';
    const keys: readonly string[] = p.type === 'lbg' ? panoramaFocusKeys : key ? [key] : [];
    if (!keys.length) {
      done();
      return;
    }
    const old = this.jobs.filter((j) => keys.includes(j.key));
    this.jobs = this.jobs.filter((j) => !keys.includes(j.key));
    for (const job of old) job.done?.();
    let remaining = keys.length;
    const finish = () => {
      if (--remaining === 0) done();
    };
    for (const channel of keys) {
      if (p.from >= -epsilon) this.amounts.set(channel, p.from);
      if (p.duration <= epsilon) this.amounts.set(channel, p.to);
      else
        this.jobs.push({
          key: channel,
          from: this.get(channel),
          to: p.to,
          begin: time,
          duration: p.duration,
          done: p.block ? finish : undefined,
        });
    }
    if (!p.block || p.duration <= epsilon) done();
  }
  update(time: number): void {
    for (const j of [...this.jobs]) {
      if (!this.jobs.includes(j)) continue;
      const t = time >= j.begin + j.duration ? 1 : Math.max(0, (time - j.begin) / j.duration),
        e = t * t * (3 - 2 * t);
      this.amounts.set(j.key, j.from + (j.to - j.from) * e);
      if (t >= 1) {
        this.jobs = this.jobs.filter((x) => x !== j);
        j.done?.();
      }
    }
  }
  dispose(): void {
    this.jobs = [];
    this.amounts.clear();
    this.config.blur = true;
    this.config.color = 'none';
  }
}
