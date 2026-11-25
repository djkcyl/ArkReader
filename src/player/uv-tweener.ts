import type { ParticleMaterial } from './particles.ts';
export interface UVTween {
  renderer: string;
  advance: boolean;
  repeat: boolean;
  duration: number;
  keepInitOffset: boolean;
  shared: boolean;
  enabled?: boolean;
  maps: {
    name: string;
    speed: number[];
    wrap: boolean;
  }[];
}
interface Shared {
  material: ParticleMaterial;
  users: number;
}
export type SharedUVMaterials = WeakMap<ParticleMaterial, Shared>;
interface TweenState {
  definition: UVTween;
  material: ParticleMaterial;
  original: ParticleMaterial;
  time: number;
  maps: {
    name: string;
    speed: number[];
    wrap: boolean;
    st: number[];
  }[];
}
// FxUVTweener/Advance keep per-component cursors even when the output material
// comes from the shared MaterialManager pool. Do not add every cursor's speed.
export class UVTweener {
  private states: TweenState[] = [];
  private overrides = new Map<string, ParticleMaterial>();
  private pool: SharedUVMaterials;
  constructor(
    definitions: UVTween[],
    bindings: Map<string, ParticleMaterial>,
    pool: SharedUVMaterials,
  ) {
    this.pool = pool;
    for (const definition of definitions) {
      const original = bindings.get(definition.renderer);
      if (!original) throw new Error('UV tween renderer is not bound');
      let material: ParticleMaterial;
      if (definition.shared) {
        let shared = pool.get(original);
        if (!shared) {
          shared = { material: structuredClone(original), users: 0 };
          pool.set(original, shared);
        }
        shared.users++;
        material = shared.material;
      } else material = structuredClone(original);
      this.overrides.set(definition.renderer, material);
      this.states.push({
        definition,
        material,
        original,
        time: 0,
        maps: definition.maps.map((m) => {
          const st = [...(material.textures[m.name]?.st ?? [0, 0, 0, 0])];
          if (!definition.keepInitOffset) {
            st[2] = 0;
            st[3] = 0;
          }
          return { ...m, st };
        }),
      });
    }
  }
  update(dt: number) {
    for (const s of this.states) {
      if (s.definition.enabled === false) continue;
      if (s.definition.advance && !s.definition.repeat && s.time > s.definition.duration) continue;
      s.time = s.time + dt;
      for (const m of s.maps) {
        if (!m.speed[0] && !m.speed[1]) continue;
        for (let i = 0; i < 2; i++) {
          const step = dt * m.speed[i];
          m.st[i + 2] = m.st[i + 2] + (step + step);
          if (m.wrap) m.st[i + 2] = m.st[i + 2] - Math.floor(m.st[i + 2]);
        }
        const previous = s.material.textures[m.name];
        s.material.textures[m.name] = { key: previous?.key ?? null, st: [...m.st] };
      }
    }
  }
  material(renderer: string | undefined, fallback: ParticleMaterial) {
    return renderer ? (this.overrides.get(renderer) ?? fallback) : fallback;
  }
  dispose() {
    for (const s of this.states)
      if (s.definition.shared) {
        const shared = this.pool.get(s.original);
        if (shared && --shared.users === 0) this.pool.delete(s.original);
      }
    this.states = [];
    this.overrides.clear();
  }
}
