import { defaultEffectMotion, type EffectMotionOptions } from './effect-motion.ts';
import type { SharedUVMaterials } from './uv-tweener.ts';
import { NativeParticles, type NativeParticleProfile } from './native-particles.ts';
import { SignalParticles, type ParticleProfile } from './particles.ts';
import {
  readStreamedCurves,
  sampleStreamedCurve,
  type StreamKey,
} from '../core/animation-curve.ts';
export const MOHU_EFFECTS = ['avg_mohu_zhengyan_01', 'avg_mohu_biyan_01', 'avg_mohu_zhuanchang_01'];
export const FOREGROUND_EFFECTS = [
  'avg_077_aigis_02',
  'avg_077_fuuka_01',
  'avg_064_slashscreen_01',
  'avg_064_flamescreen_01',
  'avg_064_a_flash_of_knife_01',
  'avg_sand_tornado_01',
  'avg_079_slash02',
  'avg_079_slash01',
  'avg_079_leafmask',
  'avg_079_flameslash_01',
  'avg_dunji_02_large',
  'avg_079_slash_fire_02',
  'avg_079_daoguang01',
  'avg_079_daoguang02',
  'avg_079_daoguang02_hit',
  'avg_079_eyes_01',
  'avg_079_fire_01',
  'avg_076_wind',
  'avg_sheji_01',
  'avg_daoguang_guiji_04_large',
  'avg_073_slash_01',
  'avg_043_start_01',
  'avg_071_lightning_01',
  'avg_v071_line_01',
  'avg_wuli_hit_01',
  'avg_53_sweat_01',
  'avg_magic_ice_01',
  'avg_magic_shield_start',
  'avg_53_black_line_02',
  'avg_076_light',
  'avg_common_speedlines_01',
  'avg_071_arrow_01',
  'avg_070_daoguang_01',
  'avg_064_flameslash_01',
  'avg_route',
  'avg_daoguang_guiji_07',
  'avg_blkkgt_breathe_01',
  'avg_51_clouds_01',
  'avg_huanjing_effect_01',
  'avg_074_map_glow_2',
  'avg_common_underwatertransition_01',
  'avg_060_confusion_02',
  'avg_073_oripathy_heal_01',
  'avg_073_oripathy_heal_02',
  'avg_047_infect_01',
  'avg_76_emoji_cheer_01',
  'avg_76_emoji_angry',
  'avg_53_happy_02',
  'avg_magic_pingzhang_01',
  'avg_magic_lighting_01',
  'avg_dunji_01_large',
  'avg_dunji_02_small',
  'avg_v071_glow_02',
  'avg_076_screen',
  'avg_043_burst_01',
  'avg_fashu_hit_01',
  'avg_fashu_hit_02',
  'avg_daoguang_red',
  'avg_daoguang_hit_01',
  'avg_changqiang_hit_01',
  'avg_062_black_02',
  'avg_daoguang_guiji_03_blue',
  'avg_dunji_01_small',
  'avg_53_shy_01',
  'avg_amiya_attack_01',
  'avg_060_kaltsit_01',
  'avg_fengsha_02',
  'avg_water_hide_01',
  'avg_water_show_01',
  'avg_070_vanish_01',
  'avg_quant_attack_01',
  'avg_quant_attack_02',
  'avg_quant_hit_02',
  'avg_53_matter_01',
  'avg_53_question_01',
  'avg_dao_guiji_hit_02',
  'avg_daoguang_hit_02',
  'avg_daoguang_jingji_large',
  'avg_dust_01',
  'avg_magic_reflection_01',
  'avg_quant_hit_01',
  'avg_shuihua',
  'avg_dao_guiji_hit_01',
  'avg_036_daoguang_01',
  'avg_53_fengsha_02',
  'avg_dao_attack_guiji_02',
  'avg_daoguang_attack_01_small',
  'avg_daoguang_attack_02_small',
  'avg_daoguang_zhixian_01_small',
  'avg_magic_fire_01',
  'avg_daoguang_spark_01_mid',
  'avg_daoguang_attack_01_large',
  'avg_daoguang_attack_02_large',
  'avg_035_sandfall_01',
  'avg_daoguang_spark_02_large',
  'avg_daoguang_spark_01_large',
  'avg_070_shuimoqizi_01',
  'avg_dao_attack_guiji_01',
  'avg_daoguang_zhixian_01_large',
  'avg_daoguang_spark_02_mid',
  'avg_062_white_02',
  'avg_53_happy_01',
  'avg_53_proud_01',
  'avg_53_black_line_01',
  'avg_069_dizzy_01',
];
interface Parameter {
  overrideState: number;
  value: number | boolean;
}
export interface BlurProfile {
  kind: 'mohu-volume-v1';
  duration: number;
  curve: number[];
  initialWeight: number;
  priority: number;
  fadeType: 0;
  settings: Record<string, Parameter>;
}
export type BgEffectProfile = BlurProfile | ParticleProfile | NativeParticleProfile;
interface Effect {
  imageEffect?: boolean;
  name: string;
  layer: number;
  born: number;
  profile: BgEffectProfile;
  keys: StreamKey[];
  weight: number;
  order: number;
  particles?: SignalParticles | NativeParticles;
  showFade?: number;
  hideAt?: number;
  hideDuration?: number;
  transient?: boolean;
  expiresAt?: number;
  bornEpoch?: number;
}
export interface BlurParameters {
  degree: number;
  spread: number;
  mode: number;
  quality: number;
  enabled: boolean;
}
export class BackgroundEffects {
  private currentImage: Effect | undefined;
  private sharedUV: SharedUVMaterials = new WeakMap();
  private sequence = 0;
  private epoch = 0;
  private pending: {
    name: string;
    layer: number;
    at: number;
    profile: BgEffectProfile;
    fade: number;
    show: boolean;
    motion: EffectMotionOptions;
    transient?: boolean;
    duration?: number;
  }[] = [];
  private layers = new Map<number, Effect>();
  readonly instances: Effect[] = [];
  get active(): boolean {
    return this.instances.some((e) => e.weight > 0);
  }
  get deadlines(): number[] {
    return this.pending.map((p) => p.at);
  }
  executeImage(
    name: string,
    layer: number,
    profile: NativeParticleProfile | undefined,
    time: number,
    x = 0,
    y = 0,
  ): void {
    if (!name) {
      const old = this.currentImage;
      if (old) {
        if (old.particles instanceof NativeParticles) old.particles.dispose();
        const index = this.instances.indexOf(old);
        if (index >= 0) this.instances.splice(index, 1);
      }
      this.currentImage = undefined;
      return;
    }
    if (!profile?.imageBindings) throw Error('图像特效资源未准备：' + name);
    const motion = {
      ...defaultEffectMotion,
      x,
      y,
      rotation: profile.meshes[0]?.transforms[0].m_LocalRotation,
    };
    const particles = new NativeParticles(profile, undefined, false, this.sharedUV, motion);
    const effect: Effect = {
      name,
      layer,
      born: time,
      profile,
      keys: [],
      weight: 1,
      order: this.sequence++,
      particles,
      imageEffect: true,
    };
    // No expiry/ShowEffect and no replacement destruction in _ExcuteImageEffect.
    this.instances.push(effect);
    this.currentImage = effect;
  }
  executeTransient(
    name: string,
    layer: number,
    delay: number,
    duration: number,
    profile: BgEffectProfile | undefined,
    time: number,
    motion: EffectMotionOptions = defaultEffectMotion,
  ): void {
    if (!name) {
      this.pending = this.pending.filter((p) => !p.transient);
      for (const e of [...this.instances])
        if (e.transient) {
          if (e.particles instanceof NativeParticles) e.particles.dispose();
          this.instances.splice(this.instances.indexOf(e), 1);
        }
      return;
    }
    if (!profile || profile.kind !== 'native-particles-v2')
      throw new Error('前景特效资源未准备：' + name);
    this.pending.push({
      name,
      layer,
      at: time + Math.max(0, delay),
      profile,
      fade: 0,
      show: false,
      motion: { ...motion },
      transient: true,
      duration,
    });
  }
  execute(
    name: string,
    layer: number,
    delay: number,
    fade: number,
    profile: BgEffectProfile | undefined,
    time: number,
    show = false,
    motion: EffectMotionOptions = defaultEffectMotion,
  ): void {
    if (!name) {
      if (layer < 0) {
        for (let i = 0; i <= 4; i++) this.remove(i, 0, time);
      } else this.remove(layer, fade, time);
      return;
    }
    if (
      !profile ||
      !['mohu-volume-v1', 'signal-particles-v1', 'native-particles-v2'].includes(profile.kind)
    )
      throw new Error('背景特效未准备：' + name);
    // Native AppendInterval -> OnComplete instantiates on a later update,
    // including delay=0. Clearing existing layers does not kill this sequence.
    this.pending.push({
      name,
      layer,
      at: time + Math.max(0, delay),
      profile,
      fade,
      show,
      motion: { ...motion },
    });
  }
  private remove(layer: number, fade: number, time: number): void {
    const old = this.layers.get(layer);
    if (!old) return;
    this.layers.delete(layer);
    // AVGEffectItem.FadeType.None has no HideEffect behavior. A positive fade
    // removes its layer binding but leaves the object until the story resets.
    if (
      (old.profile.fadeType === 3 || old.profile.fadeType === 4) &&
      fade > 1e-5 &&
      old.particles instanceof NativeParticles
    )
      old.particles.hide(fade);
    if (old.profile.fadeType === 2 && fade > 1e-5) {
      old.hideAt = time;
      old.hideDuration = fade;
    }
    if (
      fade <= 1e-5 ||
      (old.profile.kind === 'native-particles-v2' && !old.profile.hasEffectItem)
    ) {
      if (old.particles instanceof NativeParticles) old.particles.dispose();
      const index = this.instances.indexOf(old);
      if (index >= 0) this.instances.splice(index, 1);
    }
  }
  update(time: number): void {
    this.epoch++;
    const due = this.pending.filter((p) => time >= p.at);
    this.pending = this.pending.filter((p) => time < p.at);
    for (const p of due) {
      if (!p.transient) this.remove(p.layer, 0, time);
      const e: Effect = {
        name: p.name,
        layer: p.layer,
        born: time,
        profile: p.profile,
        keys: p.profile.kind === 'mohu-volume-v1' ? readStreamedCurves(p.profile.curve, 1)[0] : [],
        weight: p.profile.kind === 'mohu-volume-v1' ? p.profile.initialWeight : 1,
        order: this.sequence++,
        transient: p.transient,
        bornEpoch: this.epoch,
      };
      if (p.transient && Math.abs(p.profile.duration) > 1e-5)
        e.expiresAt =
          time + Math.max(0, Math.abs(p.duration ?? 0) > 1e-5 ? p.duration! : p.profile.duration);
      if (p.profile.kind === 'signal-particles-v1') {
        e.particles = new SignalParticles(p.profile);
        e.showFade = p.show ? Math.max(0, p.fade) : 0;
      }
      if (p.profile.kind === 'native-particles-v2') {
        e.particles = new NativeParticles(
          p.profile,
          undefined,
          p.show && !p.profile.hasEffectItem,
          this.sharedUV,
          p.motion,
          p.show && p.profile.hasEffectItem,
        );
        e.showFade = p.profile.fadeType === 2 && p.show ? Math.max(0, p.fade) : 0;
        if ((p.profile.fadeType === 3 || p.profile.fadeType === 4) && p.show)
          e.particles.show(p.fade);
      }
      this.instances.push(e);
      if (!p.transient) this.layers.set(p.layer, e);
    }
    for (const e of [...this.instances]) {
      if (e.expiresAt !== undefined && time >= e.expiresAt && e.bornEpoch !== this.epoch) {
        if (e.particles instanceof NativeParticles) e.particles.dispose();
        this.instances.splice(this.instances.indexOf(e), 1);
        continue;
      }
      if (e.particles) {
        const smooth = (t: number) => {
          const v = Math.max(0, Math.min(1, t));
          return v * v * (3 - 2 * v);
        };
        e.particles.update(Math.max(0, time - e.born), (at) =>
          e.hideAt !== undefined && e.born + at >= e.hideAt
            ? 1 - smooth((e.born + at - e.hideAt) / e.hideDuration!)
            : e.showFade
              ? smooth(at / e.showFade)
              : 1,
        );
        if (
          (!e.imageEffect && e.particles instanceof NativeParticles && e.particles.finished) ||
          (e.hideAt !== undefined && time >= e.hideAt + e.hideDuration!)
        ) {
          if (e.particles instanceof NativeParticles) e.particles.dispose();
          this.instances.splice(this.instances.indexOf(e), 1);
          if (this.layers.get(e.layer) === e) this.layers.delete(e.layer);
        }
      } else if (e.profile.kind === 'mohu-volume-v1')
        e.weight = Math.max(
          0,
          Math.min(
            1,
            sampleStreamedCurve(e.keys, Math.min(e.profile.duration, Math.max(0, time - e.born))),
          ),
        );
    }
  }
  get cameraCount() {
    return this.instances.filter((e) => e.profile.kind === 'mohu-volume-v1').length;
  }
  parameters(): BlurParameters {
    const values: Record<string, number | boolean> = {
      enabled: false,
      blurDegree: 0,
      blurSpread: 0.2,
      resMode: 0,
      quality: 1,
    };
    for (const e of [...this.instances].sort(
      (a, b) =>
        (a.profile.kind === 'mohu-volume-v1' ? a.profile.priority : 0) -
          (b.profile.kind === 'mohu-volume-v1' ? b.profile.priority : 0) || a.order - b.order,
    )) {
      if (e.weight <= 0 || e.profile.kind !== 'mohu-volume-v1') continue;
      for (const [key, p] of Object.entries(e.profile.settings))
        if (p.overrideState) {
          if (key === 'blurDegree' || key === 'blurSpread')
            values[key] = Number(values[key]) + (Number(p.value) - Number(values[key])) * e.weight;
          else values[key] = p.value;
        }
    }
    return {
      enabled: !!values.enabled,
      degree: Number(values.blurDegree),
      spread: Number(values.blurSpread),
      mode: Number(values.resMode),
      quality: Number(values.quality),
    };
  }
  dispose() {
    this.currentImage = undefined;
    for (const e of this.instances)
      if (e.particles instanceof NativeParticles) e.particles.dispose();
    this.sharedUV = new WeakMap();
    this.pending = [];
    this.layers.clear();
    this.instances.length = 0;
  }
}
