import { nativeBoolean } from '../core/values';
type View = {
  x: number;
  y: number;
  alpha: number;
  rotation?: number;
  scale?: number;
};
type Field = 'x' | 'y' | 'alpha' | 'rotation' | 'scale';
interface Param {
  fields: Field[];
  from: number[];
  to: number[];
  duration: number;
  join: boolean;
}
interface Track extends Param {
  start: number;
  initial?: number[];
  complete?: boolean;
}
interface Sequence {
  view: View;
  begin: number;
  ratio: number;
  tracks: Track[];
  killed?: boolean;
}
const value = (p: Record<string, unknown>, key: string) => Number(p[key] ?? 0);
// AVGUtils.GenVec reads exactly two comma-separated coordinates; z is zero.
const vec = (s: unknown): number[] => {
  const parts = String(s ?? '').split(',');
  return parts.length === 2 && parts.every((n) => n.trim() && Number.isFinite(Number(n)))
    ? parts.map((n) => Number(n))
    : [0, 0];
};
export class StickerTweens {
  private states = new Map<
    View,
    {
      pending: Param[];
      last?: Sequence;
    }
  >();
  private sequences: Sequence[] = [];
  execute(view: View, p: Record<string, unknown>, time: number, ratio = 1) {
    let state = this.states.get(view);
    if (!state) {
      state = { pending: [] };
      this.states.set(view, state);
    }
    const join = nativeBoolean(p.join),
      end = nativeBoolean(p.isend);
    for (const [prefix, fields] of [
      ['p', ['x', 'y']],
      ['r', ['rotation']],
      ['a', ['alpha']],
      ['s', ['scale']],
    ] as [string, Field[]][]) {
      if (p[prefix + 'to'] === undefined) continue;
      const from = prefix === 'p' ? vec(p.pfrom) : [value(p, prefix + 'from')],
        to = prefix === 'p' ? vec(p.pto) : [value(p, prefix + 'to')];
      state.pending.push({
        fields,
        from,
        to,
        duration: Math.max(0, value(p, prefix + 'duration')),
        join,
      });
      // ExecuteTween is invoked once per nonempty parameter, including isend.
      if (!end) continue;
      let duration = 0,
        last = 0;
      const tracks: Track[] = [];
      for (const param of state.pending) {
        param.fields.forEach((key, i) => (view[key] = param.from[i]));
        const start = param.join ? last : duration;
        last = start;
        duration = Math.max(duration, start + param.duration);
        tracks.push({ ...param, start });
      }
      tracks.sort((a, b) => a.start - b.start);
      const sequence = { view, begin: time, ratio, tracks };
      this.sequences.push(sequence);
      state.last = sequence;
      state.pending = [];
    }
  }
  killLast(view: View) {
    const state = this.states.get(view);
    if (state?.last) state.last.killed = true;
  }
  resetView(view: View) {
    this.killLast(view);
    view.rotation = 0;
    view.scale = 1;
  }
  update(time: number) {
    for (const sequence of this.sequences) {
      if (sequence.killed) continue;
      const elapsed = (time - sequence.begin) * sequence.ratio;
      for (const t of sequence.tracks) {
        if (t.complete || elapsed < t.start) continue;
        t.initial ??= t.fields.map((k) => sequence.view[k] ?? (k === 'scale' ? 1 : 0));
        const progress = t.duration ? Math.min(1, (elapsed - t.start) / t.duration) : 1,
          eased = progress * (2 - progress);
        t.fields.forEach((key, i) => {
          const start = t.initial![i];
          let delta = t.to[i] - start;
          if (key === 'rotation') {
            delta = ((delta % 360) + 360) % 360;
            if (delta > 180) delta -= 360;
          }
          sequence.view[key] = start + delta * eased;
        });
        t.complete = progress === 1;
      }
    }
    this.sequences = this.sequences.filter((s) => !s.killed && s.tracks.some((t) => !t.complete));
  }
  clear() {
    this.sequences = [];
    this.states.clear();
  }
}
