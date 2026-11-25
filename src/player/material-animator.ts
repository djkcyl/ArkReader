import {
  readStreamedCurves,
  sampleStreamedCurve,
  type StreamKey,
} from '../core/animation-curve.ts';
import type { ParticleMaterial } from './particles.ts';
export interface MaterialBinding {
  renderer: string | null;
  property: string;
  component: number;
  pathHash: number;
  references?: number[];
  kind?:
    | 'materialReference'
    | 'color'
    | 'vector'
    | 'textureST'
    | 'float'
    | 'transformPosition'
    | 'transformScale'
    | 'transformEuler'
    | 'unchangedActive'
    | 'unboundScale'
    | 'unboundScriptFloat'
    | 'unboundRendererFloat'
    | 'trailProperty'
    | 'particleProperty'
    | 'particleSpeed'
    | 'gameObjectActive';
}
export interface MaterialClip {
  name: string;
  duration: number;
  loop: boolean;
  curveCount: number;
  streamed: number[];
  constants: number[];
  bindings: MaterialBinding[];
}
export interface MaterialAnimation {
  trailDefaults?: Record<string, Record<string, number>>;
  materialReferenceDefaults?: Record<string, Record<string, number>>;
  materialReferences?: string[];
  defaultState: number;
  particleDefaults?: Record<string, Record<string, number>>;
  particleSpeedDefaults?: Record<string, number>;
  rootPositionTarget?: string | null;
  defaultBools?: Record<string, boolean>;
  scaleDefaults?: Record<
    string,
    {
      x: number;
      y: number;
      z: number;
    }
  >;
  transformDefaults?: Record<
    string,
    {
      x: number;
      y: number;
      z: number;
    }
  >;
  activeDefaults?: Record<string, boolean>;
  rotationDefaults?: Record<
    string,
    {
      x: number;
      y: number;
      z: number;
      w: number;
    }
  >;
  states: {
    name: string;
    clip: number | null;
    speed?: number;
    writeDefaults?: boolean;
    transitions: {
      destination: number;
      exitTime: number;
      duration: number;
      endRequired: boolean;
      offset?: number;
      conditions?: {
        parameter: string;
        value: boolean;
      }[];
    }[];
  }[];
  clips: MaterialClip[];
}
interface Transition {
  destination: number;
  duration: number;
  weight: number;
  destinationTime: number;
}
export interface MaterialAnimation {
  triggerParameters?: string[];
}
const key = (b: MaterialBinding) =>
  b.renderer + ':' + (b.kind ?? 'color') + ':' + b.property + ':' + b.component;
/** Blend authored poses with ordinary interpolation. */
function blendPoseValue(source: number, destination: number, weight: number): number {
  if (weight <= 0) return source;
  if (weight >= 1) return destination;
  return source * (1 - weight) + destination * weight;
}
export function nativeActiveValue(value: number): boolean {
  return value > 0.001 || value < -0.001;
}
/** Transition gates use normalized animation time.
 * Exit times <= 1 are tested at cycle crossings, even for non-looping clips.
 * A late condition must wait for the next crossing; it is not a >= deadline.
 */
