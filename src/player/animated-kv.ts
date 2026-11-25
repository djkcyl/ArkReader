import { loadFont, loadImage, releaseFont } from './asset-load';
import { slicedQuads, type UISlice } from './ui-sliced';
import {
  customDisturbVertex,
  customDisturbVaryings,
  customDisturbUIProgram,
} from './ui-custom-disturb';
import { colorDodgeUIProgram } from './ui-color-dodge';
import { uiTransform } from './ui-transform';
import { sampleKeys, type CurveKey } from './particle-math';
import {
  commonUIProgram,
  commonClipUIProgram,
  commonClipMaskedUIProgram,
  disturbUIProgram,
  shapeUIProgram,
  fisheyeUIProgram,
  alphaUIProgram,
} from './ui-pixel-programs';
import { particlePropertyValue } from './particle-properties';
import { nativeColorUnit } from '../core/color32';
import { NativeParticles, type NativeParticleProfile, type NativeNode } from './native-particles';
import { SpineKV, type SpineProfile } from './spine-kv';
type Vec = {
  x: number;
  y: number;
  z?: number;
};
export interface KVStencil {
  Stencil: number;
  StencilComp: number;
  StencilOp: number;
  StencilReadMask: number;
  StencilWriteMask: number;
  ColorMask: number;
}
export interface KVMaterial {
  alphaClip?: boolean;
  stencil?: KVStencil;
  name: string;
  shader:
    | 'common'
    | 'commonClip'
    | 'disturb'
    | 'shape'
    | 'fisheye'
    | 'alpha'
    | 'spine'
    | 'dodge'
    | 'customDisturb';
  constants: number[];
  locations?: Record<
    string,
    {
      offset: number;
      size: number;
    }
  >;
  color: number[];
  dst: number;
  textures: {
    name: string;
    key: string | null;
    sampler: number;
    default?: string;
  }[];
}
export interface KVNode {
  spine?: SpineProfile;
  text?: {
    font: string;
    size: number;
    style: number;
    alignment: number;
    fallback: string;
    slot: number;
  };
  fit?: number[];
  layout?: Record<string, any>;
  stencil?: KVStencil;
  path: string;
  active: boolean;
  min: Vec;
  max: Vec;
  pos: Vec;
  size: Vec;
  pivot: Vec;
  scale: Vec;
  rotation: {
    x?: number;
    y?: number;
    z: number;
    w: number;
  };
  alpha?: number;
  mask?: boolean;
  color?: number[];
  material?: string | null;
  sprite?: {
    texture: string | null;
    uv: number[];
    padding: number[];
    slice?: UISlice;
  };
  particles?: {
    profile: NativeParticleProfile;
    material: string;
    pathId: string;
    animationPath?: string;
    extended?: boolean;
    self?: boolean;
    uiScale?: number[];
    rotation?: {
      x: number;
      y: number;
      z: number;
      w: number;
    };
    anchor?: {
      m_AnchorMin: Vec;
      m_AnchorMax: Vec;
      m_Pivot: Vec;
    };
    offset?: number[];
  }[];
  materialBindings?: {
    field: string;
    property: string;
    values: Record<string, number>;
  }[];
}
interface Animation {
  root: string;
  name: string;
  tracks: {
    path: string;
    property: string;
    keys: CurveKey[];
  }[];
  length: number;
  auto: boolean;
  wrap: number;
}
export interface AnimatedKVProfile {
  fonts?: Record<
    string,
    {
      url: string;
    }
  >;
  nodes: KVNode[];
  animations: Animation[];
  entries: {
    root: string;
    name: string;
  }[];
  materials: Record<string, KVMaterial>;
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
export interface AnimatedKV {
  spines?: Map<string, SpineKV>;
  clockEntry?: boolean;
  text?: string[];
  textMetrics?: Map<
    string,
    {
      width: number;
      height: number;
      ascent: number;
      descent: number;
      left: number;
    }
  >;
  alpha?: number;
  angle?: number;
  profile: AnimatedKVProfile;
  key: string;
  born: number;
  x: number;
  y: number;
  sx: number;
  sy: number;
  entry: number;
  entryIndex: number | null;
  particleTime?: number;
  particles?: Map<
    string,
    {
      system: NativeParticles;
      time: number;
    }
  >;
}
export function kvBindings(kv: AnimatedKV, time: number) {
  const values = new Map<string, Map<string, number>>();
  const entry = kv.entryIndex === null ? undefined : kv.profile.entries[kv.entryIndex];
  for (const a of kv.profile.animations) {
    const selected = entry?.root === a.root && entry.name === a.name;
    if (!a.auto && !selected) continue;
    let t = selected
      ? kv.clockEntry
        ? time - kv.born
        : kv.entry * a.length
      : Math.max(0, time - kv.born);
    if (!selected && a.wrap === 2) t %= a.length;
    else if (!selected && a.wrap === 4) {
      t %= 2 * a.length;
      if (t > a.length) t = 2 * a.length - t;
    } else t = Math.min(a.length, Math.max(0, t));
    for (const track of a.tracks) {
      const path = [a.root, track.path].filter(Boolean).join('/'),
        props = values.get(path) ?? new Map();
      props.set(track.property, sampleKeys(track.keys, t));
      values.set(path, props);
    }
  }
  return values;
}
export function kvRects(kv: AnimatedKV, time: number) {
  const bindings = kvBindings(kv, time),
    result = new Map<
      string,
      {
        w: number;
        h: number;
        x: number;
        y: number;
        alpha: number;
        world: number[];
        chain: NativeNode['transforms'];
      }
    >();
  const sizes = new Map<
    string,
    {
      w: number;
      h: number;
    }
  >();
  for (const n of kv.profile.nodes)
    if (n.layout) {
      const child = kv.profile.nodes.find(
          (c) => c.text && c.path.slice(0, c.path.lastIndexOf('/')) === n.path,
        ),
        m = child && kv.textMetrics?.get(child.path);
      if (m && child)
        sizes.set(n.path, { w: m.width * child.scale.x, h: m.height * child.scale.y });
    }
  for (const n of kv.profile.nodes) {
    const parent = n.path
      ? result.get(n.path.slice(0, Math.max(0, n.path.lastIndexOf('/'))))
      : { w: 1280, h: 720, alpha: kv.alpha ?? 1, world: [1, 0, 0, 1, 0, 0], chain: [] };
    if (!parent) continue;
    const p = bindings.get(n.path),
      v = (key: string, def: number) => p?.get(key) ?? def;
    if (!v('m_IsActive', Number(n.active))) continue;
    const pn = n.path
        ? kv.profile.nodes.find(
            (q) => q.path === n.path.slice(0, Math.max(0, n.path.lastIndexOf('/'))),
          )
        : undefined,
      pivot = pn?.pivot ?? { x: 0.5, y: 0.5 };
    const anchor = (a: 'x' | 'y') =>
      v('m_AnchorMin.' + a, n.min[a]) +
      (v('m_AnchorMax.' + a, n.max[a]) - v('m_AnchorMin.' + a, n.min[a])) * n.pivot[a] -
      pivot[a];
    const m = kv.textMetrics?.get(n.path),
      fit = sizes.get(n.path);
    const w =
      m?.width ??
      (n.fit?.[0] === 2 && fit
        ? fit.w
        : parent.w * (v('m_AnchorMax.x', n.max.x) - v('m_AnchorMin.x', n.min.x)) +
          v('m_SizeDelta.x', n.size.x));
    const h =
      m?.height ??
      (n.fit?.[1] === 2 && fit
        ? fit.h
        : parent.h * (v('m_AnchorMax.y', n.max.y) - v('m_AnchorMin.y', n.min.y)) +
          v('m_SizeDelta.y', n.size.y));
    let x = parent.w * anchor('x') + v('m_AnchoredPosition.x', n.pos.x),
      y = parent.h * anchor('y') + v('m_AnchoredPosition.y', n.pos.y);
    const sx = v('scale.x', n.scale.x),
      sy = v('scale.y', n.scale.y);
    if (n.text && pn?.layout) {
      x = -parent.w * pivot.x + w * n.pivot.x * sx;
      y = -parent.h * pivot.y + h * n.pivot.y * sy;
    }
    x = v('m_LocalPosition.x', x);
    y = v('m_LocalPosition.y', y);
    const transform = {
      m_LocalPosition: { x, y, z: v('m_LocalPosition.z', n.pos.z ?? 0) },
      m_LocalScale: { x: sx, y: sy, z: v('scale.z', n.scale.z ?? 1) },
      m_LocalRotation: {
        x: v('rotation.x', n.rotation.x ?? 0),
        y: v('rotation.y', n.rotation.y ?? 0),
        z: v('rotation.z', n.rotation.z),
        w: v('rotation.w', n.rotation.w),
      },
    };
    const angle = 2 * Math.atan2(v('rotation.z', n.rotation.z), v('rotation.w', n.rotation.w)),
      co = Math.cos(angle),
      si = Math.sin(angle),
      a = parent.world;
    result.set(n.path, {
      w,
      h,
      x,
      y,
      chain: [...parent.chain, transform],
      alpha: parent.alpha * v('m_Alpha', n.alpha ?? 1),
      world: [
        (a[0] * co + a[2] * si) * sx,
        (a[1] * co + a[3] * si) * sx,
        (-a[0] * si + a[2] * co) * sy,
        (-a[1] * si + a[3] * co) * sy,
        a[0] * x + a[2] * y + a[4],
        a[1] * x + a[3] * y + a[5],
      ],
    });
  }
  return result;
}
function uiParticleChain(
  node: KVNode,
  ps: NonNullable<KVNode['particles']>[number],
  rect: ReturnType<typeof kvRects> extends Map<string, infer T> ? T : never,
): NativeNode['transforms'] {
  const identity = {
    m_LocalPosition: { x: 0, y: 0, z: 0 },
    m_LocalScale: { x: 1, y: 1, z: 1 },
    m_LocalRotation: { x: 0, y: 0, z: 0, w: 1 },
  };
  const chain = [identity, ...rect.chain];
  if (ps.self) return chain;
  const emitter = structuredClone(ps.profile.nodes[0].transforms[0]),
    anchor = ps.anchor;
  emitter.m_LocalPosition = {
    x: ps.offset?.[0] ?? 0,
    y: ps.offset?.[1] ?? 0,
    z: emitter.m_LocalPosition.z,
  };
  if (anchor?.m_AnchorMin)
    for (const axis of ['x', 'y'] as const)
      emitter.m_LocalPosition[axis] +=
        (axis === 'x' ? rect.w : rect.h) *
        (anchor.m_AnchorMin[axis] +
          (anchor.m_AnchorMax[axis] - anchor.m_AnchorMin[axis]) * anchor.m_Pivot[axis] -
          node.pivot[axis]);
  chain.push(emitter);
  return chain;
}
export function updateAnimatedKV(kv: AnimatedKV, time: number) {
  const dt = Math.max(0, time - (kv.particleTime ?? kv.born));
  kv.particleTime = time;
  if (!kv.profile.nodes.some((n) => n.particles?.length || n.spine)) return;
  const bindings = kvBindings(kv, time),
    rects = kvRects(kv, time),
    active = new Map<string, number>();
  kv.particles ??= new Map();
  for (const n of kv.profile.nodes) {
    const parent = n.path ? active.get(n.path.slice(0, Math.max(0, n.path.lastIndexOf('/')))) : 1;
    const props = bindings.get(n.path),
      enabled = parent !== undefined && (props?.get('m_IsActive') ?? Number(n.active)) !== 0;
    const alpha = enabled ? parent! * (props?.get('m_Alpha') ?? n.alpha ?? 1) : undefined;
    if (alpha !== undefined) active.set(n.path, alpha);
    if (n.spine && enabled) {
      kv.spines ??= new Map();
      let instance = kv.spines.get(n.path);
      if (!instance) {
        instance = new SpineKV(n.spine);
        kv.spines.set(n.path, instance);
      }
      instance.update(dt);
    }
    for (const ps of n.particles ?? []) {
      let instance = kv.particles.get(ps.pathId);
      if (!enabled) {
        instance?.system.dispose();
        kv.particles.delete(ps.pathId);
        continue;
      }
      if (!instance) {
        const world = !!kv.text && ps.profile.nodes[0].main.moveWithTransform === 1;
        const profile = world || ps.extended ? structuredClone(ps.profile) : ps.profile;
        if (ps.extended) {
          profile.ui = true;
          profile.nodes[0].main.ui = true;
          profile.nodes[0].transforms = uiParticleChain(n, ps, rects.get(n.path)!);
        }
        if (world) {
          const a = kvRects(kv, time).get(n.path)!.world,
            t = profile.nodes[0].transforms[0];
          t.m_LocalScale.x *= Math.hypot(a[0], a[1]);
          t.m_LocalScale.y *= Math.hypot(a[2], a[3]);
        }
        // UIParticle simulates with the current frame's transform. The native
        // simulator already interpolates emitter movement for births within it.
        const pose = world
          ? () => {
              const a = kvRects(kv, kv.particleTime ?? time).get(n.path)?.world ?? [
                1, 0, 0, 1, 0, 0,
              ];
              return {
                x: a[4],
                y: a[5],
                flip: 0,
                rotation: {
                  x: 0,
                  y: 0,
                  z: Math.sin(Math.atan2(a[1], a[0]) / 2),
                  w: Math.cos(Math.atan2(a[1], a[0]) / 2),
                },
              };
            }
          : undefined;
        instance = {
          system: new NativeParticles(profile, undefined, false, undefined, undefined, false, pose),
          time: 0,
        };
        kv.particles.set(ps.pathId, instance);
      }
      if (ps.extended)
        instance.system.profile.nodes[0].transforms = uiParticleChain(n, ps, rects.get(n.path)!);
      if (ps.extended && ps.animationPath) {
        const animated = bindings.get(ps.animationPath),
          target = instance.system.profile.nodes[0],
          defaults = ps.profile.nodes[0];
        for (const property of [
          'simulationSpeed',
          'EmissionModule.rateOverTime.scalar',
          'EmissionModule.rateOverTime.minScalar',
          'ShapeModule.radius.value',
        ]) {
          const parts = property.split('.');
          let dst: any = parts.length === 1 ? target.main : target.modules,
            src: any = parts.length === 1 ? defaults.main : defaults.modules;
          for (const part of parts.slice(0, -1)) {
            dst = dst[part];
            src = src[part];
          }
          const key = parts.at(-1)!,
            value = animated?.get(property) ?? src[key];
          dst[key] = particlePropertyValue(property, value);
        }
      }
      if (Math.abs(alpha!) > 1e-5) {
        instance.time += dt;
        instance.system.update(instance.time);
      }
    }
  }
}
export function disposeAnimatedKV(kv: AnimatedKV) {
  for (const p of kv.particles?.values() ?? []) p.system.dispose();
  kv.particles?.clear();
  kv.spines?.clear();
}
export function kvMaterial(
  kv: AnimatedKV,
  n: KVNode,
  bindings: ReturnType<typeof kvBindings>,
): KVMaterial | undefined {
  const base = n.material ? kv.profile.materials[n.material] : undefined;
  if (!base || !n.materialBindings?.length) return base;
  const material = { ...base, constants: [...base.constants], color: [...base.color] };
  for (const binding of n.materialBindings) {
    const location = base.locations?.[binding.property];
    if (!location && binding.property !== '_Color')
      throw Error('未绑定的动画 CG 材质属性 ' + binding.property);
    const values = Object.entries(binding.values).map(
      ([component, value]) => bindings.get(n.path)?.get(binding.field + '.' + component) ?? value,
    );
    if (location)
      for (let i = 0; i < Math.min(values.length, location.size); i++)
        material.constants[location.offset + i] = values[i];
    if (binding.property === '_Color') material.color = values;
  }
  return material;
}
const vertex = `#version 300 es
layout(location=0)in vec2 point;layout(location=1)in vec2 texcoord;layout(location=2)in vec2 localPoint;layout(location=3)in vec4 vertexColor;out vec4 particleColor;
out vec2 uv;out vec2 local;void main(){gl_Position=vec4(point,0,1);uv=texcoord;local=localPoint;particleColor=vertexColor;}`;
const prefix = `#version 300 es
precision highp float;uniform vec4 cb[21];uniform vec4 clock;uniform vec4 tint;uniform vec4 clipRect;uniform vec2 pixelScale;uniform bool clipped;uniform bool alphaClip;uniform int dodgePass;
uniform sampler2D tex0;uniform sampler2D tex1;uniform sampler2D tex2;uniform sampler2D tex3;uniform sampler2D tex4;uniform sampler2D tex5;
in vec2 uv;in vec2 local;in vec4 particleColor;out vec4 frag;void main(){vec4 uv4=vec4(uv,0,0),col=tint*particleColor,mask4=vec4(local*2.-clipRect.xy-clipRect.zw,pixelScale);
vec4 r0=vec4(0),r1=vec4(0),r2=vec4(0),r3=vec4(0),r4=vec4(0),o0=vec4(0);`;
export class AnimatedKVRenderer {
  readonly canvas = document.createElement('canvas');
  readonly gl: WebGL2RenderingContext;
  private programs: Record<string, WebGLProgram> = {};
  private textures = new Map<string, WebGLTexture>();
  private buffer: WebGLBuffer;
  private white: WebGLTexture;
  private black: WebGLTexture;
  private background: WebGLTexture;
  frames = 0;
  particleDraws = 0;
  private fonts = new Map<string, FontFace>();
  private textImages = new WeakMap<AnimatedKV, Map<string, WebGLTexture>>();
  releaseSpell = (kv: AnimatedKV) => {
    for (const t of this.textImages.get(kv)?.values() ?? []) this.gl.deleteTexture(t);
    this.textImages.delete(kv);
  };
  prepareSpell = (kv: AnimatedKV) => {
    const g = this.gl,
      images = new Map<string, WebGLTexture>();
    kv.textMetrics = new Map();
    for (const n of kv.profile.nodes)
      if (n.text) {
        const font = n.text,
          text = kv.text?.[font.slot] ?? font.fallback,
          c = document.createElement('canvas'),
          ctx = c.getContext('2d')!;
        const css = `${font.style === 2 ? 'italic ' : ''}${font.size}px "ArkSpell ${font.font}"`;
        ctx.font = css;
        const m = ctx.measureText(text),
          height = m.fontBoundingBoxAscent + m.fontBoundingBoxDescent;
        kv.textMetrics.set(n.path, {
          width: m.width,
          height,
          ascent: m.actualBoundingBoxAscent,
          descent: m.actualBoundingBoxDescent,
          left: m.actualBoundingBoxLeft,
        });
        c.width = Math.max(1, Math.ceil(m.width * 2));
        c.height = Math.max(1, Math.ceil(height * 2));
        ctx.scale(2, 2);
        ctx.font = css;
        ctx.fillStyle = 'white';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(text, m.actualBoundingBoxLeft, height - m.actualBoundingBoxDescent);
        const texture = g.createTexture()!;
        g.bindTexture(g.TEXTURE_2D, texture);
        g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, 1);
        g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, c);
        g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR);
        g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
        g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
        g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
        images.set(n.path, texture);
      }
    for (const texture of this.textImages.get(kv)?.values() ?? []) g.deleteTexture(texture);
    this.textImages.set(kv, images);
  };
  constructor() {
    const g = this.canvas.getContext('webgl2', {
      alpha: false,
      stencil: true,
      premultipliedAlpha: false,
      antialias: false,
      preserveDrawingBuffer: true,
    });
    if (!g) throw new Error('无法创建动画 CG 渲染器');
    this.gl = g;
    const compile = (type: number, code: string) => {
      const s = g.createShader(type)!;
      g.shaderSource(s, code);
      g.compileShader(s);
      if (!g.getShaderParameter(s, g.COMPILE_STATUS)) throw new Error(g.getShaderInfoLog(s)!);
      return s;
    };
    const vs = compile(g.VERTEX_SHADER, vertex);
    for (const [name, body] of Object.entries({
      customDisturb: customDisturbUIProgram,
      dodge: colorDodgeUIProgram,
      common: commonUIProgram,
      commonClip: commonClipUIProgram,
      disturb: disturbUIProgram,
      shape: shapeUIProgram,
      fisheye: fisheyeUIProgram,
      alpha: alphaUIProgram,
      spine:
        'vec4 t=texture(tex0,uv);t.rgb*=t.a;frag=t*tint;frag.rgb*=tint.a;if(frag.a<.001)discard;',
      plain: 'frag=texture(tex0,uv)*tint;',
    })) {
      const clip =
        name === 'dodge'
          ? 'frag.a*=float(all(greaterThanEqual(local,clipRect.xy))&&all(lessThanEqual(local,clipRect.zw)));if(alphaClip&&frag.a<.001)discard;'
          : name === 'spine'
            ? 'frag*=float(all(greaterThanEqual(local,clipRect.xy))&&all(lessThanEqual(local,clipRect.zw)));if(frag.a<.001)discard;'
            : name.startsWith('common')
              ? 'vec2 m=clamp((clipRect.zw-clipRect.xy-abs(local*2.-clipRect.xy-clipRect.zw))*pixelScale,0.,1.);frag.a*=m.x*m.y;'
              : 'frag.a*=float(all(greaterThanEqual(local,clipRect.xy))&&all(lessThanEqual(local,clipRect.zw)));';
      const clipping =
        name === 'commonClip'
          ? 'if(clipped){' + commonClipMaskedUIProgram + '}else{' + body + '}'
          : name === 'alpha'
            ? 'if(clipped&&(!all(greaterThanEqual(local,clipRect.xy))||!all(lessThanEqual(local,clipRect.zw))))discard;' +
              body
            : body + 'if(clipped){' + clip + '}';
      const p = g.createProgram()!;
      const custom = name === 'customDisturb';
      g.attachShader(
        p,
        custom
          ? compile(
              g.VERTEX_SHADER,
              vertex
                .replace(
                  'out vec2 uv;',
                  customDisturbVaryings + 'uniform vec4 cb[21];uniform vec4 clock;out vec2 uv;',
                )
                .replace('local=localPoint;', 'local=localPoint;' + customDisturbVertex),
            )
          : vs,
      );
      g.attachShader(
        p,
        compile(
          g.FRAGMENT_SHADER,
          (custom
            ? prefix.replace('in vec2 uv;', 'in vec4 effectUV;in vec4 effectAux;in vec2 uv;')
            : prefix) +
            clipping +
            '}',
        ),
      );
      g.linkProgram(p);
      if (!g.getProgramParameter(p, g.LINK_STATUS)) throw new Error(g.getProgramInfoLog(p)!);
      this.programs[name] = p;
    }
    this.buffer = g.createBuffer()!;
    this.white = g.createTexture()!;
    g.bindTexture(g.TEXTURE_2D, this.white);
    g.texImage2D(
      g.TEXTURE_2D,
      0,
      g.RGBA,
      1,
      1,
      0,
      g.RGBA,
      g.UNSIGNED_BYTE,
      new Uint8Array([255, 255, 255, 255]),
    );
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.NEAREST);
    this.black = g.createTexture()!;
    g.bindTexture(g.TEXTURE_2D, this.black);
    g.texImage2D(
      g.TEXTURE_2D,
      0,
      g.RGBA,
      1,
      1,
      0,
      g.RGBA,
      g.UNSIGNED_BYTE,
      new Uint8Array([0, 0, 0, 255]),
    );
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.NEAREST);
    this.background = g.createTexture()!;
  }
  async load(p: AnimatedKVProfile, signal?: AbortSignal) {
    const g = this.gl;
    for (const [name, resource] of Object.entries(p.fonts ?? {}))
      if (!this.fonts.has(name)) {
        const face = await loadFont('ArkSpell ' + name, resource.url, signal);
        signal?.throwIfAborted();
        this.fonts.set(name, face);
      }
    for (const [key, t] of Object.entries(p.textures)) {
      if (this.textures.has(key)) continue;
      const image = await loadImage(t.url, signal);
      signal?.throwIfAborted();
      if (image.width !== t.width || image.height !== t.height)
        throw new Error('动画 CG 纹理尺寸不符');
      const texture = g.createTexture()!;
      g.bindTexture(g.TEXTURE_2D, texture);
      g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, 1);
      g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, image);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, t.filter ? g.LINEAR : g.NEAREST);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, t.filter ? g.LINEAR : g.NEAREST);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, t.wrapU ? g.CLAMP_TO_EDGE : g.REPEAT);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, t.wrapV ? g.CLAMP_TO_EDGE : g.REPEAT);
      this.textures.set(key, texture);
    }
  }
  private submit(
    vertices: number[],
    color: number[],
    material: KVMaterial | undefined,
    main: WebGLTexture,
    time: number,
    clip?: {
      rect: number[];
      scale: number[];
    },
    vertexColors?: number[],
  ) {
    const g = this.gl,
      p = this.programs[material?.shader ?? 'plain'];
    g.useProgram(p);
    const loc = (s: string) => g.getUniformLocation(p, s);
    const stencil = material?.stencil;
    if (stencil) {
      const compare: Record<number, number> = { 8: g.ALWAYS, 3: g.EQUAL, 6: g.NOTEQUAL },
        op: Record<number, number> = { 0: g.KEEP, 1: g.ZERO, 2: g.REPLACE, 5: g.INVERT };
      if (compare[stencil.StencilComp] === undefined || op[stencil.StencilOp] === undefined)
        throw Error('不支持当前界面的遮罩设置');
      g.enable(g.STENCIL_TEST);
      g.stencilFunc(compare[stencil.StencilComp], stencil.Stencil, stencil.StencilReadMask);
      g.stencilMask(stencil.StencilWriteMask);
      g.stencilOp(g.KEEP, g.KEEP, op[stencil.StencilOp]);
      g.colorMask(
        !!(stencil.ColorMask & 8),
        !!(stencil.ColorMask & 4),
        !!(stencil.ColorMask & 2),
        !!(stencil.ColorMask & 1),
      );
    } else {
      g.disable(g.STENCIL_TEST);
      g.colorMask(true, true, true, true);
    }
    const tint =
      material && !material.shader.startsWith('common')
        ? color.map((v, i) => v * material.color[i])
        : color;
    if (material?.shader === 'spine') for (let i = 0; i < 3; i++) tint[i] *= material.color[3];
    g.uniform4fv(loc('tint'), tint);
    g.uniform4fv(loc('clock'), [time / 20, time, time * 2, time * 3]);
    if (material) {
      const constants =
        material.shader === 'commonClip' && clip ? [...material.constants] : material.constants;
      if (material.shader === 'commonClip' && clip) constants.splice(32, 4, ...clip.rect);
      g.uniform4fv(loc('cb'), constants);
    }
    g.uniform1i(loc('clipped'), clip ? 1 : 0);
    if (clip) {
      g.uniform4fv(loc('clipRect'), clip.rect);
      g.uniform2fv(loc('pixelScale'), clip.scale);
    }
    if (material) {
      for (const [i, t] of material.textures.entries()) {
        const texture =
          t.name === '_MainTex'
            ? main
            : t.key
              ? this.textures.get(t.key)
              : t.default === 'black'
                ? this.black
                : this.white;
        if (!texture) throw new Error('动画 CG 材质纹理未加载');
        g.activeTexture(g.TEXTURE0 + i);
        g.bindTexture(g.TEXTURE_2D, texture);
        g.uniform1i(loc('tex' + i), i);
      }
    } else {
      g.activeTexture(g.TEXTURE0);
      g.bindTexture(g.TEXTURE_2D, main);
      g.uniform1i(loc('tex0'), 0);
    }
    const packed = vertexColors
      ? vertices.flatMap((value, index) =>
          index % 6 === 5
            ? [
                value,
                ...vertexColors.slice(Math.floor(index / 6) * 4, Math.floor(index / 6) * 4 + 4),
              ]
            : [value],
        )
      : vertices;
    g.bindBuffer(g.ARRAY_BUFFER, this.buffer);
    g.bufferData(g.ARRAY_BUFFER, new Float32Array(packed), g.STREAM_DRAW);
    const stride = vertexColors ? 40 : 24;
    for (let i = 0; i < 3; i++) {
      g.enableVertexAttribArray(i);
      g.vertexAttribPointer(i, 2, g.FLOAT, false, stride, i * 8);
    }
    if (vertexColors) {
      g.enableVertexAttribArray(3);
      g.vertexAttribPointer(3, 4, g.FLOAT, false, stride, 24);
    } else {
      g.disableVertexAttribArray(3);
      g.vertexAttrib4f(3, 1, 1, 1, 1);
    }
    if (material?.shader === 'dodge') {
      g.enable(g.BLEND);
      g.blendFuncSeparate(g.DST_COLOR, g.ONE, g.ONE, g.ZERO);
      g.uniform1i(loc('alphaClip'), material.alphaClip ? 1 : 0);
      for (let pass = 0; pass < 5; pass++) {
        g.uniform1i(loc('dodgePass'), pass);
        g.drawArrays(g.TRIANGLES, 0, vertices.length / 6);
      }
    } else {
      if (material?.shader === 'customDisturb' && g.isEnabled(g.BLEND))
        g.blendFuncSeparate(
          g.SRC_ALPHA,
          material.dst === 1 ? g.ONE : g.ONE_MINUS_SRC_ALPHA,
          g.ONE,
          g.ONE_MINUS_SRC_ALPHA,
        );
      g.drawArrays(g.TRIANGLES, 0, vertices.length / 6);
    }
  }
  draw(context: CanvasRenderingContext2D, kv: AnimatedKV, time: number) {
    const g = this.gl,
      w = context.canvas.width,
      h = context.canvas.height;
    this.canvas.width = w;
    this.canvas.height = h;
    g.viewport(0, 0, w, h);
    g.stencilMask(255);
    g.clearStencil(0);
    g.clear(g.STENCIL_BUFFER_BIT);
    g.disable(g.BLEND);
    g.activeTexture(g.TEXTURE0);
    g.bindTexture(g.TEXTURE_2D, this.background);
    g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, 1);
    g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, context.canvas);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
    this.submit(
      [-1, -1, 0, 0, 0, 0, 3, -1, 2, 0, 0, 0, -1, 3, 0, 2, 0, 0],
      [1, 1, 1, 1],
      undefined,
      this.background,
      time,
    );
    const bindings = kvBindings(kv, time),
      rects = kv.text ? kvRects(kv, time) : undefined,
      value = (n: KVNode, key: string, fallback: number) =>
        bindings.get(n.path)?.get(key) ?? fallback;
    type Box = {
      w: number;
      h: number;
      pivot: Vec;
      matrix: DOMMatrix;
      alpha: number;
      mask?: number[];
    };
    const boxes = new Map<string, Box>(),
      base = context
        .getTransform()
        .translate(640 + kv.x, 360 - kv.y)
        .scale(kv.sx, kv.sy);
    const root: Box = {
      w: 1280,
      h: 720,
      pivot: { x: 0.5, y: 0.5 },
      matrix: base,
      alpha: kv.alpha ?? 1,
    };
    for (const n of kv.profile.nodes) {
      const parent = n.path
        ? boxes.get(n.path.slice(0, Math.max(0, n.path.lastIndexOf('/'))))
        : root;
      if (!parent || !value(n, 'm_IsActive', Number(n.active))) continue;
      const rect = rects?.get(n.path);
      const width = rect?.w ?? parent.w * (n.max.x - n.min.x) + value(n, 'm_SizeDelta.x', n.size.x),
        height = rect?.h ?? parent.h * (n.max.y - n.min.y) + value(n, 'm_SizeDelta.y', n.size.y);
      const anchor = (axis: 'x' | 'y') =>
        n.min[axis] + (n.max[axis] - n.min[axis]) * n.pivot[axis] - parent.pivot[axis];
      const x = rect?.x ?? parent.w * anchor('x') + value(n, 'm_AnchoredPosition.x', n.pos.x),
        y = rect?.y ?? parent.h * anchor('y') + value(n, 'm_AnchoredPosition.y', n.pos.y);
      const matrix = parent.matrix.multiply(
        new DOMMatrix(
          uiTransform(
            value(n, 'm_LocalPosition.x', x),
            value(n, 'm_LocalPosition.y', y),
            value(n, 'm_LocalPosition.z', n.pos.z ?? 0),
            {
              x: value(n, 'scale.x', n.scale.x),
              y: value(n, 'scale.y', n.scale.y),
              z: value(n, 'scale.z', n.scale.z ?? 1),
            },
            {
              x: value(n, 'rotation.x', n.rotation.x ?? 0),
              y: value(n, 'rotation.y', n.rotation.y ?? 0),
              z: value(n, 'rotation.z', n.rotation.z),
              w: value(n, 'rotation.w', n.rotation.w),
            },
          ),
        ),
      );
      const alpha = parent.alpha * value(n, 'm_Alpha', n.alpha ?? 1),
        left = -width * n.pivot.x,
        top = -height * (1 - n.pivot.y);
      let mask = parent.mask;
      if (n.mask) {
        if (Math.abs(matrix.b) > 1e-6 || Math.abs(matrix.c) > 1e-6)
          throw new Error('不支持旋转的动画 CG 矩形遮罩');
        const a = matrix.transformPoint({ x: left, y: top }),
          b = matrix.transformPoint({ x: left + width, y: top + height });
        const rect = [
          Math.min(a.x, b.x),
          Math.min(a.y, b.y),
          Math.max(a.x, b.x),
          Math.max(a.y, b.y),
        ];
        mask = mask
          ? [
              Math.max(mask[0], rect[0]),
              Math.max(mask[1], rect[1]),
              Math.min(mask[2], rect[2]),
              Math.min(mask[3], rect[3]),
            ]
          : rect;
      }
      boxes.set(n.path, { w: width, h: height, pivot: n.pivot, matrix, alpha, mask });
      if (n.layout) {
        g.stencilMask(255);
        g.clearStencil(0);
        g.clear(g.STENCIL_BUFFER_BIT);
      }
      const clip = mask
        ? { rect: [mask[0], -mask[3], mask[2], -mask[1]], scale: [0.5, 0.5] }
        : undefined;
      if (alpha > 1e-5 && n.spine) {
        const instance = kv.spines?.get(n.path);
        if (instance) {
          const color = ['r', 'g', 'b', 'a'].map((v, i) =>
            value(n, 'm_Color.' + v, n.color?.[i] ?? 1),
          );
          instance.skeleton.color.set(...(color as [number, number, number, number]));
          for (const draw of instance.drawables()) {
            const material = kv.profile.materials[draw.material],
              main = material.textures.find((t) => t.name === '_MainTex')?.key,
              vertices: number[] = [];
            for (let i = 0; i < draw.vertices.length; i += 2) {
              const p = matrix.transformPoint({
                x: draw.vertices[i] * 100,
                y: -(draw.vertices[i + 1] * 100),
              });
              vertices.push(
                (p.x / w) * 2 - 1,
                1 - (p.y / h) * 2,
                draw.uv[i],
                draw.uv[i + 1],
                p.x,
                -p.y,
              );
            }
            const tint = draw.color.map(nativeColorUnit);
            tint[3] *= alpha;
            g.enable(g.BLEND);
            g.blendFunc(g.ONE, g.ONE_MINUS_SRC_ALPHA);
            this.submit(
              vertices,
              tint,
              material,
              main ? this.textures.get(main)! : this.white,
              time,
              clip,
            );
          }
        }
      }
      if (alpha > 1e-5)
        for (const ps of n.particles ?? []) {
          const material = kv.profile.materials[ps.material],
            system = kv.particles?.get(ps.pathId)?.system;
          if (!system) continue;
          const main = material.textures.find((t) => t.name === '_MainTex')?.key;
          for (const draw of system.drawables()) {
            const vertices: number[] = [];
            const world =
              ps.extended || (!!kv.text && ps.profile.nodes[0].main.moveWithTransform === 1);
            for (let i = 0; i < draw.vertices.length; i += 2) {
              const p = (world ? base : matrix).transformPoint({
                x: draw.vertices[i] + (world ? 0 : (ps.offset?.[0] ?? 0)),
                y: -draw.vertices[i + 1] - (world ? 0 : (ps.offset?.[1] ?? 0)),
              });
              vertices.push(
                (p.x / w) * 2 - 1,
                1 - (p.y / h) * 2,
                draw.uv[i],
                draw.uv[i + 1],
                p.x,
                -p.y,
              );
            }
            const tint = draw.color.map(nativeColorUnit);
            tint[3] *= alpha;
            g.enable(g.BLEND);
            g.blendFunc(g.SRC_ALPHA, material.dst === 1 ? g.ONE : g.ONE_MINUS_SRC_ALPHA);
            this.submit(
              vertices,
              tint,
              material,
              main ? this.textures.get(main)! : this.white,
              time,
              clip,
              draw.colors?.map(nativeColorUnit),
            );
            this.particleDraws++;
          }
        }
      if ((!n.sprite && !n.text) || width <= 0 || height <= 0) continue;
      // Image builds a Color32 vertex stream; CanvasGroup alpha is applied later.
      const color = ['r', 'g', 'b', 'a'].map((v, i) =>
        nativeColorUnit(value(n, 'm_Color.' + v, n.color?.[i] ?? 1)),
      );
      color[3] *= alpha;
      if (color[3] <= 0) continue;
      const vertices: number[] = [],
        { uv, padding } = n.sprite ?? { uv: [0, 0, 1, 1], padding: [0, 0, 1, 1] };
      const quads = n.sprite?.slice
        ? slicedQuads(width, height, uv, n.sprite.slice)
        : [
            [
              width * padding[0],
              height * padding[1],
              width * padding[2],
              height * padding[3],
              ...uv,
            ],
          ];
      for (const q of quads)
        for (const [xi, yi] of [
          [0, 0],
          [1, 0],
          [0, 1],
          [0, 1],
          [1, 0],
          [1, 1],
        ]) {
          const px = left + q[xi * 2],
            py = top + height - q[1 + yi * 2];
          // RectMask2D clips in the shared canvas space, not in each rotated image's axes.
          const p = matrix.transformPoint({ x: px, y: py });
          vertices.push(
            (p.x / w) * 2 - 1,
            1 - (p.y / h) * 2,
            q[4 + xi * 2],
            q[5 + yi * 2],
            p.x,
            -p.y,
          );
        }
      const material = n.text
        ? ({
            shader: 'alpha',
            constants: Array(84).fill(0),
            color: [1, 1, 1, 1],
            dst: 10,
            textures: [{ name: '_MainTex', key: null, sampler: 0 }],
            name: 'text',
            stencil: n.stencil,
          } as KVMaterial)
        : kvMaterial(kv, n, bindings);
      g.enable(g.BLEND);
      g.blendFunc(g.SRC_ALPHA, material?.dst === 1 ? g.ONE : g.ONE_MINUS_SRC_ALPHA);
      this.submit(
        vertices,
        color,
        material,
        n.text
          ? this.textImages.get(kv)!.get(n.path)!
          : n.sprite!.texture
            ? this.textures.get(n.sprite!.texture)!
            : this.white,
        time,
        clip,
      );
    }
    if (g.getError() !== g.NO_ERROR) throw new Error('动画 CG GPU 绘制失败');
    context.save();
    context.resetTransform();
    context.drawImage(this.canvas, 0, 0);
    context.restore();
    this.frames++;
  }
  dispose() {
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
    this.textures.clear();
    for (const font of this.fonts.values()) releaseFont(font);
    this.fonts.clear();
  }
  sample(
    material: KVMaterial,
    main: string | null,
    time: number,
    color: number[],
    width: number,
    height: number,
    blend: boolean,
    clipped = false,
    vertexColor?: number[],
  ) {
    const g = this.gl;
    this.canvas.width = width;
    this.canvas.height = height;
    g.viewport(0, 0, width, height);
    const target = g.createTexture()!,
      fb = g.createFramebuffer()!;
    g.bindTexture(g.TEXTURE_2D, target);
    g.texImage2D(g.TEXTURE_2D, 0, g.RGBA8, width, height, 0, g.RGBA, g.UNSIGNED_BYTE, null);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.NEAREST);
    g.bindFramebuffer(g.FRAMEBUFFER, fb);
    g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, target, 0);
    g.clearColor(blend ? 0.17 : 0, blend ? 0.23 : 0, blend ? 0.31 : 0, blend ? 1 : 0);
    g.clear(g.COLOR_BUFFER_BIT);
    if (blend) {
      g.enable(g.BLEND);
      g.blendFunc(
        material.shader === 'spine' ? g.ONE : g.SRC_ALPHA,
        material.dst === 1 ? g.ONE : g.ONE_MINUS_SRC_ALPHA,
      );
    } else g.disable(g.BLEND);
    this.submit(
      [-1, -1, 0, 0, -1, -1, 3, -1, 2, 0, 3, -1, -1, 3, 0, 2, -1, 3],
      color,
      material,
      main ? this.textures.get(main)! : this.white,
      time,
      clipped ? { rect: [-0.7, -0.6, 0.8, 0.75], scale: [width / 4, height / 4] } : undefined,
      vertexColor ? [...vertexColor, ...vertexColor, ...vertexColor] : undefined,
    );
    const data = new Uint8Array(width * height * 4);
    g.readPixels(0, 0, width, height, g.RGBA, g.UNSIGNED_BYTE, data);
    g.bindFramebuffer(g.FRAMEBUFFER, null);
    g.deleteFramebuffer(fb);
    g.deleteTexture(target);
    return Array.from(data);
  }
}
