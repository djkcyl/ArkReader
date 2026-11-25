export const SIGNAL_EFFECTS = ['avg_signalinterference_01'];
export interface ParticleGradient {
  constant?: number[];
  min?: number[];
  max?: number[];
  mode?: number;
  color?: number[][];
  alpha?: number[][];
}
export interface ParticleMaterial {
  name: string;
  shaderId?: string;
  shaderName?: string;
  vertexDisturb?: boolean;
  disturbScaleEnabled?: boolean;
  grabTexture?: string;
  shader:
    | 'alpha'
    | 'ram'
    | 'ui-ram'
    | 'disturb'
    | 'additive'
    | 'anchor'
    | 'dissolve'
    | 'dissolve-static'
    | 'dissolve-custom'
    | 'origin'
    | 'double-dissolve'
    | 'vertex-dissolve'
    | 'grab'
    | 'directional-grab'
    | 'builtin-error';
  blend: {
    srcBlend: number;
    destBlend: number;
    srcBlendAlpha: number;
    destBlendAlpha: number;
  };
  floats: Record<string, number>;
  colors: Record<string, number[]>;
  textures: Record<
    string,
    {
      key: string | null;
      st: number[];
    }
  >;
  keywords: string[];
}
export interface ParticleNode {
  id: string;
  name: string;
  position: number[];
  localScale: number[];
  flip: boolean;
  delay: number;
  duration: number;
  life: number[];
  sizeX: number[];
  sizeY: number[] | null;
  startColor: ParticleGradient;
  color: ParticleGradient | null;
  shape: number[] | null;
  speedZ: number;
  rate: number;
  bursts: number[][];
  maxParticles: number;
  maxSize: number;
  order: number;
  material: string;
}
export interface ParticleProfile {
  kind: 'signal-particles-v1';
  fadeType: 2;
  duration: number;
  renderOrders?: number[];
  nodes: ParticleNode[];
  materials: Record<string, ParticleMaterial>;
  textures: Record<
    string,
    {
      url: string;
      width: number;
      height: number;
      filter: number;
      wrapU: number;
      wrapV: number;
    }
  >;
}
export interface Particle {
  born: number;
  life: number;
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  color: number[];
  node: ParticleNode;
}
export function sampleGradient(g: ParticleGradient, t: number, random = 0): number[] {
  if (g.constant) return [...g.constant];
  if (g.min && g.max) return g.min.map((v, i) => v + (g.max![i] - v) * random);
  const sample = (keys: number[][]) => {
    if (g.mode === 1) return (keys.find((k) => k[0] > t) ?? keys.at(-1)!).slice(1);
    if (t <= keys[0][0]) return keys[0].slice(1);
    for (let i = 1; i < keys.length; i++)
      if (t <= keys[i][0]) {
        const a = keys[i - 1],
          b = keys[i];
        const u = (t - a[0]) / (b[0] - a[0]);
        return a.slice(1).map((v, j) => v + (b[j + 1] - v) * u);
      }
    return keys.at(-1)!.slice(1);
  };
  return [...sample(g.color!), ...sample(g.alpha!)];
}
// Auto-seeded prefabs have no stable cross-launch random trajectory. Inject a
// uniform source for repeatable checks; do not claim Unity RNG bit equivalence.
export class SignalParticles {
  readonly particles: Particle[] = [];
  private next: number[];
  private bursts: boolean[][];
  time = 0;
  readonly profile: ParticleProfile;
  private random: () => number;
  constructor(profile: ParticleProfile, random: () => number = Math.random) {
    this.profile = profile;
    this.random = random;
    this.next = profile.nodes.map((n) => (n.rate ? 1 / n.rate : Infinity));
    this.bursts = profile.nodes.map((n) => n.bursts.map(() => false));
  }
  private range(v: number[]) {
    return v[0] + (v[1] - v[0]) * this.random();
  }
  update(time: number, capacity: (at: number) => number = () => 1): void {
    if (time < this.time) throw new Error('Particle simulation cannot rewind');
    for (const [i, n] of this.profile.nodes.entries()) {
      const events: number[] = [];
      for (const [j, b] of n.bursts.entries())
        if (!this.bursts[i][j] && time >= n.delay + b[0]) {
          this.bursts[i][j] = true;
          for (let k = 0; k < b[1]; k++) events.push(n.delay + b[0]);
        }
      while (this.next[i] < n.duration && n.delay + this.next[i] <= time) {
        events.push(n.delay + this.next[i]);
        this.next[i] += 1 / n.rate;
      }
      for (const at of events.sort((a, b) => a - b)) {
        const live = this.particles.filter((p) => p.node === n && p.born + p.life > at);
        if (live.length >= Math.trunc(n.maxParticles * capacity(at))) continue;
        const life = this.range(n.life),
          w = this.range(n.sizeX),
          h = n.sizeY ? this.range(n.sizeY) : w;
        const x = n.shape ? (this.random() - 0.5) * n.shape[0] * n.localScale[0] * 100 : 0,
          y = n.shape ? (this.random() - 0.5) * n.shape[1] * n.localScale[1] * 100 : 0;
        this.particles.push({
          born: at,
          life,
          x: n.position[0] + x,
          y: n.position[1] + y,
          z: n.position[2],
          w: w * n.localScale[0] * 100,
          h: h * n.localScale[1] * 100,
          color: sampleGradient(n.startColor, at, this.random()),
          node: n,
        });
      }
      const live = this.particles.filter((p) => p.node === n && p.born + p.life > time),
        limit = Math.trunc(n.maxParticles * capacity(time));
      // A reduced native maxParticles removes excess particles, not opacity.
      const removed = new Set(live.slice(Math.max(0, limit)));
      for (let k = this.particles.length - 1; k >= 0; k--)
        if (
          removed.has(this.particles[k]) ||
          this.particles[k].born + this.particles[k].life <= time
        )
          this.particles.splice(k, 1);
    }
    this.time = time;
  }
  color(p: Particle) {
    const gradient = p.node.color
      ? sampleGradient(p.node.color, (this.time - p.born) / p.life)
      : [1, 1, 1, 1];
    return p.color.map((v, i) => v * gradient[i]);
  }
}