export function nativeExitTime(
  previous: number,
  current: number,
  exitTime: number,
  direction = 1,
): number | null {
  const crossed = (a: number, b: number) =>
    direction < 0 ? a > exitTime && exitTime >= b : exitTime > a && b >= exitTime;
  if (exitTime > 1) return crossed(previous, current) ? current - exitTime : null;
  const before = Math.trunc(previous),
    after = Math.trunc(current);
  for (const cycle of before === after ? [before] : [before, after]) {
    const a = previous - cycle,
      b = current - cycle;
    if (crossed(a, b)) return b - exitTime;
  }
  return null;
}
/** Wrap looping clips and hold nonlooping clips at their final pose. */
export function nativeClipTime(time: number, duration: number, loop: boolean): number {
  if (duration <= 0) return 0;
  return loop ? ((time % duration) + duration) % duration : Math.max(0, Math.min(duration, time));
}
export class MaterialAnimator {
  private definition: MaterialAnimation;
  private keys: StreamKey[][][];
  private defaults = new Map<string, number>();
  private bindings = new Map<string, MaterialBinding>();
  private values = new Map<string, number>();
  private outputs = new WeakMap<ParticleMaterial, Map<string, ParticleMaterial>>();
  state: number;
  time = 0;
  speed = 1;
  private stateDuration = 1;
  endRequested = false;
  finished = false;
  private transition: Transition | null = null;
  private bools: Record<string, boolean>;
  private materialLibrary: Record<string, ParticleMaterial>;
  constructor(
    definition: MaterialAnimation,
    materials: Map<string, ParticleMaterial>,
    materialLibrary: Record<string, ParticleMaterial> = {},
  ) {
    this.materialLibrary = materialLibrary;
    this.definition = definition;
    this.bools = { ...definition.defaultBools };
    this.state = definition.defaultState;
    this.keys = definition.clips.map((c) => readStreamedCurves(c.streamed, c.curveCount));
    for (const clip of definition.clips)
      for (const b of clip.bindings)
        if (b.renderer) {
          const id = key(b);
          if (b.kind === 'materialReference') {
            this.bindings.set(id, b);
            this.defaults.set(
              id,
              definition.materialReferenceDefaults![b.renderer][String(b.component)],
            );
            continue;
          }
          if (b.kind === 'trailProperty') {
            this.bindings.set(id, b);
            this.defaults.set(id, definition.trailDefaults![b.renderer][b.property]);
            continue;
          }
          if (b.kind === 'particleProperty') {
            this.bindings.set(id, b);
            this.defaults.set(id, definition.particleDefaults![b.renderer][b.property]);
            continue;
          }
          if (b.kind === 'particleSpeed') {
            this.bindings.set(id, b);
            this.defaults.set(id, definition.particleSpeedDefaults![b.renderer]);
            continue;
          }
          if (b.kind === 'transformEuler') {
            this.bindings.set(id, b);
            continue;
          }
          if (b.kind === 'gameObjectActive') {
            this.bindings.set(id, b);
            this.defaults.set(id, Number(definition.activeDefaults?.[b.renderer] ?? true));
            continue;
          }
          if (b.kind === 'transformPosition' || b.kind === 'transformScale') {
            const value = (
              b.kind === 'transformScale' ? definition.scaleDefaults : definition.transformDefaults
            )?.[b.renderer];
            if (!value) throw new Error('动画 Transform 未绑定');
            this.bindings.set(id, b);
            this.defaults.set(id, [value.x, value.y, value.z][b.component]);
            continue;
          }
          const material = materials.get(b.renderer);
          if (!material) continue;
          this.bindings.set(id, b);
          this.defaults.set(
            id,
            b.kind === 'float'
              ? (material.floats[b.property] ?? 0)
              : ((b.kind === 'textureST'
                  ? material.textures[b.property]?.st
                  : material.colors[b.property])?.[b.component] ?? 0),
          );
        }
    this.values = new Map(this.defaults);
    this.stateDuration = this.effectiveDuration();
    this.resample();
  }
  private length(state = this.state) {
    const index = this.definition.states[state].clip;
    return index === null ? 1 : this.definition.clips[index].duration || 1;
  }
  // GetAnimatorStateInfo reads the duration cached by the last evaluation.
  // Changing Animator.speed alone does not update it until the next frame.
  private effectiveDuration() {
    return this.length() / (Math.abs(this.definition.states[this.state].speed ?? 1) * this.speed);
  }
  show(duration: number) {
    if (duration > 1e-5) this.speed = this.stateDuration / duration;
  }
  hide(duration: number) {
    this.endRequested = true;
    const parameter = String(0x38b17551);
    if (Object.hasOwn(this.bools, parameter)) this.bools[parameter] = true;
    if (this.definition.states[this.state].name === 'destroy') this.finished = true;
    if (duration > 1e-5) this.speed = this.stateDuration / duration;
  }
  private sample(state: number, time: number): Map<string, number> {
    const result = new Map(this.defaults),
      index = this.definition.states[state].clip;
    if (index === null) return result;
    const clip = this.definition.clips[index],
      at = nativeClipTime(time, clip.duration, clip.loop);
    clip.bindings.forEach((binding, i) => {
      if (binding.renderer && this.bindings.has(key(binding))) {
        const value =
          i < clip.curveCount
            ? sampleStreamedCurve(this.keys[index][i], at)
            : clip.constants[i - clip.curveCount];
        result.set(
          key(binding),
          binding.kind === 'materialReference' ? binding.references![value] : value,
        );
      }
    });
    return result;
  }
  private resample() {
    // EvaluateStateDuration clears old leaf weights before evaluating an empty
    // state. With defaults enabled it contributes no mask; without defaults it
    // captures the previously committed pose. Neither resamples the old clip.
    if (this.definition.states[this.state].clip === null) return;
    const previous = this.values;
    this.values = this.sample(this.state, this.time);
    const tr = this.transition;
    if (!tr) return;
    const destination = this.definition.states[tr.destination],
      weight = Math.min(1, tr.weight);
    if (destination.clip === null) {
      if (destination.writeDefaults === false) {
        for (const [id, value] of this.values)
          this.values.set(id, blendPoseValue(value, previous.get(id)!, weight));
      } else {
        // The target has no channels. ValueArrayBlendEnd fills the missing source
        // weight with defaults; it computes the complement from source weight.
        for (const [id, value] of this.values)
          this.values.set(id, blendPoseValue(value, this.defaults.get(id)!, weight));
      }
    } else {
      const other = this.sample(tr.destination, tr.destinationTime);
      for (const [id, value] of this.values)
        this.values.set(id, blendPoseValue(value, other.get(id)!, weight));
    }
  }
  update(dt: number) {
    if (this.finished) return;
    dt = Math.max(0, dt);
    const step = dt * this.speed,
      length = this.length() || 1;
    const stateSpeed = (state: number) =>
      Math.abs(this.definition.states[state].speed ?? 1) * this.speed;
    const previous = this.time / length;
    this.time += dt * stateSpeed(this.state);
    const current = this.time / length;
    if (this.transition) {
      const tr = this.transition;
      tr.destinationTime += dt * stateSpeed(tr.destination);
      tr.weight = tr.duration > 0 ? tr.weight + step / tr.duration : 1;
    } else {
      for (const tr of this.definition.states[this.state].transitions) {
        const overshoot = nativeExitTime(previous, current, tr.exitTime);
        if (
          overshoot === null ||
          !(tr.conditions
            ? tr.conditions.every((c) => this.bools[c.parameter] === c.value)
            : !tr.endRequired || this.endRequested)
        )
          continue;
        for (const c of tr.conditions ?? [])
          if (c.value && this.definition.triggerParameters?.includes(c.parameter))
            this.bools[c.parameter] = false;
        const elapsed = overshoot * (length / stateSpeed(this.state)),
          destinationLength = this.length(tr.destination) || 1;
        this.transition = {
          destination: tr.destination,
          duration: tr.duration,
          weight: tr.duration > 0 ? elapsed / tr.duration : 1,
          destinationTime:
            elapsed * stateSpeed(tr.destination) + (tr.offset ?? 0) * destinationLength,
        };
        break;
      }
    }
    // The original promotes at most one state per evaluation. A large update
    // carries overshoot into its destination, not through the entire graph.
    const tr = this.transition;
    if (tr && tr.weight >= 1) {
      this.state = tr.destination;
      this.time = tr.destinationTime;
      this.transition = null;
      if (this.definition.states[this.state].name === 'destroy') this.finished = this.endRequested;
    }
    this.stateDuration = this.effectiveDuration();
    this.resample();
  }
  materialReference(
    renderer: string | undefined,
    source: ParticleMaterial,
    slot = 0,
  ): ParticleMaterial {
    if (!renderer) return source;
    const index = this.values.get(renderer + ':materialReference:m_Materials:' + slot);
    if (index === undefined) return source;
    const material = this.materialLibrary[this.definition.materialReferences![index]];
    if (!material) throw new Error('动画材质引用未绑定');
    return material;
  }
  material(renderer: string | undefined, source: ParticleMaterial): ParticleMaterial {
    const isMaterial = (b: MaterialBinding) =>
      b.kind !== 'materialReference' &&
      b.kind !== 'trailProperty' &&
      b.kind !== 'particleProperty' &&
      b.kind !== 'particleSpeed' &&
      b.kind !== 'transformPosition' &&
      b.kind !== 'transformScale' &&
      b.kind !== 'transformEuler' &&
      b.kind !== 'gameObjectActive';
    if (
      !renderer ||
      ![...this.bindings.values()].some((b) => b.renderer === renderer && isMaterial(b))
    )
      return source;
    let byRenderer = this.outputs.get(source);
    if (!byRenderer) {
      byRenderer = new Map();
      this.outputs.set(source, byRenderer);
    }
    let output = byRenderer.get(renderer);
    if (!output) {
      output = { ...source, colors: { ...source.colors } };
      byRenderer.set(renderer, output);
    }
    output.textures = { ...source.textures };
    output.floats = source.floats;
    for (const [id, b] of this.bindings)
      if (b.renderer === renderer && isMaterial(b)) {
        if (b.kind === 'float') {
          if (output.floats === source.floats) output.floats = { ...source.floats };
          output.floats[b.property] = this.values.get(id)!;
        } else if (b.kind === 'textureST') {
          const slot = output.textures[b.property];
          if (!slot) throw new Error('动画纹理属性未绑定：' + b.property);
          if (slot === source.textures[b.property])
            output.textures[b.property] = { ...slot, st: [...slot.st] };
          output.textures[b.property].st[b.component] = this.values.get(id)!;
        } else {
          const color = output.colors[b.property] ?? [
            ...(source.colors[b.property] ?? [0, 0, 0, 0]),
          ];
          if (color === source.colors[b.property]) output.colors[b.property] = [...color];
          else output.colors[b.property] = color;
          output.colors[b.property][b.component] = this.values.get(id)!;
        }
      }
    return output;
  }
  active(target: string): boolean | null {
    if (!Object.hasOwn(this.definition.activeDefaults ?? {}, target)) return null;
    const value =
      this.values.get(target + ':gameObjectActive:m_IsActive:0') ??
      Number(this.definition.activeDefaults![target]);
    return nativeActiveValue(value);
  }
  rotation(target: string): {
    x: number;
    y: number;
    z: number;
    w: number;
  } | null {
    const initial = this.definition.rotationDefaults?.[target];
    if (!initial) return null;
    const angles = [0, 1, 2].map((i) =>
      this.values.get(target + ':transformEuler:localEulerAnglesRaw:' + i),
    );
    if (angles.some((a) => a === undefined)) return initial;
    const [x, y, z] = angles.map((a) => (a! * Math.PI) / 360),
      sx = Math.sin(x),
      cx = Math.cos(x),
      sy = Math.sin(y),
      cy = Math.cos(y),
      sz = Math.sin(z),
      cz = Math.cos(z);
    return {
      x: sx * cy * cz + cx * sy * sz,
      y: cx * sy * cz - sx * cy * sz,
      z: cx * cy * sz - sx * sy * cz,
      w: cx * cy * cz + sx * sy * sz,
    };
  }
  scale(target: string): number[] | null {
    const base = this.definition.scaleDefaults?.[target];
    if (!base) return null;
    return [base.x, base.y, base.z].map(
      (v, i) => this.values.get(target + ':transformScale:m_LocalScale:' + i) ?? v,
    );
  }
  trailProperty(id: string, path: string): number | undefined {
    return this.values.get(id + ':trailProperty:' + path + ':0');
  }
  particleProperties(id: string): [string, number][] {
    return Object.keys(this.definition.particleDefaults?.[id] ?? {}).map((path) => [
      path,
      this.values.get(id + ':particleProperty:' + path + ':0')!,
    ]);
  }
  simulationSpeed(id: string): number | undefined {
    return this.values.get(id + ':particleSpeed:simulationSpeed:0');
  }
  position(target: string): number[] | null {
    const position = this.definition.transformDefaults?.[target];
    if (!position) return null;
    const result = [position.x, position.y, position.z];
    for (const [id, b] of this.bindings)
      if (b.renderer === target && b.kind === 'transformPosition')
        result[b.component] = this.values.get(id)!;
    return result;
  }
}
