// Windows 2.7.91 native curtain widgets. Coordinates are Unity UI coordinates.
export interface CurtainState {
  direction: number;
  width: number;
  height: number;
  alpha: number;
  active: boolean;
  gradient: boolean;
  feather: boolean;
}
export interface CurtainConfig {
  width: number;
  height: number;
  x: number;
  y: number;
  angle: number;
  pivotX: number;
  pivotY: number;
  axis: 'x' | 'y';
  padding: number;
  side: 'top' | 'bottom' | 'left' | 'right';
}
export const CURTAIN_CONFIGS: CurtainConfig[] = [
  {
    width: 1280,
    height: 720,
    x: 640,
    y: 720,
    angle: 0,
    pivotX: 0.5,
    pivotY: 1,
    axis: 'y',
    padding: 20,
    side: 'top',
  },
  {
    width: 1600,
    height: 1600,
    x: 1204.685546875,
    y: 960.68536376953125,
    angle: -45,
    pivotX: 0.5,
    pivotY: 1,
    axis: 'y',
    padding: 0,
    side: 'top',
  },
  {
    width: 1280,
    height: 720,
    x: 1280,
    y: 360,
    angle: 0,
    pivotX: 1,
    pivotY: 0.5,
    axis: 'x',
    padding: 20,
    side: 'right',
  },
  {
    width: 1600,
    height: 1600,
    x: 1201.485107421875,
    y: -218.1842041015625,
    angle: 45,
    pivotX: 0.5,
    pivotY: 0,
    axis: 'y',
    padding: 0,
    side: 'bottom',
  },
  {
    width: 1280,
    height: 720,
    x: 640,
    y: 0,
    angle: 0,
    pivotX: 0.5,
    pivotY: 0,
    axis: 'y',
    padding: 20,
    side: 'bottom',
  },
  {
    width: 1600,
    height: 1600,
    x: 70.1143798828125,
    y: -218.18438720703125,
    angle: -45,
    pivotX: 0.5,
    pivotY: 0,
    axis: 'y',
    padding: 0,
    side: 'bottom',
  },
  {
    width: 1280,
    height: 720,
    x: 0,
    y: 360,
    angle: 0,
    pivotX: 0,
    pivotY: 0.5,
    axis: 'x',
    padding: 20,
    side: 'left',
  },
  {
    width: 1600,
    height: 1600,
    x: 73.3148193359375,
    y: 960.685546875,
    angle: 45,
    pivotX: 0.5,
    pivotY: 1,
    axis: 'y',
    padding: 0,
    side: 'top',
  },
];
export function newCurtains(): CurtainState[] {
  return CURTAIN_CONFIGS.map((c, direction) => ({
    direction,
    width: c.width,
    height: c.height,
    alpha: 1,
    active: false,
    gradient: false,
    feather: true,
  }));
}
export function curtainSize(direction: number, fill: number): [number, number] {
  const c = CURTAIN_CONFIGS[direction];
  return c.axis === 'x' ? [c.width * fill, c.height] : [c.width, c.height * fill];
}
export interface CurtainCommand {
  direction: number;
  from: number;
  to: number;
  duration: number;
  delay: number;
  gradient: boolean;
  block: boolean;
  alphaFrom?: number;
  alphaTo: number;
}
type CurtainJob = {
  hide?: boolean;
  state: CurtainState;
  begin: number;
  duration: number;
  values: Partial<Record<'width' | 'height' | 'alpha', number>>;
  from?: Partial<Record<'width' | 'height' | 'alpha', number>>;
  done?: () => void;
};
export class CurtainPlayer {
  readonly states = newCurtains();
  private jobs: CurtainJob[] = [];
  get deadlines(): number[] {
    return this.jobs.map((j) => j.begin + j.duration);
  }
  private reset(state: CurtainState): void {
    this.jobs = this.jobs.filter((j) => j.state !== state || !j.hide);
    const c = CURTAIN_CONFIGS[state.direction];
    Object.assign(state, {
      width: c.width,
      height: c.height,
      alpha: 1,
      active: false,
      feather: true,
    });
  }
  execute(p: CurtainCommand, time: number, done: () => void): void {
    if (p.direction < 0) {
      for (const state of this.states) {
        this.jobs = this.jobs.filter((j) => j.state !== state || !j.hide);
        if (Math.abs(p.duration) <= 1e-5) this.reset(state);
        else
          this.jobs.push({
            hide: true,
            state,
            begin: time,
            duration: Math.max(0, p.duration),
            values: { width: 0, height: 0 },
            done: () => this.reset(state),
          });
      }
      done();
      return;
    }
    const state = this.states[p.direction];
    if (!state) {
      done();
      return;
    }
    const [width, height] = curtainSize(p.direction, p.from),
      [toWidth, toHeight] = curtainSize(p.direction, p.to);
    state.active = true;
    state.gradient = p.gradient;
    state.feather = p.gradient || Math.abs(p.to - 1) > 0.01;
    state.width = width;
    state.height = height;
    state.alpha = p.alphaFrom ?? state.alpha;
    const values: {
      width: number;
      height: number;
      alpha?: number;
    } = { width: toWidth, height: toHeight };
    if (p.alphaTo >= -1e-5) values.alpha = p.alphaTo;
    if (Math.abs(p.duration) <= 1e-5) {
      Object.assign(state, values);
      done();
      return;
    }
    this.jobs.push({
      state,
      begin: time + Math.max(0, p.delay),
      duration: Math.max(0, p.duration),
      values,
      done: p.block ? done : undefined,
    });
    if (!p.block) done();
  }
  update(time: number): void {
    for (const job of [...this.jobs]) {
      if (!this.jobs.includes(job) || time < job.begin) continue;
      job.from ??= Object.fromEntries(
        Object.keys(job.values).map((k) => [k, job.state[k as keyof CurtainJob['values']]]),
      );
      const t =
          job.duration <= 0 || time >= job.begin + job.duration
            ? 1
            : Math.min(1, (time - job.begin) / job.duration),
        e = t * (2 - t);
      for (const k of Object.keys(job.values) as (keyof CurtainJob['values'])[])
        job.state[k] = job.from[k]! + (job.values[k]! - job.from[k]!) * e;
      if (t >= 1) {
        this.jobs = this.jobs.filter((j) => j !== job);
        job.done?.();
      }
    }
  }
  dispose(): void {
    this.jobs = [];
    for (const state of this.states) this.reset(state);
  }
}
export function drawCurtains(ctx: CanvasRenderingContext2D, states: CurtainState[]): void {
  for (const state of states) {
    if (!state.active || state.alpha <= 0) continue;
    const c = CURTAIN_CONFIGS[state.direction],
      // The requested fill includes a gradient band only when it is painted.
      // Subtracting an inactive band moves hard edges away from script positions
      // (DT-1's bottom quarter became 160px instead of 180px).
      pad = state.gradient ? c.padding || 20 : 0;
    ctx.save();
    ctx.translate(c.x, 720 - c.y);
    ctx.rotate((-c.angle * Math.PI) / 180);
    ctx.globalAlpha = Math.max(0, Math.min(1, state.alpha));
    ctx.fillStyle = '#000';
    // Native layout does not control the cross-axis child size: it remains
    // 1280/720 (or diagonal 1600) even when HideCurtain shrinks both root axes.
    const horizontal = c.axis === 'x',
      length = horizontal ? state.width : state.height,
      solid = Math.max(0, length - pad);
    if (horizontal) {
      const left = c.side === 'right' ? -solid : 0;
      ctx.fillRect(left, -c.height / 2, solid, c.height);
      if (state.gradient) {
        const x = c.side === 'right' ? -length : length - 20,
          g = ctx.createLinearGradient(x, 0, x + 20, 0);
        g.addColorStop(0, c.side === 'right' ? '#0000' : '#000');
        g.addColorStop(1, c.side === 'right' ? '#000' : '#0000');
        ctx.fillStyle = g;
        ctx.fillRect(x, -c.height / 2, 20, c.height);
      }
    } else {
      const top = c.side === 'top' ? 0 : -solid;
      ctx.fillRect(-c.width / 2, top, c.width, solid);
      if (state.gradient) {
        const y = c.side === 'top' ? (c.padding ? length - 20 : Math.max(0, length - 20)) : -length,
          g = ctx.createLinearGradient(0, y, 0, y + 20);
        g.addColorStop(0, c.side === 'top' ? '#000' : '#0000');
        g.addColorStop(1, c.side === 'top' ? '#0000' : '#000');
        ctx.fillStyle = g;
        ctx.fillRect(-c.width / 2, y, c.width, 20);
      }
    }
    ctx.restore();
  }
}
