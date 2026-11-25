import { ParticleSeedSource, sharedParticleSeeds } from './particle-seeds.ts';
import { particleUVFrame } from './particle-uv.ts';
import { limitParticleMotion } from './particle-limits.ts';
import { particleCustomData, particleCustomStreams } from './particle-custom.ts';
import { ParticleShapeClock } from './particle-shape-clock.ts';
import { sampleParticleCurve } from './particle-curve.ts';
import {
  ParticleBirthRandom,
  particleBirthSpeed,
  type ParticleBirthInitial,
  type ParticleEmitReplay,
} from './particle-birth.ts';
import { appendParticleReplay } from './particle-replay.ts';
import {
  proceduralParticleMotion,
  proceduralParticleRotation,
} from './particle-procedural-motion.ts';
import {
  particleAge,
  birthParticlePercent,
  advanceParticlePercent,
  removeExpiredParticles,
  removeExpiredBirths,
} from './particle-lifetime.ts';
import { advanceParticleGravity, advanceNoiseScroll } from './particle-module-clock.ts';
import {
  ParticleStepClock,
  UIParticleFrameClock,
  particleStep,
  particleDelayStep,
} from './particle-timing.ts';
import {
  advanceParticleForce,
  particleVector,
  particleSpeed,
  particleRotation,
} from './particle-motion.ts';
import { particleSizeMultiplier } from './particle-size.ts';
import { particleLifetimeColor, particleColorByte } from './particle-color.ts';
import { StandaloneTrailHistory } from './standalone-trails.ts';
import { nativeColorByte } from '../core/color32.ts';
import { AnimatedEffectDelay } from './effect-delay.ts';
import { grabObjectDirection } from './directional-grab.ts';
import { particlePropertyValue, ParticleLoopClock } from './particle-properties.ts';
import { orbitalVelocity, orbitalRates } from './orbital-velocity.ts';
import {
  constantLifetimePrewarm,
  maximumConstantLifetime,
  prewarmFromLifetime,
} from './prewarm.ts';
import { delayedBirthInterval } from './particle-emission.ts';
import {
  randomEmissionVertex,
  emissionVertexColor,
  randomSurfacePoint,
  randomMeshEdgePoint,
} from './mesh-emission.ts';
import {
  effectPose,
  flipRotation,
  defaultEffectMotion,
  type EffectMotionOptions,
  type EffectPose,
} from './effect-motion.ts';
import {
  velocityQuad,
  meshVertexOffset,
  velocityMeshOffset,
  meshPivotOffset,
  stretchedVertices,
  EFFECT_WORLD_Z,
  SCENE_CAMERA_Z,
} from './particle-geometry.ts';
import {
  particleTrailLifetime,
  particleTrailPosition,
  expireTrailPoints,
  buildTrailPairs,
  updateTrail,
  updateUITrail,
  trailPositions,
  multiplyTrailColor,
  type TrailPoint,
} from './particle-trails.ts';
import {
  emitOverDistance,
  emitOverTime,
  emissionAgeFraction,
  type EmissionState,
} from './particle-emission.ts';
import { UVRotator, type UVRotation } from './uv-rotation.ts';
import { MaterialAnimator, type MaterialAnimation } from './material-animator.ts';
import { UVTweener, type UVTween, type SharedUVMaterials } from './uv-tweener.ts';
import {
  birthProbability,
  ParticleRandom,
  sampleKeys,
  sampleSingleSidedEdge,
  sampleCurve,
  sampleBox,
  sampleBoxShell,
  sampleCircle,
  sampleCone,
  sampleConeVolume,
  sampleSphere,
  burstLongitude,
  emissionDirection,
  billboardFlip,
  inheritBirthVelocity,
  randomUnitVector,
  type NativeCurve,
} from './particle-math.ts';
import { particleNoise } from './particle-noise.ts';
import {
  childBirthMatrix,
  childBirthVector,
  childPreSimulationSteps,
  type ChildBirthTransform,
} from './particle-child.ts';
import {
  particleNodeTransform,
  particleMatrixVector,
  invalidateParticleTransform,
} from './particle-node-transform.ts';
import {
  particleEmitterVelocity,
  particleBasisVector,
  particleShapeBasis,
} from './particle-transform.ts';
import { ordinaryParticleBounds, particleWorldBounds } from './particle-bounds.ts';
import { proceduralParticleBounds } from './particle-procedural-bounds.ts';
import { particleCurveRange } from './particle-curve.ts';
import { particleVisibilityResume, particleSupportsProcedural } from './particle-visibility.ts';
import { particleFrustumVisible, storyParticlePlanes } from './particle-frustum.ts';
import { particleChildSchedule } from './particle-child-schedule.ts';
import { sampleGradient, type ParticleProfile, type ParticleMaterial } from './particles.ts';
export const NATIVE_PARTICLE_EFFECTS = [
  'avg_077_flower',
  'avg_077_butterfly',
  'avg_nearl_trail',
  'avg_nearl_showup',
  'avg_077_boss_01',
  'avg_077_alloutattack_01',
  'avg_077_yukari_01',
  'avg_070_originium_01',
  'avg_070_chen_juqi_01',
  'avg_070_chen_jianqi_01',
  'avg_064_fireup_02',
  'avg_064_firework_01',
  'avg_073_code_01',
  'avg_66_mantra_source_stone',
  'avg_066_mantra_communication',
  'avg_066_mantra_open',
  "avg_066_fool's_transition",
  'avg_common_lensspeedlines_01',
  'avg_079_ice',
  'avg_079_leafmaskloop',
  'avg_066_mantra_close_up',
  'avg_079_yanwu_01',
  'avg_079_slash_fire_01',
  'avg_079_redsmoke_01',
  'avg_blood_01',
  'avg_blood_rain',
  'avg_060_m3_01',
  'avg_060_kal_01',
  'avg_spotlight_02',
  'avg_042_glow_02',
  'avg_059_purple_fire_01',
  'avg_042_glow_01',
  'avg_059_yellow_fire_01',
  'avg_060_red_dot_01',
  'avg_060_dust_01',
  'avg_072_light',
  'avg_smoke_ptc',
  'avg_073_smoke_01',
  'avg_042_glow_03',
  'avg_042_glow_04',
  'avg_black_fire_01',
  'avg_072_smokebomb',
  'avg_scifiscreen_01',
  'avg_line_01',
  'avg_071_smock_01',
  'avg_rain_01',
  'avg_foodaroma_01',
  'avg_062_cloud_01',
  'avg_spotlight_01',
  'avg_060_glitch_01',
  'avg_fire_01',
  'avg_048_smoke_01',
  'avg_snowstorm_01',
  'avg_043_yanchen_01',
  'avg_suduxian',
  'avg_rain_02',
  'avg_042_fire_01',
  'avg_clouds_01',
  'avg_059_yanwu_hei_01',
  'avg_snow_02',
  'avg_53_fengsha_01',
  'avg_056_tvnoise_01',
  'avg_059_yanwu_hei_02',
  'avg_yanwu_01',
  'avg_50_smoke_01',
  'avg_062_smoke_01',
  'avg_062_smoke_02',
  'avg_v071_glow_01',
  'avg_50_light_of_origin_stone_01',
  'avg_rain_03',
  'avg_v068_dust_01',
  'avg_v074_underwater_01',
  'avg_074_map_line',
  'avg_074_map_spin',
  'avg_074_map_glow_1',
  'avg_060_projection_die',
  'avg_060_projection_birth',
  'avg_060_projection_time',
  'avg_zuzong_01',
  'avg_foodaroma_02',
  'avg_058_hot_steam_01',
  'avg_062_tvnoise_01',
  'avg_064_television_01',
  'avg_069_firefly_01',
  'avg_50_sunlight_01',
  'avg_056_stage_01',
  'avg_056_stage_02',
  'avg_076_star',
  'avg_v068_rain_01',
  'avg_51_lantern_01',
  'avg_061_birth_01',
  'avg_craddle',
  'avg_073_light_01',
  'avg_slbell_glow_01',
  'avg_soul_glow',
  'avg_fireworks_01',
  'avg_blood_fire_01',
  'avg_073_blink_01',
  'avg_073_blink_02',
  'avg_v068_birds_01',
  'avg_energycircle_01',
  'avg_street_white_light_01',
  'avg_cross_star_explosion_01',
  'avg_golden_star_01',
  'avg_golden_melody_01',
  'avg_golden_melody_02',
  'avg_screen_disturb_1',
  'avg_screen_disturb_2',
  'avg_firefly_01',
  'avg_067_avalanche_01',
  'avg_072_snow',
  'avg_wlfmster_eye_01',
  'avg_wlfmster_eye_02',
  'avg_064_fireup_01',
  'avg_067_camara_01',
  'avg_tlxy_laugh',
  'avg_072_speech',
  'avg_common_lensspeedlines_02',
  'avg_073_oripathy_01',
  'avg_060_confusion_01',
  'avg_060_confusion_02_01',
  'avg_50_sound_wave_01',
  'avg_50_sound_wave_02',
  'avg_guafeng_01',
  'avg_034_magic_fire_01',
  'avg_034_magic_fire_02',
  'avg_062_white_01',
  'avg_062_black_01',
  'avg_fengsha_01',
  'avg_sunshine_01',
  'avg_sunlight_left_01',
  'avg_sunlight_right_01',
  'avg_shuihua_01',
  'avg_wlfmster_01',
  'avg_wlfmster_02',
  'avg_058_tyndall_01',
  'avg_058_snow_01',
  'avg_064_picture_tube_01',
  'avg_wind_01',
  'avg_old_tv_01',
  'avg_056_wlfmster_03',
  'avg_056_rainy_01',
  'avg_spotlight_02',
  'avg_sheep_show_01',
  'avg_steam_01',
  'avg_golden_ray',
  'avg_062_ice_01',
  'avg_056_wlfmster_01',
  'avg_071_light_01',
  'avg_snow_01',
  'avg_distorsion_01',
  'avg_black_fire_03',
  'avg_black_fire_02',
  'avg_051_sea_01',
  'avg_057_steam',
  'avg_061_glow_01',
  'avg_064_blood_falling_01',
  'avg_069_smoke_01',
  'avg_066_leaves_falling',
  'avg_061_church_01',
  'avg_061_church_02',
];
NATIVE_PARTICLE_EFFECTS.push('avg_v068_dissolve_01', 'avg_v068_flower_01');
type V = number[];
interface Transform {
  key?: string;
  activeSelf?: boolean;
  m_LocalPosition: {
    x: number;
    y: number;
    z: number;
  };
  m_LocalScale: {
    x: number;
    y: number;
    z: number;
  };
  m_LocalRotation: {
    x: number;
    y: number;
    z: number;
    w: number;
  };
}
interface ParticleMesh {
  positions: V[];
  uv: V[];
  triangles: number[][];
  colors?: V[];
  bounds?: {
    center: V;
    extent: V;
  };
}
export interface NativeNode {
  id: string;
  renderEnabled?: boolean;
  extraMeshPasses?: number;
  movingBirthEmitter?: boolean;
  emissionFadeTarget?: boolean;
  birthEmitters?: string[];
  birthProbabilities?: number[];
  rendererKey?: string;
  name: string;
  transforms: Transform[];
  modules: Record<string, any>;
  main: {
    subEmitterModuleEnabled?: boolean;
    cullingMode?: number;
    stopAction?: number;
    ringBufferMode?: number;
    ui?: boolean;
    moveWithTransform?: number;
    scalingMode?: number;
    lengthInSec: number;
    simulationSpeed: number;
    looping: boolean;
    prewarm: boolean;
    startDelay: NativeCurve;
    autoRandomSeed: boolean;
    randomSeed: number;
  };
  renderer: Record<string, any>;
  material: string;
  mesh?: ParticleMesh;
  meshVariants?: ParticleMesh[];
  emissionMesh?: {
    positions: V[];
    normals: V[];
    triangles: number[][];
    colorBytes?: V[];
    bounds?: {
      center: V;
      extent: V;
    };
  };
  trailMaterial?: string;
}
export interface StandaloneTrail {
  rendererKey: string;
  name: string;
  transforms: Transform[];
  material: string;
  order: number;
  time: number;
  minDistance: number;
  emitting: boolean;
  parameters: any;
}
export interface NativeParticleProfile {
  standaloneTrails?: StandaloneTrail[];
  imageBindings?: string[];
  sortingMode?: 'additive';
  ui?: boolean;
  kind: 'native-particles-v2';
  fadeType: 0 | 1 | 2 | 3 | 4;
  fadeAnimatorBound?: boolean;
  hasEffectItem: boolean;
  duration: number;
  renderOrders?: number[];
  nodes: NativeNode[];
  meshes: {
    name: string;
    rendererKey?: string;
    materialSlot?: number;
    submesh?: number;
    transforms: Transform[];
    positions: V[];
    uv: V[];
    triangles: number[][];
    material: string;
    order: number;
  }[];
  uvTweens?: UVTween[];
  uvRotations?: UVRotation[];
  delayedActivations?: {
    target: string;
    delay: number;
    animated?: boolean;
    initialActive?: boolean;
  }[];
  rootDelay?: number;
  animation?: MaterialAnimation | null;
  materials: Record<string, ParticleMaterial>;
  textures: ParticleProfile['textures'];
}
interface BirthEvent {
  at: number;
  world: V;
  velocity?: V;
  burstCount?: number;
  command?: {
    delta: number;
    phase: number;
    beginPhase: number;
    pending: number;
    flags: number;
    count: number;
    continuous: number;
    spacing: number;
    remainder: number;
  };
}
interface State {
  managerRegistered?: boolean;
  visibilityBounds?: V;
  culledAt?: number;
  visibilityFinished?: boolean;
  stoppedAt?: number;
  resetEmitterPosition?: boolean;
  emitterVelocity?: V;
  movingBirthTarget?: boolean;
  resumeAt?: number;
  shapeClock: ParticleShapeClock;
  birthRandom: ParticleBirthRandom;
  shapeRandom: ParticleRandom;
  noiseScroll?: number;
  uiClock?: UIParticleFrameClock;
  scheduledTime: number;
  stepClock: ParticleStepClock;
  delayEpoch?: number;
  loopClock: ParticleLoopClock;
  prewarmEnd?: number;
  birthStart?: number;
  clock?: {
    scene: number;
    simulation: number;
    rate: number;
  };
  dynamicScale: boolean;
  births?: BirthEvent[];
  node: NativeNode;
  random: ParticleRandom;
  seed: number;
  offset: V;
  time: number;
  trailTime?: number;
  delay: number;
  delayElapsed: number;
  enabled: boolean;
  enabledAt: number;
  emission: EmissionState;
  origin: V;
  particles: Live[];
}
interface Live {
  proceduralBorn?: boolean;
  unscaledVelocity?: V;
  percent: number;
  inverseLife: number;
  childEmission?: EmissionState[];
  nativeSize?: V;
  noiseSize?: number;
  born: number;
  life: number;
  position: V;
  velocity: V;
  initialVelocity: V;
  size: V;
  rotation: number;
  rotationX: number;
  rotationY: number;
  color: V;
  seed: number;
  previous: V;
  trail?: TrailPoint[];
}
export interface ParticleDraw {
  materialSlot?: number;
  rendererKey?: string;
  vertices: number[];
  grabDirections?: number[];
  uv: number[];
  color: number[];
  colors?: number[];
  material: ParticleMaterial;
  order: number;
  depth: number;
  custom: V;
}
// CalculateMeshIndexN (0xF3A990), uniform distribution without a scripted mesh override.
export function particleMeshIndex(seed: number, count: number) {
  return new ParticleRandom(seed, 'mesh').uint() % count;
}
const xyz = (v: { x: number; y: number; z: number }) => [v.x, v.y, v.z];
export function rotate(
  v: V,
  q: {
    x: number;
    y: number;
    z: number;
    w: number;
  },
): V {
  const t = [
    2 * (q.y * v[2] - q.z * v[1]),
    2 * (q.z * v[0] - q.x * v[2]),
    2 * (q.x * v[1] - q.y * v[0]),
  ];
  return [
    v[0] + q.w * t[0] + q.y * t[2] - q.z * t[1],
    v[1] + q.w * t[1] + q.z * t[0] - q.x * t[2],
    v[2] + q.w * t[2] + q.x * t[1] - q.y * t[0],
  ];
}
function world(
  v: V,
  chain: Transform[],
  direction = false,
  scale = true,
  root: EffectPose = { x: 0, y: 0, flip: 0 },
): V {
  let out = [...v];
  for (let index = chain.length - 1; index >= 0; index--) {
    const t = chain[index];
    out = rotate(
      out.map((x, i) => (scale ? x * xyz(t.m_LocalScale)[i] : x)),
      index === 0 ? (root.rotation ?? flipRotation(root.flip)) : t.m_LocalRotation,
    );
    if (!direction) {
      const p = index === 0 ? [root.x, root.y, root.z ?? 0] : xyz(t.m_LocalPosition);
      out = out.map((x, i) => x + p[i]);
    }
  }
  return out;
}
function localSpace(n: NativeNode) {
  return (n.main.moveWithTransform ?? 0) === 0;
}
export function worldVector(
  v: V,
  n: Pick<NativeNode, 'transforms'> & {
    main?: NativeNode['main'];
  },
  root: EffectPose,
): V {
  return particleMatrixVector(particleNodeTransform(n, root).matrix, v);
}
export function localVector(
  v: V,
  n: Pick<NativeNode, 'transforms'> & {
    main?: NativeNode['main'];
  },
  root: EffectPose,
): V {
  return particleMatrixVector(particleNodeTransform(n, root).inverse, v);
}
export function worldPosition(
  v: V,
  n: Pick<NativeNode, 'transforms'> & {
    main?: NativeNode['main'];
  },
  root: EffectPose,
): V {
  return particleMatrixVector(particleNodeTransform(n, root).matrix, v, true);
}
function particleScale(n: NativeNode, root: EffectPose = { x: 0, y: 0, flip: 0 }): V {
  return particleNodeTransform(n, root).scale;
}
function gradient(raw: any, t: number, r: number): V {
  if (raw.minMaxState === 0) return ['r', 'g', 'b', 'a'].map((k) => raw.maxColor[k]);
  if (raw.minMaxState === 2)
    return ['r', 'g', 'b', 'a'].map(
      (k) => raw.minColor[k] + (raw.maxColor[k] - raw.minColor[k]) * r,
    );
  const convert = (g: any) => ({
    mode: g.m_Mode,
    color: Array.from({ length: g.m_NumColorKeys }, (_, i) => [
      g['ctime' + i] / 65535,
      ...['r', 'g', 'b'].map((k) => g['key' + i][k]),
    ]),
    alpha: Array.from({ length: g.m_NumAlphaKeys }, (_, i) => [
      g['atime' + i] / 65535,
      g['key' + i].a,
    ]),
  });
  const hi = sampleGradient(convert(raw.maxGradient), raw.minMaxState === 4 ? r : t);
  if (raw.minMaxState === 1 || raw.minMaxState === 4) return hi;
  const lo = sampleGradient(convert(raw.minGradient), t);
  return lo.map((v, i) => v + (hi[i] - v) * r);
}
const curve = (m: any, k: string, t: number, r = 1) => sampleCurve(m[k], t, r);
export class NativeParticles {
  private standalone = new Map<string, StandaloneTrailHistory>();
  readonly states: State[];
  time = 0;
  private activationClock = 0;
  private hidden = false;
  private uv: UVTweener;
  private uvRotation: UVRotator;
  private animator: MaterialAnimator | null = null;
  private motion: EffectMotionOptions;
  private restartSeeds: ParticleSeedSource;
  private readonly activateRoot: boolean;
  private animatedDelays = new Map<string, AnimatedEffectDelay>();
  private emissionOverride: boolean | null = null;
  private enableEmissionAt: number | null = null;
  private readonly birthTargets = new Map<State, State[]>();
  private readonly birthParents = new Map<State, State[]>();
  private readonly commandClocks = new Map<
    State,
    {
      pending: number;
      flags: number;
    }
  >();
  private readonly simulationOrder: State[];
  readonly profile: NativeParticleProfile;
  private readonly uiPose?: (time: number) => EffectPose;
  private simulationPose: EffectPose | null = null;
  private visibilityCapacity: (at: number) => number = () => 1;
  constructor(
    profile: NativeParticleProfile,
    seed: number | ParticleSeedSource = sharedParticleSeeds(),
    hidden = false,
    shared: SharedUVMaterials = new WeakMap(),
    motion: EffectMotionOptions = defaultEffectMotion,
    activateRoot = false,
    uiPose?: (time: number) => EffectPose,
  ) {
    this.activateRoot = activateRoot;
    this.uiPose = uiPose;
    this.restartSeeds = typeof seed === 'number' ? new ParticleSeedSource(seed) : seed;
    this.motion = { ...motion };
    if (
      !!profile.animation?.particleDefaults ||
      Object.keys(profile.animation?.transformDefaults ?? {}).length ||
      Object.keys(profile.animation?.scaleDefaults ?? {}).length ||
      Object.keys(profile.animation?.rotationDefaults ?? {}).length
    )
      profile = {
        ...profile,
        nodes: profile.nodes.map((n) => ({
          ...n,
          ...(profile.animation?.particleDefaults
            ? { main: { ...n.main }, modules: structuredClone(n.modules) }
            : {}),
          transforms: n.transforms.map((t) => structuredClone(t)),
        })),
        meshes: profile.meshes.map((m) => ({
          ...m,
          transforms: m.transforms.map((t) => structuredClone(t)),
        })),
        standaloneTrails: profile.standaloneTrails?.map((m) => ({
          ...m,
          transforms: m.transforms.map((t) => structuredClone(t)),
        })),
      };
    this.profile = profile;
    this.hidden = hidden;
    const bindings = new Map<string, ParticleMaterial>();
    for (const n of [...profile.nodes, ...profile.meshes, ...(profile.standaloneTrails ?? [])])
      if (n.rendererKey && profile.materials[n.material] && !bindings.has(n.rendererKey))
        bindings.set(n.rendererKey, profile.materials[n.material]);
    this.uvRotation = new UVRotator(profile.uvRotations ?? []);
    this.uv = new UVTweener(profile.uvTweens ?? [], bindings, shared);
    if (profile.animation)
      this.animator = new MaterialAnimator(profile.animation, bindings, profile.materials);
    this.applyTransformAnimation();
    this.applyParticleAnimation();
    for (const d of profile.delayedActivations ?? [])
      if (d.animated)
        this.animatedDelays.set(
          d.target,
          new AnimatedEffectDelay(d.delay, d.initialActive !== false),
        );
    this.states = profile.nodes.map((node) => {
      const value = node.main.randomSeed >>> 0,
        random = new ParticleRandom(value),
        noiseRandom = new ParticleRandom(value);
      return {
        node,
        shapeClock: new ParticleShapeClock(),
        birthRandom: new ParticleBirthRandom(value),
        shapeRandom: new ParticleRandom(value),
        scheduledTime: 0,
        stepClock: new ParticleStepClock(),
        loopClock: new ParticleLoopClock(),
        dynamicScale:
          !!profile.ui ||
          node.transforms.some(
            (t) =>
              t.key &&
              (Object.hasOwn(profile.animation?.scaleDefaults ?? {}, t.key) ||
                (node.main.scalingMode === 0 &&
                  Object.hasOwn(profile.animation?.rotationDefaults ?? {}, t.key))),
          ),
        random,
        seed: value,
        offset: [noiseRandom.value(), noiseRandom.value(), noiseRandom.value()],
        time: 0,
        delayElapsed: 0,
        enabled: this.chainEnabled(node.transforms),
        enabledAt: 0,
        delay: node.main.prewarm
          ? 0
          : sampleParticleCurve(node.main.startDelay, 0, new ParticleRandom(value).value()),
        emission: { remainder: 0, spacing: 0, random },
        origin: worldPosition([0, 0, 0], node, this.rootPose(0)),
        particles: [],
      };
    });
    const parents = this.states.filter((s) => s.node.birthEmitters?.length);
    const byId = parents.length ? new Map(this.states.map((s) => [s.node.id, s])) : null;
    for (const parent of parents) {
      const targets = parent.node.birthEmitters!.map((id) => {
        const child = byId!.get(id);
        if (!child) throw Error('未绑定的出生子发射器：' + id);
        const owners = this.birthParents.get(child) ?? [];
        owners.push(parent);
        this.birthParents.set(child, owners);
        child.births ??= [];
        if (parent.node.movingBirthEmitter) {
          child.delay = 0;
          child.movingBirthTarget = true;
        }
        return child;
      });
      this.birthTargets.set(parent, targets);
    }
    // MarkAllSubEmitters separates child simulation from play-on-awake emission.
    // Preserve renderer order while parents enqueue births before children step.
    this.simulationOrder = this.birthTargets.size
      ? [...this.states.filter((s) => !s.births), ...this.states.filter((s) => s.births)]
      : this.states;
    if (!hidden) {
      // Awake initializes module storage from the authored seed; Play consumes
      // manager entropy only for active ordinary systems. ResetSeeds also resets
      // the resolved direct children, before their sub-emitter Play branch.
      for (const state of this.simulationOrder)
        if (state.enabled && !state.births) this.resetSeeds(state);
      for (const state of this.states)
        if (state.enabled)
          state.delay =
            state.movingBirthTarget || state.node.main.prewarm
              ? 0
              : sampleParticleCurve(
                  state.node.main.startDelay,
                  0,
                  new ParticleRandom(state.seed).value(),
                );
      this.prewarmHierarchy();
    }
  }
  private prewarmHierarchy(): void {
    // Parent Simulate updates only the parent. Each original Emit command
    // pre-simulates its new child range; existing child clocks do not advance.
    for (const state of this.simulationOrder)
      if (state.enabled && !state.births) this.prewarm(state);
  }
  private rootPose(time: number): EffectPose {
    const pose = this.uiPose?.(time) ?? effectPose(this.motion, time),
      key = this.profile.animation?.rootPositionTarget,
      position = key ? this.animator?.position(key) : null;
    return position ? { ...pose, x: position[0], y: position[1], z: position[2] } : pose;
  }
  private chainEnabled(chain: Transform[]): boolean {
    return chain.every((t, i) => {
      const delayed = t.key ? this.animatedDelays.get(t.key) : undefined;
      if (delayed) return delayed.active;
      return (
        ((t.key ? this.animator?.active(t.key) : null) ??
          (t.activeSelf !== false || (i === 0 && this.activateRoot))) &&
        !(this.profile.delayedActivations ?? []).some(
          (d) => !d.animated && d.target === t.key && this.activationClock < d.delay,
        )
      );
    });
  }
  private resetSeedStreams(s: State) {
    s.seed = this.restartSeeds.next(s.node.main);
    s.random = new ParticleRandom(s.seed);
    s.birthRandom = new ParticleBirthRandom(s.seed);
    s.shapeRandom = new ParticleRandom(s.seed);
    s.shapeClock = new ParticleShapeClock();
    s.noiseScroll = 0;
    const noise = new ParticleRandom(s.seed);
    s.offset = [noise.value(), noise.value(), noise.value()];
    s.emission = { remainder: 0, spacing: 0, random: s.random };
  }
  private resetSeeds(s: State) {
    this.resetSeedStreams(s);
    for (const child of new Set(this.birthTargets.get(s) ?? []))
      if (this.chainEnabled(child.node.transforms)) this.resetSeedStreams(child);
  }
  private deactivate(s: State) {
    s.managerRegistered = false;
    s.enabled = false;
    s.visibilityBounds = undefined;
    s.culledAt = undefined;
    s.visibilityFinished = false;
    s.resetEmitterPosition = false;
    s.stoppedAt = undefined;
    s.particles = [];
    if (s.births) s.births.length = 0;
    // Clear resets State+436, not the Update1b residual at State+0. Child Play
    // preserves that residual; ordinary Play resets it in activate below.
    s.clock = undefined;
  }
  private activate(s: State, time: number) {
    s.managerRegistered = true;
    s.enabled = true;
    s.culledAt = undefined;
    s.visibilityFinished = false;
    s.resetEmitterPosition = false;
    s.stoppedAt = undefined;
    if (s.births) {
      // Native Play's sub-emitter branch preserves phase and RNG. Re-anchor the
      // simulation-to-scene mapping without replaying the inactive interval.
      const rate = s.node.main.simulationSpeed;
      s.enabledAt =
        rate > 0 ? time - (s.scheduledTime - (s.prewarmEnd ?? 0)) / rate - s.delay : time - s.delay;
      s.resumeAt = time;
      s.birthStart = s.scheduledTime;
      s.clock = undefined;
      return;
    }
    s.loopClock = new ParticleLoopClock();
    s.stepClock = new ParticleStepClock();
    s.scheduledTime = 0;
    s.clock = undefined;
    s.birthStart = undefined;
    s.resumeAt = undefined;
    s.enabledAt = time;
    s.time = 0;
    s.delayElapsed = 0;
    s.trailTime = undefined;
    s.particles = [];
    this.resetSeeds(s);
    s.delay = s.node.main.prewarm
      ? 0
      : sampleParticleCurve(s.node.main.startDelay, 0, new ParticleRandom(s.seed).value());
    s.origin = worldPosition([0, 0, 0], s.node, this.rootPose(time));
    this.prewarm(s);
  }
  private scheduleChild(s: State, delta: number, time: number) {
    if (
      !s.births ||
      !this.birthParents
        .get(s)
        ?.some(
          (parent) =>
            parent.enabled && parent.managerRegistered !== false && !parent.visibilityFinished,
        )
    )
      return;
    const step = particleChildSchedule(s.visibilityFinished ? 0 : 1, delta, time);
    s.managerRegistered = step.registered;
    s.stoppedAt = step.stoppedAt;
    if (step.resetPosition) s.resetEmitterPosition = true;
    s.visibilityFinished = false;
    return step;
  }
  private prewarm(s: State): number {
    s.prewarmEnd = 0;
    if (this.profile.ui || s.node.main.ui) {
      s.uiClock = new UIParticleFrameClock(s.node.main.prewarm);
      return 0;
    }
    if (!s.node.main.prewarm || !s.node.main.looping) return 0;
    const duration = s.node.main.lengthInSec,
      lifetime = s.node.modules.InitialModule.startLifetime;
    let clock = constantLifetimePrewarm(duration, lifetime);
    const children = this.birthTargets.get(s);
    if (children?.length) {
      const own = maximumConstantLifetime(lifetime);
      if (own === undefined) throw Error('不支持的父粒子预热曲线');
      let longest = own;
      for (const child of children) {
        const life = maximumConstantLifetime(child.node.modules.InitialModule.startLifetime);
        if (life === undefined) throw Error('不支持的子粒子预热曲线');
        longest = Math.max(longest, own + life);
      }
      clock = prewarmFromLifetime(duration, longest);
    }
    // Existing authored lifetime-curve profiles retain their prior schedule until
    // the original curve-range path is verified.
    const start = clock?.start ?? 0;
    s.time = start;
    s.scheduledTime = start;
    s.loopClock.phase = start % duration;
    s.prewarmEnd = clock?.end ?? duration;
    // Simulate(restart) uses analytical replay only for eligible ordinary
    // systems. Normal frames and non-restart catchup remain incremental.
    const replay =
      !this.uiPose &&
      !s.births &&
      !children?.length &&
      particleSupportsProcedural(s.node.main, s.node.modules);
    this.advance(s, s.prewarmEnd, () => 1, [0, 0, 0], replay ? 3 : 1);
    for (const child of children ?? [])
      if (child.enabled)
        this.flushChildBirths(
          child,
          this.activationClock,
          child.time,
          this.pose(child, child.time),
          () => 1,
          true,
          true,
        );
    return (s.prewarmEnd - start) / s.node.main.simulationSpeed;
  }
  get particles() {
    return this.states.flatMap((s) => s.particles);
  }
  private sceneTime(s: State, at: number) {
    if (s.clock)
      return s.clock.rate > 0
        ? s.clock.scene + (at - s.clock.simulation) / s.clock.rate
        : s.clock.scene;
    const pre = s.prewarmEnd ?? 0;
    return pre > 0 && at <= pre
      ? s.enabledAt
      : Math.max(
          0,
          (at - pre) / s.node.main.simulationSpeed + (s.births ? s.delay : 0) + s.enabledAt,
        );
  }
  private birthTime(s: State, at: number): number {
    if (s.clock) return this.sceneTime(s, at);
    return (
      (at - (s.prewarmEnd ?? 0)) / s.node.main.simulationSpeed +
      (s.births ? s.delay : 0) +
      s.enabledAt
    );
  }
  // Update0 snapshots the Transform before Update1's simulation substeps.
  // StartModules already subtracts emitter velocity for each birth's age.
  // Sampling the tween again at that birth time would compensate motion twice.
  private pose(s: State, at: number) {
    return this.simulationPose ?? this.rootPose(this.sceneTime(s, at));
  }
  private initialBirths(s: State, count: number, phase: number) {
    return s.birthRandom.take(count, phase, s.node.modules.InitialModule);
  }
  private initialVelocity(s: State, direction: V, phase: number, seed: number): V {
    const speed = particleBirthSpeed(
      s.node.modules.InitialModule.startSpeed,
      Math.max(0, Math.min(1, phase)),
      seed,
    );
    return direction.map((v) => v * speed);
  }
  private advanceShape(s: State, dt: number) {
    if (s.node.modules.ShapeModule.enabled)
      s.shapeClock.advance(
        s.node.modules.ShapeModule,
        s.loopClock.phase,
        s.node.main.lengthInSec,
        dt,
      );
  }
  private shapeSample(
    n: NativeNode,
    shapeRandom: ParticleRandom,
    birthIndex: number,
    birthCount: number,
    color: V,
    cachedRadians?: number,
    externalScale: V = [1, 1, 1],
  ) {
    let birthColor = [...color];
    // Sample and blend in unscaled shape space; StoreData transforms and
    // normalizes every primitive direction, including zero blend amounts.
    const sh = n.modules.ShapeModule;
    let position = [0, 0, 0],
      direction = [0, 0, 1];
    if (sh.enabled) {
      if (sh.type === 0 || sh.type === 2) {
        const longitude =
          sh.arc.mode === 3 ? burstLongitude(birthIndex, birthCount, sh.arc.value) : undefined;
        const sphere = sampleSphere(
          shapeRandom,
          sh.radius.value,
          sh.radiusThickness,
          sh.type === 2,
          sh.arc.value,
          longitude,
        );
        direction = sphere.direction;
        position = sphere.position;
      } else if (sh.type === 5) position = sampleBox(shapeRandom);
      else if (sh.type === 6) {
        const mesh = n.emissionMesh;
        if (!mesh) throw new Error('缺少发射形状网格');
        if (sh.placementMode === 2 || sh.placementMode === 1) {
          const point =
            sh.placementMode === 1
              ? randomMeshEdgePoint(mesh, shapeRandom)
              : randomSurfacePoint(mesh, shapeRandom);
          position = point.position;
          const length = Math.hypot(...point.normal);
          direction = length * length > 1e-30 ? point.normal.map((v) => v / length) : [0, 0, 1];
          if (point.color) birthColor = emissionVertexColor(birthColor, point.color);
        } else {
          const index = randomEmissionVertex(mesh.triangles, shapeRandom);
          position = [...mesh.positions[index]];
          direction = mesh.normals[index];
          if (mesh.colorBytes) birthColor = emissionVertexColor(birthColor, mesh.colorBytes[index]);
        }
      } else if (sh.type === 12) {
        const edge = sampleSingleSidedEdge(shapeRandom, sh.radius.value);
        position = edge.position;
        direction = edge.direction;
      } else if (sh.type === 15 || sh.type === 16)
        position = sampleBoxShell(shapeRandom, xyz(sh.boxThickness), sh.type === 16);
      else if (sh.type === 10) {
        const circle = sampleCircle(
          shapeRandom,
          sh.radius.value,
          sh.radiusThickness,
          sh.arc.value,
          sh.arc.spread,
          [1, 2].includes(sh.arc.mode) ? 0 : undefined,
          sh.arc.mode,
          cachedRadians,
        );
        position = circle.position;
        direction = circle.direction;
      } else if (sh.type === 8 || sh.type === 4) {
        const cone = (sh.type === 8 ? sampleConeVolume : sampleCone)(
          shapeRandom,
          {
            radius: sh.radius.value,
            thickness: sh.radiusThickness,
            angle: sh.angle,
            length: sh.length,
            arc: sh.arc.value,
            spread: sh.arc.spread,
            mode: sh.arc.mode,
            turns: 0,
            index: birthIndex,
            count: birthCount,
            cachedRadians,
          },
          sh.randomDirectionAmount,
        );
        position = cone.position;
        direction = cone.direction;
      }
      const scale = xyz(sh.m_Scale),
        basis = particleShapeBasis(xyz(sh.m_Rotation)).map(
          (v, i) => v * scale[Math.floor(i / 4)] * (externalScale[i % 4] ?? 1),
        );
      direction = emissionDirection(
        shapeRandom,
        direction,
        position,
        sh.type === 4 ? 0 : sh.randomDirectionAmount,
        sh.sphericalDirectionAmount,
        scale,
        basis,
      );
      if (sh.randomPositionAmount > 0) {
        const offset = randomUnitVector(shapeRandom);
        position = position.map((v, i) => v + offset[i] * sh.randomPositionAmount);
      }
      position = [0, 1, 2].map(
        (i) =>
          basis[i] * position[0] +
          (basis[i + 4] * position[1] +
            (basis[i + 8] * position[2] + xyz(sh.m_Position)[i] * externalScale[i])),
      );
    }
    return { position: position.slice(), direction: direction.slice(), birthColor };
  }
  private spawn(
    s: State,
    born: number,
    capacity: number,
    emitterOffset: V = [0, 0, 0],
    emitterVelocity: V = [0, 0, 0],
    eventOrigin?: V,
    birthIndex = 0,
    birthCount = 1,
    eventVelocity?: V,
    initial?: ParticleBirthInitial,
    replayPhase?: number,
  ) {
    const n = s.node,
      m = n.modules,
      i = m.InitialModule,
      activeBorn = born - s.delayElapsed,
      t = replayPhase ?? (activeBorn % n.main.lengthInSec) / n.main.lengthInSec,
      root = this.pose(s, born);
    if (s.particles.length >= Math.trunc(i.maxNumParticles * capacity)) return;
    if (!initial) throw Error('Missing native birth batch');
    const { seed, life } = initial,
      shapeRandom = s.shapeRandom;
    const transform = particleNodeTransform(n, root),
      scale = transform.scale;
    let { position, direction, birthColor } = this.shapeSample(
      n,
      shapeRandom,
      birthIndex,
      birthCount,
      initial.color,
      s.shapeClock.radians(birthIndex, s.emission),
      transform.shapeScale,
    );
    if (eventVelocity && eventOrigin) {
      // UpdateLocalToWorldMatrixAndScales stores hierarchy scale at State+340
      // for scalingMode=0; Emit scales the final converted matrix columns.
      const scl = transform.scale,
        inverse = localSpace(n) ? transform.inverse : undefined;
      const matrix = this.childTransform(s, {
        velocity: eventVelocity,
        forward: transform.matrix.slice(8, 11),
        up: transform.matrix.slice(4, 7),
        rotation: transform.localQuaternion,
        scale: scl,
        origin: eventOrigin,
        inverse,
      });
      position = childBirthVector(matrix, position, true);
      direction = childBirthVector(matrix, direction);
    } else {
      if (!localSpace(n))
        position = worldPosition(position, n, root).map((v, i) => v - emitterOffset[i]);
      if (eventOrigin) {
        const origin = worldPosition([0, 0, 0], n, root),
          delta = eventOrigin.map((v, i) => v - origin[i]);
        const shift = localSpace(n) ? localVector(delta, n, root) : delta;
        position = position.map((v, j) => v + shift[j]);
      }
      if (!localSpace(n)) direction = worldVector(direction, n, root);
    }
    position = position.slice();
    direction = this.initialVelocity(s, direction, t, seed);
    if (!localSpace(n) && m.InheritVelocityModule?.enabled)
      direction = this.inheritVelocity(s, direction, emitterVelocity, seed);
    const [sx, sy, sz] = initial.size;
    s.particles.push({
      born,
      life,
      percent: 0,
      inverseLife: initial.inverseLife,
      position,
      previous: [...position],
      velocity: direction,
      initialVelocity: [...direction],
      nativeSize: [sx, sy, sz],
      size: [sx * scale[0], sy * scale[1], sz * scale[2]],
      rotation: initial.rotation[2],
      rotationX: initial.rotation[0],
      rotationY: initial.rotation[1],
      color: birthColor,
      seed,
    });
    const children = this.birthTargets.get(s);
    if (children) {
      s.particles.at(-1)!.childEmission = children.map((_, i) => ({
        remainder: 0,
        spacing: 0,
        random: new ParticleRandom(seed, 'child-' + i),
      }));
    }
    if (
      m.TrailModule?.enabled &&
      !m.TrailModule.mode &&
      new ParticleRandom(seed, 'trail').value() < m.TrailModule.ratio
    )
      s.particles.at(-1)!.trail = [];
    return s.particles.at(-1)!;
  }
  private childTransform(_s: State, input: ChildBirthTransform) {
    return childBirthMatrix(input);
  }
  private transformState(s: State, root: EffectPose) {
    return particleNodeTransform(s.node, root);
  }
  private renderLocalVector(s: State, vector: V, root: EffectPose) {
    return particleBasisVector(particleNodeTransform(s.node, root).renderBasis, vector);
  }
  private rescaleParticles(s: State, scale: V) {
    for (const p of s.particles)
      if (p.nativeSize) p.size = p.nativeSize.map((v, i) => v * scale[i]);
  }
  private emitterVelocity(s: State, origin: V, frameDelta: number) {
    return particleEmitterVelocity(origin, s.origin, frameDelta, s.emitterVelocity ?? [0, 0, 0]);
  }
  private calculateVisibilityBounds(
    s: State,
    transform: ReturnType<typeof particleNodeTransform>,
  ): V | undefined {
    const n = s.node,
      m = n.modules;
    // Native bounds are updated even for always-simulated renderers. Visibility
    // scheduling separately admits each supported lifecycle mode below.
    if (this.uiPose || this.profile.ui) return;
    // CacheSubEmitters sets State.nonProcedural for external child emission,
    // even when the child's own modules would otherwise qualify.
    const procedural = !s.births && particleSupportsProcedural(n.main, m);
    if (m.SizeModule.enabled && m.SizeModule.separateAxes && !m.InitialModule.size3D) return;
    let meshBounds: V | undefined;
    if (n.renderer.m_RenderMode === 4) {
      const meshes = n.meshVariants ?? (n.mesh ? [n.mesh] : []);
      if (!meshes.length || meshes.some((m) => !m.bounds)) return;
      const ranges = meshes.map((m) => [
        ...m.bounds!.center.map((c, i) => c - m.bounds!.extent[i]),
        ...m.bounds!.center.map((c, i) => c + m.bounds!.extent[i]),
      ]);
      meshBounds = [0, 1, 2]
        .map((i) => Math.min(...ranges.map((b) => b[i])))
        .concat([0, 1, 2].map((i) => Math.max(...ranges.map((b) => b[i + 3]))));
    }
    const input = {
      positions: s.particles.map((p) => p.position),
      velocity: s.particles.map((p) => p.unscaledVelocity ?? p.velocity),
      particleSizeY: s.particles.map(
        (p) =>
          (p.nativeSize?.[0] ?? 0) *
          (p.noiseSize ?? 1) *
          this.particleSize(s, p, particleAge(p.percent))[0],
      ),
      space: n.main.moveWithTransform ?? 0,
      matrix: transform.matrix,
      scale: transform.scale,
      renderMode: n.renderer.m_RenderMode,
      pivot: xyz(n.renderer.m_Pivot),
      startSize: ['startSize', 'startSizeY', 'startSizeZ'].map(
        (k) => particleCurveRange(m.InitialModule[k])[1],
      ),
      size: m.SizeModule.enabled
        ? ['curve', 'y', 'z'].map((k) => particleCurveRange(m.SizeModule[k])[1])
        : undefined,
      size3D: !!m.InitialModule.size3D,
      meshBounds,
      lengthScale: n.renderer.m_LengthScale,
      velocityScale: n.renderer.m_VelocityScale,
      trail: m.TrailModule?.enabled
        ? {
            mode: m.TrailModule.mode,
            worldSpace: !!m.TrailModule.worldSpace,
            oldest: s.particles.map((p) => p.trail?.[0]?.position ?? null),
            inverse: transform.inverse,
          }
        : undefined,
    };
    return procedural
      ? proceduralParticleBounds({
          ...input,
          modules: m,
          inverse: transform.inverse,
          shapeScale: transform.shapeScale,
          emissionMeshBounds: n.emissionMesh?.bounds,
        })
      : ordinaryParticleBounds(input);
  }
  /** Called once the real scene renderer has its current camera, after simulation.
   * Overlay visibility/alpha and temporary draw packet ablations are irrelevant. */
  updateVisibility(camera: { x: number; y: number }): void {
    for (const s of this.states) {
      if (
        !s.enabled ||
        s.visibilityFinished ||
        !s.visibilityBounds ||
        s.node.renderEnabled === false
      )
        continue;
      const main = s.node.main,
        mode = main.cullingMode;
      if ((mode !== 0 && mode !== 1 && mode !== 2) || main.stopAction || main.ringBufferMode)
        continue;
      if (
        mode === 0 &&
        (s.births || !main.looping || !particleSupportsProcedural(main, s.node.modules))
      )
        continue;
      const world = particleWorldBounds(
        s.visibilityBounds,
        particleNodeTransform(s.node, this.rootPose(this.time)).matrix,
        s.node.main.moveWithTransform ?? 0,
      );
      if (!particleFrustumVisible(world.center, world.extent, storyParticlePlanes(camera))) {
        if (s.culledAt === undefined) {
          s.culledAt = this.time;
          s.managerRegistered = false;
        }
        continue;
      }
      if (s.culledAt === undefined) continue;
      const n = s.node,
        plan = particleVisibilityResume({
          mode: n.main.cullingMode!,
          looping: n.main.looping,
          duration: n.main.lengthInSec,
          maxLifetime: n.modules.InitialModule.startLifetime.scalar,
          phase: s.loopClock.phase,
          playState: 1,
          culled: true,
          culledAt: s.culledAt,
          now: this.time,
          stoppedAt: s.stoppedAt ?? 0,
          emissionStopped: !!s.births || s.loopClock.stopped,
          particles: s.particles.length,
          ring: n.main.ringBufferMode ?? 0,
        });
      s.culledAt = undefined;
      if (plan.kind === 'finish') {
        s.visibilityFinished = true;
        s.particles = [];
        if (s.births) s.births.length = 0;
        s.loopClock.stopped = true;
        s.stoppedAt = 0;
        s.visibilityBounds = undefined;
        continue;
      }
      this.simulationPose = this.rootPose(this.time);
      try {
        const origin = worldPosition([0, 0, 0], n, this.simulationPose),
          rate = Math.max(0, this.animator?.simulationSpeed(n.id) ?? n.main.simulationSpeed),
          stopped = s.loopClock.stopped;
        for (const step of plan.steps) {
          s.loopClock.stopped = step.emissionStopped;
          s.clock = { scene: this.time - step.dt, simulation: s.scheduledTime, rate };
          const velocity = this.emitterVelocity(s, origin, step.dt);
          s.emitterVelocity = velocity;
          this.advance(
            s,
            s.scheduledTime + step.dt * rate,
            () => this.visibilityCapacity(this.time),
            velocity,
            1,
            !!s.births,
          );
          s.origin = origin;
          // Simulate updates this system; ChildEmit pre-ages only newly emitted
          // children. It does not advance the child's existing particles/clocks.
          for (const child of this.birthTargets.get(s) ?? []) {
            if (!child.enabled) continue;
            const previous = child.clock,
              childRate = Math.max(
                0,
                this.animator?.simulationSpeed(child.node.id) ?? child.node.main.simulationSpeed,
              );
            child.clock = { scene: this.time, simulation: child.time, rate: childRate };
            this.flushChildBirths(
              child,
              this.time,
              child.time,
              this.simulationPose,
              () => this.visibilityCapacity(this.time),
              true,
            );
            this.flushChildBirths(
              child,
              this.time,
              child.time,
              this.simulationPose,
              () => this.visibilityCapacity(this.time),
              true,
              true,
            );
            child.clock = previous;
            child.visibilityBounds = this.calculateVisibilityBounds(
              child,
              this.transformState(child, this.simulationPose),
            );
          }
        }
        // Play after catchup preserves the previous stopped/emission flags and
        // requests a fresh emitter position on the next normal Update1b.
        s.loopClock.stopped = stopped;
        if (!s.births) s.resetEmitterPosition = true;
        s.managerRegistered = true;
        s.resumeAt = this.time;
        s.clock = { scene: this.time, simulation: s.scheduledTime, rate };
        s.visibilityBounds = this.calculateVisibilityBounds(
          s,
          this.transformState(s, this.simulationPose),
        );
      } finally {
        this.simulationPose = null;
      }
    }
  }
  private inheritVelocity(s: State, direction: V, emitterVelocity: V, seed: number) {
    return inheritBirthVelocity(
      direction,
      emitterVelocity,
      s.node.modules.InheritVelocityModule.m_Curve,
      seed,
    );
  }
  private emitAlongFlight(s: State, p: Live, step: number, world: V, velocity: V) {
    const inverseLife = p.inverseLife,
      percent = p.percent;
    const targets = this.birthTargets.get(s)!;
    for (const [i, child] of targets.entries()) {
      if (!birthProbability(p.seed, s.node.birthProbabilities?.[i] ?? 1)) continue;
      const state = p.childEmission![i],
        em = child.node.modules.EmissionModule,
        duration = child.node.main.lengthInSec;
      // SubModule::Update subtracts the child's authored start delay from the
      // parent's age, then RecordEmit evaluates its rate at that phase.
      const delay = sampleCurve(
        child.node.main.startDelay,
        0,
        new ParticleRandom(p.seed, 'child-delay').value(),
      );
      const window = delayedBirthInterval(
        percent,
        inverseLife,
        delay,
        step,
        child.node.main.looping ? Infinity : duration,
      );
      if (!window) continue;
      const { begin, end: elapsed } = window;
      const delta = elapsed - begin,
        offset = delay * inverseLife,
        phase = particleAge(percent) - offset;
      const beginPhase = particleAge(percent - 100 * step * inverseLife) - offset;
      const clock = this.commandClocks.get(s) ?? { pending: s.stepClock.pending, flags: 0 };
      const enqueue = (count: number, continuous: number) => {
        if (count)
          child.births!.push({
            at: this.activationClock,
            world,
            velocity,
            command: {
              delta,
              phase,
              beginPhase,
              count,
              continuous,
              spacing: state.spacing,
              remainder: state.remainder,
              ...clock,
            },
          });
      };
      const distance = emitOverDistance(
        state,
        em.rateOverDistance,
        velocity,
        delta,
        elapsed / duration,
      );
      enqueue(distance, distance);
      const births = emitOverTime(state, em.rateOverTime, em.m_Bursts, begin, elapsed, duration);
      enqueue(births.count, births.continuous);
    }
  }
  private gravityMatrix(s: State, root: EffectPose): number[] | undefined {
    if (!localSpace(s.node)) return;
    const columns = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ].map((v) => localVector(v, s.node, root).slice());
    return columns.flatMap((v) => [...v, 0]).concat([0, 0, 0, 1]);
  }
  private applyGravity(s: State, p: Live, step: number, root: EffectPose) {
    const curve = s.node.modules.InitialModule.gravityModifier;
    if (!curve.scalar) return;
    p.initialVelocity = advanceParticleGravity(
      p.initialVelocity,
      curve,
      s.loopClock.phase,
      s.node.main.lengthInSec,
      p.seed,
      step,
      this.gravityMatrix(s, root),
    );
  }
  private advanceNoise(s: State, dt: number) {
    const noise = s.node.modules.NoiseModule;
    if (noise.enabled && s.particles.length)
      s.noiseScroll = advanceNoiseScroll(
        s.noiseScroll ?? 0,
        noise.scrollSpeed,
        s.loopClock.phase,
        s.node.main.lengthInSec,
        dt,
      );
  }
  private particleLimits(s: State, p: Live, animated: V, size: V, step: number): V {
    return limitParticleMotion(
      s.node.modules.ClampVelocityModule,
      p.percent,
      p.seed,
      p.initialVelocity,
      animated,
      size,
      step,
    );
  }
  private particleCustom(s: State, p: Live): V {
    return particleCustomData(s.node.modules.CustomDataModule, p.percent, p.seed);
  }
  private integrateParticle(
    s: State,
    p: Live,
    step: number,
    animated: V,
    speed: number,
    initial = false,
  ) {
    const m = s.node.modules;
    p.percent = initial
      ? birthParticlePercent(p.inverseLife, step)
      : advanceParticlePercent(p.percent, p.inverseLife, step);
    const afterAge = particleAge(p.percent);
    // Dead particles retained by TrailModule stop moving before trail expiry.
    if (!initial && p.percent > 100 && p.trail && !m.TrailModule?.dieWithParticles) {
      p.initialVelocity = [0, 0, 0];
      animated = [0, 0, 0];
    }
    p.previous = p.position.slice();
    const combined = p.initialVelocity.map((v, j) => v + animated[j]);
    const scale = speed,
      delta = step;
    p.unscaledVelocity = combined;
    p.velocity = combined.map((v) => v * scale);
    p.position = p.previous.map((v, j) => v + delta * scale * combined[j]);
    return afterAge;
  }
  private particleOrbital(s: State, p: Live, rates: V, radial: number, dt: number, speed: number) {
    const v = s.node.modules.VelocityModule;
    return orbitalVelocity(
      p.position,
      rates,
      ['orbitalOffsetX', 'orbitalOffsetY', 'orbitalOffsetZ'].map((k) => v[k]?.scalar ?? 0),
      radial,
      dt,
      speed,
    );
  }
  private particleNoise(s: State, p: Live, animated: V, dt: number) {
    return particleNoise({
      module: s.node.modules.NoiseModule,
      percent: p.percent,
      seed: p.seed,
      position: p.position,
      offset: s.offset,
      scroll: s.noiseScroll ?? 0,
      dt,
      animated,
      rotation: [p.rotationX, p.rotationY, p.rotation],
      size: p.size,
      rotation3D: s.node.modules.InitialModule.rotation3D,
      size3D: s.node.modules.InitialModule.size3D,
    });
  }
  private updateParticle(s: State, p: Live, step: number, root: EffectPose, initial = false) {
    const n = s.node,
      m = n.modules;
    if (p.percent > 100) {
      if (p.trail && !m.TrailModule?.dieWithParticles)
        expireTrailPoints(
          p.trail,
          s.trailTime ?? 0,
          this.trailLifetime(s, p, particleAge(p.percent)),
        );
      return;
    }
    const age = particleAge(p.percent);
    const speed = m.VelocityModule.enabled ? this.particleSpeed(s, p, age) : 1;
    let animated = [0, 0, 0];
    if (m.VelocityModule.enabled) {
      animated = this.particleVector(s, p, 'velocity', age);
      if (localSpace(n) && m.VelocityModule.inWorldSpace) animated = localVector(animated, n, root);
      else if (!localSpace(n) && !m.VelocityModule.inWorldSpace)
        animated = worldVector(animated, n, root);
    }
    this.applyGravity(s, p, step, root);
    if (m.VelocityModule.enabled) {
      const v = m.VelocityModule,
        rates = v.orbitalX
          ? orbitalRates(
              ['orbitalX', 'orbitalY', 'orbitalZ'].map((k) => v[k]),
              age,
              p.seed,
            )
          : [0, 0, 0],
        radial = v.radial?.scalar ?? 0;
      if (radial || rates.some(Boolean)) {
        const extra = this.particleOrbital(s, p, rates, radial, step, speed);
        animated = animated.map((x, j) => x + extra[j]);
      }
    }
    if (m.NoiseModule.enabled) {
      const noise = this.particleNoise(s, p, animated, step);
      animated = noise.animated;
      [p.rotationX, p.rotationY, p.rotation] = noise.rotation;
      p.noiseSize = noise.sizeFactors[0];
    }
    if (m.ForceModule.enabled) {
      let force = this.particleVector(s, p, 'force', age);
      if (localSpace(n) && m.ForceModule.inWorldSpace) force = localVector(force, n, root);
      else if (!localSpace(n) && !m.ForceModule.inWorldSpace) force = worldVector(force, n, root);
      p.initialVelocity = advanceParticleForce(p.initialVelocity, force, step);
    }
    const clamp = m.ClampVelocityModule;
    if (clamp?.enabled) {
      let extent = [0, 0, 0];
      if (clamp.drag.scalar) {
        const scale = particleScale(n),
          size = this.particleSize(s, p, age);
        extent = p.size.map((v, i) => (((p.noiseSize ?? 1) * v) / scale[i]) * size[i]);
      }
      p.initialVelocity = this.particleLimits(s, p, animated, extent, step);
    }
    const afterAge = this.integrateParticle(s, p, step, animated, speed, initial);
    if (p.childEmission) {
      const world = localSpace(n) ? worldPosition(p.position, n, root) : p.position;
      const velocity = localSpace(n) ? worldVector(p.velocity, n, root) : p.velocity;
      this.emitAlongFlight(s, p, step, world, velocity);
    }
    if (p.trail && !this.profile.ui)
      updateTrail(
        p.trail,
        this.trailPosition(s, p, root),
        s.trailTime!,
        this.trailLifetime(s, p, afterAge),
        m.TrailModule.minVertexDistance,
        p.percent,
      );
  }
  private startParticles(
    s: State,
    births: {
      particle: Live;
      delta: number;
    }[],
    root: EffectPose,
    preSteps: number[] = [],
  ) {
    const first = s.particles.length - births.length;
    for (const birth of births) this.updateParticle(s, birth.particle, birth.delta, root, true);
    removeExpiredBirths(s.particles, first, (p) => p.percent > 100);
    if (preSteps.length) {
      const newborns = s.particles.splice(first);
      for (const dt of preSteps) {
        if (!newborns.length) break;
        if (s.node.modules.TrailModule?.enabled && !this.profile.ui)
          s.trailTime = (s.trailTime ?? 0) + dt;
        for (const p of newborns) this.updateParticle(s, p, dt, root);
        removeExpiredParticles(newborns, (p) => p.percent > 100);
      }
      s.particles.push(...newborns);
    }
  }
  private cullParticles(s: State) {
    removeExpiredParticles(
      s.particles,
      (p) =>
        p.percent > 100 && (!p.trail?.length || !!s.node.modules.TrailModule?.dieWithParticles),
    );
  }
  private canEmit(n: NativeNode) {
    return (
      (n.emissionFadeTarget ? this.emissionOverride : null) ??
      n.modules.EmissionModule.enabled !== false
    );
  }
  private finishReplay(s: State, records: ParticleEmitReplay[]): void {
    const n = s.node,
      m = n.modules,
      duration = n.main.lengthInSec;
    const births = records.flatMap((record) =>
      s.birthRandom.replay(record, duration, m.InitialModule).map((initial) => ({
        initial,
        phase: duration > 0 ? record.phase / duration : 0,
        elapsed: initial.elapsed,
      })),
    );
    const transform = this.transformState(s, this.pose(s, s.time));
    for (let index = 0; index < births.length; index++) {
      const birth = births[index];
      const p = this.spawn(
        s,
        s.time - birth.elapsed,
        Infinity,
        [0, 0, 0],
        [0, 0, 0],
        undefined,
        index,
        births.length,
        undefined,
        birth.initial,
        birth.phase,
      );
      if (!p) continue;
      p.percent = birth.initial.percent;
      p.proceduralBorn = true;
      const result = proceduralParticleMotion({
        position: p.position,
        velocity: p.initialVelocity,
        elapsed: birth.elapsed,
        percent: p.percent,
        inverseLife: p.inverseLife,
        seed: p.seed,
        modules: m,
        inverse: transform.inverse,
        scale: transform.scale,
      });
      p.position = result.position;
      p.previous = [...p.position];
      p.initialVelocity = result.velocity;
      p.unscaledVelocity = result.velocity.map((v, j) => v + result.animated[j]);
      p.velocity = [...p.unscaledVelocity];
    }
  }
  private flushChildBirths(
    s: State,
    sceneEnd: number,
    next: number,
    root: EffectPose,
    capacity: (at: number) => number,
    allowPast = false,
    commandsOnly = false,
  ) {
    const n = s.node,
      m = n.modules,
      start = s.clock?.scene ?? s.enabledAt + s.delay,
      base = s.clock?.simulation ?? 0,
      rate = s.clock?.rate ?? n.main.simulationSpeed;
    while (s.births?.length) {
      const index = s.births.findIndex((e) => !!e.command === commandsOnly && e.at <= sceneEnd);
      if (index < 0) break;
      const event = s.births.splice(index, 1)[0],
        born = event.command ? next : base + (event.at - start) * rate;
      // Emit rejects expired commands before consuming InitialModule RNG.
      if (event.command && event.command.pending >= m.InitialModule.startLifetime.scalar) continue;
      if (!allowPast && born < (s.birthStart ?? 0)) continue;
      const count = Math.min(
          event.command?.count ?? (event.velocity ? 1 : event.burstCount!),
          Math.max(
            0,
            Math.trunc(m.InitialModule.maxNumParticles * capacity(next)) - s.particles.length,
          ),
        ),
        initial = this.initialBirths(
          s,
          count,
          event.command?.phase ?? s.loopClock.phase / n.main.lengthInSec,
        );
      const births: {
        particle: Live;
        delta: number;
      }[] = [];
      for (let k = 0; k < initial.length; k++) {
        const cmd = event.command,
          fraction = cmd
            ? Math.min(
                1,
                Math.max(1e-6, k < cmd.continuous ? (k + cmd.remainder) * cmd.spacing : 0),
              )
            : 0;
        const phase = cmd
          ? Math.min(1, Math.max(0, (cmd.beginPhase - cmd.phase) * fraction + cmd.phase))
          : undefined;
        const p = this.spawn(
          s,
          born,
          capacity(next),
          [0, 0, 0],
          event.velocity ?? [0, 0, 0],
          event.world,
          k,
          count,
          event.velocity,
          initial[k],
          phase,
        );
        if (p) {
          if (cmd && event.velocity) {
            const velocity = localSpace(n)
                ? localVector(event.velocity, n, root).slice()
                : event.velocity.slice(),
              age = fraction * (cmd.delta / n.main.simulationSpeed);
            p.position = p.position.map((v, j) => v - velocity[j] * age);
          }
          births.push({
            particle: p,
            delta: cmd ? cmd.delta * fraction : Math.max(0, next - born),
          });
        }
      }
      const preSteps = event.command
        ? childPreSimulationSteps(event.command.pending, n.main.lengthInSec, event.command.flags)
        : [];
      this.startParticles(s, births, root, preSteps);
      if (event.command) {
        const elapsed = preSteps.reduce((sum, dt) => sum + dt, 0);
        for (const b of births) b.particle.born = next - elapsed - b.delta;
      }
    }
  }
  private advance(
    s: State,
    end: number,
    capacity: (at: number) => number,
    emitterVelocity: V = [0, 0, 0],
    flags = 0,
    childCatchup = false,
  ) {
    const n = s.node,
      m = n.modules,
      duration = n.main.lengthInSec;
    const replay: ParticleEmitReplay[] | undefined = flags & 2 ? [] : undefined;
    let pending = s.stepClock.pending + (end - s.scheduledTime);
    const steps = s.stepClock.take(end - s.scheduledTime, duration, flags);
    s.scheduledTime = end;
    const consumeDelay = s.loopClock.phase === 0;
    for (const [stepIndex, dt] of steps.entries()) {
      this.commandClocks.set(s, { pending, flags });
      const next = s.time + dt,
        root = this.pose(s, next),
        loopBegin = s.loopClock.phase;
      const delay = particleDelayStep(s.births ? 0 : s.delay, dt, consumeDelay);
      if (delay.phase > 0) s.loopClock.tick(delay.phase, duration, n.main.looping);
      if (!s.births && !s.loopClock.stopped) s.delayElapsed += s.delay - delay.remaining;
      if (m.TrailModule?.enabled && !this.profile.ui) s.trailTime = (s.trailTime ?? 0) + dt;
      this.advanceShape(s, dt);
      this.advanceNoise(s, dt);
      if (replay) {
        for (const record of replay) record.age = record.age + dt;
      } else {
        for (const p of s.particles) this.updateParticle(s, p, dt, root);
        this.cullParticles(s);
      }
      if (s.births && !childCatchup) {
        // Event timestamps are in scene time; the target's clock starts when
        // its hierarchy becomes active. Child emission must not run backwards.
        // Parent events already dispatched in this frame must reach the child in
        // this frame. Independent float accumulators can leave its processed time
        // just below the event timestamp. Keep the fixed-prewarm boundary intact.
        const eventEnd =
          !(flags & 1) && stepIndex === steps.length - 1 ? Math.max(next, end) : next;
        this.flushChildBirths(s, this.birthTime(s, eventEnd), next, root, capacity);
      } else if (this.canEmit(n) && !s.loopClock.stopped && delay.emission > 0) {
        const begin = duration <= dt ? loopBegin + 0.000001 : loopBegin,
          finish = s.loopClock.phase;
        const emitted = emitOverTime(
          s.emission,
          m.EmissionModule.rateOverTime,
          m.EmissionModule.m_Bursts,
          begin,
          finish,
          duration,
        );
        if (replay) {
          appendParticleReplay(replay, {
            phase: finish,
            dt: delay.emission,
            offset: s.emission.remainder,
            spacing: s.emission.spacing,
            ...emitted,
            maximum: Math.trunc(m.InitialModule.maxNumParticles * capacity(next)),
            ring: n.main.ringBufferMode ?? 0,
          });
        } else {
          const available = Math.max(
            0,
            Math.trunc(m.InitialModule.maxNumParticles * capacity(next)) - s.particles.length,
          );
          const count = Math.min(emitted.count, available),
            initial = this.initialBirths(s, count, s.loopClock.phase / duration),
            births: {
              particle: Live;
              delta: number;
            }[] = [];
          for (let k = 0; k < initial.length; k++) {
            const age = delay.emission * emissionAgeFraction(s.emission, k, emitted.continuous),
              born = next - age;
            const p = this.spawn(
              s,
              born,
              capacity(next),
              emitterVelocity.map(
                (v) => (v * (end - born)) / (s.clock?.rate ?? n.main.simulationSpeed),
              ),
              emitterVelocity,
              undefined,
              k,
              count,
              undefined,
              initial[k],
            );
            if (p) births.push({ particle: p, delta: age });
          }
          this.startParticles(s, births, root);
        }
      }
      if (!s.births && !s.loopClock.stopped) s.delay = delay.remaining;
      this.cullParticles(s);
      s.particles.length = Math.min(
        s.particles.length,
        Math.max(0, Math.trunc(m.InitialModule.maxNumParticles * capacity(next))),
      );
      s.time = next;
      pending = pending - dt;
    }
    this.commandClocks.delete(s);
    if (replay) this.finishReplay(s, replay);
  }
  update(time: number, capacity: (at: number) => number = () => 1) {
    if (this.hidden) return;
    this.visibilityCapacity = capacity;
    if (time < this.time) throw new Error('Particle simulation cannot rewind');
    if (this.enableEmissionAt !== null && time >= this.enableEmissionAt) {
      const boundary = this.enableEmissionAt;
      this.enableEmissionAt = null;
      if (boundary > this.time) this.update(boundary, capacity);
      this.emissionOverride = true;
    }
    this.activationClock = time;
    // FxDelay disables the entire instance. Its Animator starts at clip time
    // zero when the root is enabled again; the owning panel keeps its own clock.
    const delay = this.profile.rootDelay ?? 0;
    const activeDelta = Math.max(0, time - delay) - Math.max(0, this.time - delay);
    this.uv.update(activeDelta);
    this.animator?.update(activeDelta);
    this.applyTransformAnimation();
    this.applyParticleAnimation();
    this.simulationPose = this.rootPose(time);
    try {
      for (const s of this.states) invalidateParticleTransform(s.node);
      for (const [target, delay] of this.animatedDelays)
        delay.update(time, this.animator?.active(target) ?? delay.active);
      for (const s of this.simulationOrder) {
        const epoch = s.node.transforms.reduce(
          (sum, t) => sum + (t.key ? (this.animatedDelays.get(t.key)?.disableEpoch ?? 0) : 0),
          0,
        );
        if (s.delayEpoch !== undefined && s.delayEpoch !== epoch) {
          this.deactivate(s);
        }
        s.delayEpoch = epoch;
        if (!this.chainEnabled(s.node.transforms)) {
          this.deactivate(s);
          continue;
        }
        if (!s.enabled) this.activate(s, time);
        const childSchedule = this.scheduleChild(s, time - this.time, time);
        if (s.managerRegistered === false || s.visibilityFinished) continue;
        const n = s.node,
          scene = Math.max(
            this.time,
            s.enabledAt + (s.births ? s.delay : 0),
            s.resumeAt ?? -Infinity,
          );
        s.resumeAt = undefined;
        // Update1b scales the current frame before choosing its equal substeps.
        // Scheduled time includes the residual held by Update1Incremental, and must
        // not be replaced by the last processed time when animated speed changes.
        const rate = Math.max(0, this.animator?.simulationSpeed(n.id) ?? n.main.simulationSpeed);
        s.clock = { scene, simulation: s.scheduledTime, rate };
        const frameDelta = childSchedule?.resetPosition
          ? 0
          : (s.uiClock?.take(Math.max(0, time - scene), n.main.lengthInSec) ??
            Math.max(0, time - scene));
        const dt = frameDelta * rate,
          end = s.scheduledTime + dt;
        const transform = this.transformState(s, this.pose(s, end)),
          origin = transform.matrix.slice(12, 15);
        if (s.resetEmitterPosition) {
          s.origin = origin;
          s.resetEmitterPosition = false;
        }
        const velocity = this.emitterVelocity(s, origin, frameDelta);
        s.emitterVelocity = velocity;
        if (s.dynamicScale) this.rescaleParticles(s, transform.scale);
        const cap = (at: number) => capacity(this.sceneTime(s, at));
        if (
          !s.births &&
          s.delay === 0 &&
          this.canEmit(n) &&
          particleStep(dt) >= 0.00001 &&
          !s.loopClock.stopped
        ) {
          const clockEnd = s.loopClock.phase + (s.stepClock.pending + dt);
          const phase =
            (n.main.looping
              ? clockEnd % n.main.lengthInSec
              : Math.min(clockEnd, n.main.lengthInSec)) / n.main.lengthInSec;
          const count = emitOverDistance(
            s.emission,
            n.modules.EmissionModule.rateOverDistance,
            velocity,
            dt,
            phase,
          );
          const available = Math.max(
            0,
            Math.trunc(n.modules.InitialModule.maxNumParticles * cap(end)) - s.particles.length,
          );
          const births: {
              particle: Live;
              delta: number;
            }[] = [],
            actualCount = Math.min(count, available),
            initial = this.initialBirths(s, actualCount, phase);
          for (let k = 0; k < initial.length; k++) {
            const age = dt * emissionAgeFraction(s.emission, k, count),
              born = end - age;
            const p = this.spawn(
              s,
              born,
              cap(end),
              velocity.map((v) => (v * age) / rate),
              velocity,
              undefined,
              k,
              actualCount,
              undefined,
              initial[k],
            );
            if (p) births.push({ particle: p, delta: age });
          }
          this.startParticles(s, births, this.pose(s, end));
        }
        if (s.births && s.births.length > 1 && s.births.every((e) => !e.command))
          s.births.sort((a, b) => a.at - b.at);
        this.advance(s, end, cap, velocity);
        s.origin = origin;
        if (s.births) this.flushChildBirths(s, time, s.time, this.pose(s, s.time), cap, true, true);
        if (childSchedule?.resetPosition) {
          // A cleared child's already-created update job has dt=0. Parent ChildEmit
          // still delivers births in that frame; old particles are not advanced.
          s.clock = { scene: time, simulation: s.time, rate };
          this.flushChildBirths(s, time, s.time, this.pose(s, s.time), cap, true);
        }
        if (s.loopClock.stopped && s.stoppedAt === undefined) s.stoppedAt = time;
        s.visibilityBounds = this.calculateVisibilityBounds(s, transform);
      }
      if (this.profile.ui && time > this.time)
        for (const s of this.states) {
          if (!s.enabled || !s.node.modules.TrailModule?.enabled) continue;
          s.trailTime = (s.trailTime ?? 0) + time - this.time;
          for (const p of s.particles)
            if (p.trail) {
              const age = Math.min(1, Math.max(0, particleAge(p.percent)));
              if (age < 0.99999)
                updateUITrail(
                  p.trail,
                  this.trailPosition(s, p, this.pose(s, s.time)),
                  s.trailTime,
                  this.trailLifetime(s, p, age),
                  s.node.modules.TrailModule.minVertexDistance,
                );
            }
        }
      if (time >= delay)
        for (const trail of this.profile.standaloneTrails ?? []) {
          if (!this.chainEnabled(trail.transforms)) continue;
          let history = this.standalone.get(trail.rendererKey);
          if (!history) {
            history = new StandaloneTrailHistory();
            this.standalone.set(trail.rendererKey, history);
          }
          const position = world([0, 0, 0], trail.transforms, false, true, this.rootPose(time)).map(
            (v) => v * 0.01,
          );
          position[2] += EFFECT_WORLD_Z;
          history.update(
            position,
            time,
            this.animator?.trailProperty(trail.rendererKey, 'm_Time') ?? trail.time,
            trail.minDistance,
            trail.emitting,
          );
        }
      this.time = time;
    } finally {
      this.simulationPose = null;
    }
  }
  private applyParticleAnimation() {
    if (!this.animator) return;
    for (const node of this.profile.nodes)
      for (const [path, value] of this.animator.particleProperties(node.id)) {
        const parts = path.split('.');
        let target: any = parts.length === 1 ? node.main : node.modules;
        for (const part of parts.slice(0, -1)) target = target[part];
        target[parts.at(-1)!] = particlePropertyValue(path, value);
        // Native MinMaxCurve::Validate clamps both endpoints after either setter.
        if (parts.at(-1) === 'scalar' || parts.at(-1) === 'minScalar')
          for (const bound of ['scalar', 'minScalar']) {
            target[bound] = particlePropertyValue(
              [...parts.slice(0, -1), bound].join('.'),
              target[bound],
            );
          }
      }
  }
  private applyTransformAnimation() {
    if (!this.animator) return;
    for (const node of [
      ...this.profile.nodes,
      ...this.profile.meshes,
      ...(this.profile.standaloneTrails ?? []),
    ])
      for (const transform of node.transforms) {
        const value = transform.key ? this.animator.position(transform.key) : null;
        if (value) transform.m_LocalPosition = { x: value[0], y: value[1], z: value[2] };
        const scale = transform.key ? this.animator.scale(transform.key) : null;
        if (scale) transform.m_LocalScale = { x: scale[0], y: scale[1], z: scale[2] };
        const rotation = transform.key ? this.animator.rotation(transform.key) : null;
        if (rotation) transform.m_LocalRotation = { ...rotation };
      }
  }
  get finished() {
    return this.animator?.finished ?? false;
  }
  show(duration: number) {
    if (this.profile.fadeType === 3) {
      if (duration > 1e-5) {
        this.emissionOverride = false;
        this.enableEmissionAt = this.time + duration;
      }
    } else if (this.profile.fadeType === 4 && this.profile.fadeAnimatorBound !== false)
      this.animator?.show(duration);
  }
  hide(duration: number) {
    if (this.profile.fadeType === 3) this.emissionOverride = false;
    else if (this.profile.fadeType === 4 && this.profile.fadeAnimatorBound !== false)
      this.animator?.hide(duration);
  }
  private material(renderer: string | undefined, source: ParticleMaterial, slot = 0) {
    source = this.animator?.materialReference(renderer, source, slot) ?? source;
    const material = slot === 0 ? this.uv.material(renderer, source) : source;
    return this.uvRotation.material(
      renderer,
      this.animator?.material(renderer, material) ?? material,
    );
  }
  dispose() {
    this.standalone.clear();
    for (const delay of this.animatedDelays.values()) delay.recycle();
    this.uv.dispose();
    this.hidden = true;
    for (const s of this.states) {
      s.particles = [];
      if (s.births) s.births.length = 0;
    }
  }
  private trailPosition(s: State, p: Live, root: EffectPose) {
    const toWorld = s.node.modules.TrailModule.worldSpace && localSpace(s.node);
    if (this.profile.ui)
      return toWorld ? worldPosition(p.position, s.node, root).slice() : p.position;
    return particleTrailPosition(p.position, this.transformState(s, root).matrix, toWorld);
  }
  private trailLifetime(s: State, p: Live, age: number) {
    const n = s.node,
      m = n.modules,
      t = m.TrailModule,
      life = curve(t, 'lifetime', age, new ParticleRandom(p.seed, 'trail-lifetime').value());
    let size = [1, 1, 1];
    if (t.sizeAffectsLifetime) {
      const scale = particleScale(n),
        factor = this.particleSize(s, p, age);
      size = p.size.map((v, i) => (((p.noiseSize ?? 1) * v) / scale[i]) * factor[i]);
    }
    return particleTrailLifetime(
      life,
      p.inverseLife,
      size,
      m.InitialModule.size3D,
      t.sizeAffectsLifetime,
    );
  }
  private trailStyle(s: State, p: Live) {
    const n = s.node,
      m = n.modules,
      t = m.TrailModule,
      age = Math.min(1, Math.max(0, particleAge(p.percent)));
    const scale = particleScale(n),
      factor = this.particleSize(s, p, age),
      size = p.size.map((v, i) => (v / scale[i]) * factor[i]);
    const extent =
      (p.noiseSize ?? 1) *
      (m.InitialModule.size3D
        ? n.renderer.m_RenderMode === 4
          ? Math.cbrt(size[0] * size[1] * size[2])
          : Math.sqrt(size[0] * size[1])
        : size[0]);
    const width = Math.cbrt(scale[0] * scale[1] * scale[2]) * (t.sizeAffectsWidth ? extent : 1);
    const widthRandom = new ParticleRandom(p.seed, 'trail-width').value(),
      colorRandom = new ParticleRandom(p.seed, 'trail').value();
    let color = t.inheritParticleColor ? this.particleColor(s, p) : [1, 1, 1, 1];
    color = multiplyTrailColor(
      color,
      gradient(t.colorOverLifetime, age, new ParticleRandom(p.seed, 'trail-color').value()),
    );
    return { width, widthRandom, color, colorRandom };
  }
  private trailDraw(
    s: State,
    particles: Live[],
    positions: V[],
    root: EffectPose,
    camera: {
      x: number;
      y: number;
    },
    ribbon: boolean,
  ): ParticleDraw | null {
    if (positions.length < 2) return null;
    const n = s.node,
      t = n.modules.TrailModule,
      styles = particles.map((p) => this.trailStyle(s, p));
    const points = positions.map((pos) => {
      const v = localSpace(n) && (!t.worldSpace || ribbon) ? worldPosition(pos, n, root) : pos;
      return [v[0] + camera.x * 0.01, v[1] + camera.y * 0.01, -(v[2] - SCENE_CAMERA_Z)];
    });
    let lineWidth = styles[0].width;
    if (ribbon) {
      // Initialize (0xECA9B0) chooses the maximum initial size for join smoothing.
      const start = n.modules.InitialModule.startSize,
        maximum = start.minMaxState === 3 ? Math.max(start.scalar, start.minScalar) : start.scalar;
      const scale = particleScale(n);
      lineWidth =
        Math.cbrt(scale[0] * scale[1] * scale[2]) *
        (t.sizeAffectsWidth ? maximum : 1) *
        t.widthOverTrail.scalar;
    }
    const styleAt = (i: number) => styles[ribbon ? i : 0];
    const pairs = buildTrailPairs(
      points,
      lineWidth,
      (progress, index) => {
        const style = styleAt(index);
        return style.width * curve(t, 'widthOverTrail', progress, style.widthRandom);
      },
      t.textureMode,
      !!this.profile.ui,
    );
    const vertices: number[] = [],
      uv: number[] = [],
      colors: number[] = [];
    for (let i = 0; i < pairs.length - 2; i += 2)
      for (const index of [i, i + 1, i + 2, i + 1, i + 3, i + 2]) {
        const v = pairs[index],
          style = styleAt(index >> 1);
        vertices.push(v.position[0] * 100 - camera.x, v.position[1] * 100 - camera.y);
        uv.push(...v.uv);
        colors.push(
          ...multiplyTrailColor(
            style.color,
            gradient(t.colorOverTrail, v.progress, style.colorRandom),
          ),
        );
      }
    return {
      rendererKey: n.rendererKey + ':trail',
      vertices,
      uv,
      colors,
      color: [1, 1, 1, 1],
      material: this.profile.materials[n.trailMaterial!],
      order: n.renderer.m_SortingOrder,
      depth: points[0][2],
      custom: Array(8).fill(0),
    };
  }
  particleUV(s: State, p: Live): number {
    return particleUVFrame(
      s.node.modules.UVModule,
      p.percent,
      p.seed,
      s.node.meshVariants?.length ?? (s.node.mesh ? 1 : 0),
    );
  }
  particleVector(
    s: State,
    p: Live,
    kind: 'force' | 'velocity',
    age = Math.max(0, particleAge(p.percent)),
  ): number[] {
    const module = kind === 'force' ? s.node.modules.ForceModule : s.node.modules.VelocityModule;
    // Per-frame randomization owns a separate mutable module stream; the fixed
    // lifetime stream below does not claim to reproduce that pending branch.
    if (kind === 'force' && module.randomizePerFrame)
      return ['x', 'y', 'z'].map((key) => curve(module, key, age, s.emission.random.value()));
    return particleVector(module, age, p.seed, kind);
  }
  particleSpeed(s: State, p: Live, age = Math.max(0, particleAge(p.percent))): number {
    return particleSpeed(s.node.modules.VelocityModule.speedModifier, age, p.seed);
  }
  particleRotation(s: State, p: Live, age = Math.max(0, particleAge(p.percent))): number[] {
    if (p.proceduralBorn)
      return proceduralParticleRotation(
        s.node.modules.RotationModule,
        p.percent,
        p.inverseLife,
        p.seed,
        s.node.modules.InitialModule.randomizeRotationDirection,
      );
    const module = s.node.modules.RotationModule;
    return module.enabled
      ? particleRotation(
          module,
          age,
          p.life,
          p.seed,
          s.node.modules.InitialModule.randomizeRotationDirection,
        )
      : [0, 0, 0];
  }
  particleSize(s: State, p: Live, age = Math.max(0, particleAge(p.percent))): number[] {
    const module = s.node.modules.SizeModule;
    return module.enabled
      ? [0, 1, 2].map((axis) => particleSizeMultiplier(module, age, p.seed, axis))
      : [1, 1, 1];
  }
  particleColor(s: State, p: Live): number[] {
    const module = s.node.modules.ColorModule,
      age = Math.max(0, particleAge(p.percent));
    return module.enabled
      ? particleLifetimeColor(module.gradient, age, p.seed, p.color)
      : p.color.map((v) => particleColorByte(v) / 255);
  }
  drawables(camera = { x: 0, y: 0 }, opaqueOnly = false): ParticleDraw[] {
    if (this.hidden) return [];
    const out: ParticleDraw[] = [],
      root = this.rootPose(this.time),
      planes = storyParticlePlanes(camera);
    for (const s of this.states) {
      if (!s.enabled || s.node.renderEnabled === false) continue;
      const n = s.node,
        m = n.modules,
        trails: ParticleDraw[] = [];
      // Draw culling is independent of simulation mode. Always-simulated parents
      // and their children still need the actual renderer's world AABB test.
      if (s.visibilityBounds) {
        const world = particleWorldBounds(
          s.visibilityBounds,
          particleNodeTransform(n, root).matrix,
          n.main.moveWithTransform ?? 0,
        );
        if (!particleFrustumVisible(world.center, world.extent, planes)) continue;
      }
      const firstPacket = out.length;
      const particles = [...s.particles],
        mainMaterial =
          particles.length && n.renderer.m_RenderMode !== 5
            ? this.material(n.rendererKey, this.profile.materials[n.material])
            : null;
      if (opaqueOnly && mainMaterial?.shader !== 'builtin-error') continue;
      if (n.renderer.m_SortMode === 2) particles.sort((a, b) => b.born - a.born);
      if (n.renderer.m_SortMode === 3) particles.sort((a, b) => a.born - b.born);
      if (m.TrailModule?.enabled && m.TrailModule.mode === 1 && particles.length > 1) {
        // RenderJobCommon sorts by descending elapsed lifetime before collecting live positions.
        const chain = [...s.particles].sort((a, b) => a.born - b.born);
        const ribbon = this.trailDraw(
          s,
          chain,
          chain.map((p) => p.position),
          root,
          camera,
          true,
        );
        if (ribbon) trails.push(ribbon);
      }
      for (const p of particles) {
        if (p.trail) {
          const head = this.trailPosition(s, p, root);
          const points = this.profile.ui
            ? [head.slice(), ...p.trail.map((point) => point.position.slice()).reverse()]
            : trailPositions(
                p.trail,
                head,
                s.trailTime!,
                this.trailLifetime(s, p, Math.min(1, Math.max(0, particleAge(p.percent)))),
              );
          const trail = this.trailDraw(s, [p], points, root, camera, false);
          if (trail) trails.push(trail);
        }
        if (n.renderer.m_RenderMode === 5 || p.percent > 100) continue;
        const age = Math.max(0, particleAge(p.percent)),
          position = localSpace(n) ? worldPosition(p.position, n, root) : p.position,
          velocity = localSpace(n) ? worldVector(p.velocity, n, root) : p.velocity;
        const noiseSize = p.noiseSize ?? 1;
        let w = p.size[0] * noiseSize,
          h = p.size[1] * noiseSize,
          angle = p.rotation;
        const sizeFactor = this.particleSize(s, p, age);
        w = w * sizeFactor[0];
        h = h * sizeFactor[1];
        const rotation = this.particleRotation(s, p, age),
          axisRotation =
            m.RotationModule.enabled && m.RotationModule.separateAxes ? rotation : null;
        angle = angle + rotation[2];
        const vertices: number[] = [],
          meshUV: number[] = [];
        const mesh = n.meshVariants?.[particleMeshIndex(p.seed, n.meshVariants.length)] ?? n.mesh;
        if (mesh) {
          const z = p.size[2] * noiseSize * sizeFactor[2];
          const size = [w, h, z],
            rotation =
              m.InitialModule.rotation3D || axisRotation
                ? [
                    p.rotationX + (axisRotation?.[0] ?? 0),
                    p.rotationY + (axisRotation?.[1] ?? 0),
                    angle,
                  ]
                : angle;
          const pivot = n.renderer.m_Pivot;
          let center = position;
          if (pivot && (pivot.x || pivot.y || pivot.z)) {
            const scale = particleScale(n);
            const local = meshPivotOffset(
              pivot,
              size.map((value, i) => (scale[i] === 0 ? 0 : value / scale[i])),
            );
            const pivotOffset = meshVertexOffset(local, size, rotation);
            // Local uses the emitter basis; View uses the scene camera basis.
            // The AVG scene camera has no roll, so its XY basis is identity.
            const shift =
              n.renderer.m_RenderAlignment === 2
                ? this.renderLocalVector(s, pivotOffset, root)
                : pivotOffset;
            center = position.map((v, i) => v + shift[i]);
          }
          for (const tri of mesh.triangles)
            for (const index of tri) {
              const offset =
                n.renderer.m_RenderAlignment === 4
                  ? velocityMeshOffset(mesh.positions[index], size, rotation, velocity)
                  : meshVertexOffset(mesh.positions[index], size, rotation);
              const delta =
                n.renderer.m_RenderAlignment === 2
                  ? this.renderLocalVector(s, offset, root)
                  : offset;
              vertices.push((center[0] + delta[0]) * 100, (center[1] + delta[1]) * 100);
              meshUV.push(...mesh.uv[index].slice(0, 2));
            }
        } else if (n.renderer.m_RenderMode === 1) {
          const scale = particleScale(n),
            geometry = stretchedVertices(
              {
                position,
                velocity,
                size: [w / scale[0], h / scale[1]],
                scale,
                pivot: xyz(n.renderer.m_Pivot ?? { x: 0, y: 0, z: 0 }),
                lengthScale: n.renderer.m_LengthScale,
                velocityScale: n.renderer.m_VelocityScale,
                minParticleSize: n.renderer.m_MinParticleSize ?? 0,
                maxParticleSize: n.renderer.m_MaxParticleSize,
              },
              camera,
              !!this.profile.ui,
            );
          for (const i of [0, 1, 2, 0, 2, 3]) {
            vertices.push(geometry.vertices[i][0] * 100, geometry.vertices[i][1] * 100);
            meshUV.push(...geometry.uv[i]);
          }
        } else if (n.renderer.m_RenderAlignment === 4) {
          const scale = this.profile.ui
            ? Math.min(
                1,
                (n.renderer.m_MaxParticleSize * 720) /
                  Math.max(w / (particleScale(n)[0] || 1), h / (particleScale(n)[1] || 1)),
              )
            : Math.min(1, (n.renderer.m_MaxParticleSize * 7.2) / Math.max(w, h));
          const pivot = n.renderer.m_Pivot;
          const corners = velocityQuad(
            p.velocity,
            [w * scale, h * scale],
            [p.rotationX, p.rotationY, angle],
            (v) => (localSpace(n) ? worldVector(v, n, root) : v),
            [(pivot?.x ?? 0) * w, (pivot?.y ?? 0) * h, 0],
          );
          for (const index of [3, 2, 0, 0, 2, 1])
            vertices.push(
              (position[0] + corners[index][0]) * 100,
              (position[1] + corners[index][1]) * 100,
            );
        } else {
          const scale = this.profile.ui
            ? Math.min(
                1,
                (n.renderer.m_MaxParticleSize * 720) /
                  Math.max(w / (particleScale(n)[0] || 1), h / (particleScale(n)[1] || 1)),
              )
            : Math.min(1, (n.renderer.m_MaxParticleSize * 7.2) / Math.max(w, h));
          w *= scale;
          h *= scale;
          const cos = Math.cos(angle),
            sin = Math.sin(angle);
          for (const [x, y] of [
            [-0.5, -0.5],
            [0.5, -0.5],
            [-0.5, 0.5],
            [-0.5, 0.5],
            [0.5, -0.5],
            [0.5, 0.5],
          ]) {
            const px = x - (n.renderer.m_Pivot?.x ?? 0),
              py = y - (n.renderer.m_Pivot?.y ?? 0);
            let delta = [px * w * cos - py * h * sin, px * w * sin + py * h * cos, 0];
            if (n.renderer.m_RenderAlignment === 2) delta = this.renderLocalVector(s, delta, root);
            vertices.push((position[0] + delta[0]) * 100, (position[1] + delta[1]) * 100);
          }
        }
        let u = 0,
          v = 0,
          uw = 1,
          vh = 1;
        const uv = m.UVModule;
        if (uv.enabled) {
          const index = Math.floor(this.particleUV(s, p) * uv.tilesX * uv.tilesY);
          uw = 1 / uv.tilesX;
          vh = 1 / uv.tilesY;
          u = (index % uv.tilesX) * uw;
          v = 1 - (Math.floor(index / uv.tilesX) + 1) * vh;
        }
        const flip = n.renderer.m_Flip;
        if (flip && (flip.x || flip.y)) {
          const [flipU, flipV] = billboardFlip(p.seed, flip.x, flip.y);
          if (flipU) {
            u += uw;
            uw = -uw;
          }
          if (flipV) {
            v += vh;
            vh = -vh;
          }
        }
        const color = this.particleColor(s, p),
          custom = particleCustomStreams(this.particleCustom(s, p), n.renderer);
        const colors = mesh?.colors
          ? mesh.triangles.flatMap((tri) =>
              tri.flatMap((index) => multiplyTrailColor(color, mesh.colors![index])),
            )
          : undefined;
        out.push({
          rendererKey: n.rendererKey,
          vertices,
          colors,
          uv:
            mesh || n.renderer.m_RenderMode === 1
              ? meshUV.map((value, i) => (i % 2 ? v + value * vh : u + value * uw))
              : [u, v, u + uw, v, u, v + vh, u, v + vh, u + uw, v, u + uw, v + vh],
          color,
          material: mainMaterial!,
          order: n.renderer.m_SortingOrder,
          depth: position[2],
          custom,
        });
      }
      if (n.extraMeshPasses) {
        // Submit the entire mesh particle group once per additional regular slot.
        // Slot 1 is reserved for trails in ParticleSystemRenderer_RenderMultipleMeshes.
        const firstPass = out.slice(firstPacket);
        for (let pass = 0; pass < n.extraMeshPasses; pass++) {
          for (const packet of firstPass) out.push({ ...packet, materialSlot: pass + 2 });
        }
      }
      out.push(...trails);
    }
    for (const mesh of this.profile.meshes) {
      if (
        opaqueOnly &&
        this.material(
          mesh.rendererKey,
          this.profile.materials[mesh.material],
          mesh.materialSlot ?? 0,
        ).shader !== 'builtin-error'
      )
        continue;
      if (!this.chainEnabled(mesh.transforms)) continue;
      const material = this.material(
          mesh.rendererKey,
          this.profile.materials[mesh.material],
          mesh.materialSlot ?? 0,
        ),
        vertices: number[] = [],
        uv: number[] = [],
        grabDirections: number[] = [];
      for (const tri of mesh.triangles)
        for (const index of tri) {
          const v = world(mesh.positions[index], mesh.transforms, false, true, root);
          vertices.push(v[0], v[1]);
          uv.push(...mesh.uv[index].slice(0, 2));
          if (material.shader === 'directional-grab') {
            const direction = world(
              grabObjectDirection(mesh.positions[index], material),
              mesh.transforms,
              true,
              true,
              root,
            );
            grabDirections.push(direction[0] / 1280, -direction[1] / 720);
          }
        }
      out.push({
        rendererKey: mesh.rendererKey + ':' + (mesh.materialSlot ?? 0),
        vertices,
        uv,
        grabDirections,
        color: [1, 1, 1, 1],
        material,
        order: mesh.order,
        depth: 0,
        custom: Array(8).fill(0),
      });
    }
    for (const trail of this.profile.standaloneTrails ?? []) {
      if (!this.chainEnabled(trail.transforms)) continue;
      const history = this.standalone.get(trail.rendererKey);
      if (!history) continue;
      const material = this.material(trail.rendererKey, this.profile.materials[trail.material]);
      if (opaqueOnly && material.shader !== 'builtin-error') continue;
      const lifetime = this.animator?.trailProperty(trail.rendererKey, 'm_Time') ?? trail.time;
      const { positions, masks } = history.flatten(this.time, lifetime, trail.emitting);
      if (positions.length < 2) continue;
      const params = trail.parameters,
        width =
          this.animator?.trailProperty(trail.rendererKey, 'widthMultiplier') ??
          params.widthMultiplier;
      const keys = params.widthCurve.m_Curve;
      const baseWidth = Math.max(0, ...keys.map((k: { value: number }) => k.value)) * width;
      const points = positions.map((v) => [
        v[0] + camera.x * 0.01,
        v[1] + camera.y * 0.01,
        -(v[2] - SCENE_CAMERA_Z),
      ]);
      const pairs = buildTrailPairs(
        points,
        baseWidth,
        (t, i) => sampleKeys(keys, t) * width * masks[i],
        params.textureMode,
      );
      const vertices: number[] = [],
        uv: number[] = [],
        colors: number[] = [];
      for (let i = 0; i < pairs.length - 2; i += 2)
        for (const index of [i, i + 1, i + 2, i + 1, i + 3, i + 2]) {
          const v = pairs[index];
          vertices.push(v.position[0] * 100 - camera.x, v.position[1] * 100 - camera.y);
          uv.push(...v.uv);
          colors.push(
            ...gradient({ minMaxState: 1, maxGradient: params.colorGradient }, v.progress, 1).map(
              (c) => nativeColorByte(c) / 255,
            ),
          );
        }
      out.push({
        rendererKey: trail.rendererKey + ':standalone-trail',
        vertices,
        uv,
        colors,
        color: [1, 1, 1, 1],
        material,
        order: trail.order,
        depth: points[0][2],
        custom: Array(8).fill(0),
      });
    }
    return out.sort((a, b) => a.order - b.order);
  }
}
