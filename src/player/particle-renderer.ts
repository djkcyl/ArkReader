import { loadImage } from './asset-load';
import { NativeParticles, type NativeParticleProfile, type ParticleDraw } from './native-particles';
import type { ParticleProfile, ParticleMaterial, SignalParticles } from './particles';
import { grabObjectDirection } from './directional-grab';
const isGrab = (m: ParticleMaterial) => m.shader === 'grab' || m.shader === 'directional-grab';
const vertex = `#version 300 es
in vec2 position;in vec2 texcoord;out vec2 uv;
void main(){uv=texcoord;gl_Position=vec4(position,0.,1.);}`;
// Translated from the shipped AlphaBlend and (Ram/)Disturb pixel programs.
// Native custom streams on this prefab are all zero; UV rotations are disabled.
export const particleFragment = `#version 300 es
precision highp float;in vec2 uv;in vec2 mainUV0,disturbUV0,dissolveUV0,extraUV0,weightUV0,grabDirection;in vec4 particleTint;out vec4 frag;
uniform sampler2D mainTex,disturbTex,dissolveTex,extraTex,weightTex,grabTex;
uniform vec2 viewportSize;uniform float grabIntensity;
uniform vec4 grabOptions,grabMaskOptions,grabUVOptions;
uniform vec2 grabNoiseSpeed,grabMaskSpeed,grabUVCenter,grabUVDir;
uniform vec4 mainST,disturbST,dissolveST,extraST,color,uvTween,anchors,custom0,custom1;
uniform vec2 extraIntensity;uniform float secondDisturb,useDissolve,alphaControl,dissolveIntensity,useDissolveTex,customEnabled,weightEnabled,originAlpha,amount2,border2;
uniform vec2 mainSpeed,disturbSpeed,dissolveSpeed,intensity;
uniform vec4 ramChannels;
uniform float time,kind,amount,border,opacity,premultiply,mainInfluence,dissolveInfluence,disturbScale;
vec2 coord(vec4 st,vec2 speed){return uv*st.xy+st.zw+fract(speed*time);}
float evenRound(float x){float a=floor(x),r=x-a;return r<.5?a:r>.5?a+1.:a+mod(a,2.);}
float selectedScalar(vec4 pixel,float channel){
 return channel==0.?pixel.r:channel==1.?pixel.g:channel==2.?pixel.b:pixel.a;
}
vec4 selectedRGBA(vec4 pixel,float channel){
 return channel==0.?pixel:vec4(selectedScalar(pixel,channel-1.));
}
void main(){
 vec4 c;vec4 shadedColor=color*particleTint;
 if(kind==14.){
  float mask=1.;
  if(grabMaskOptions.x>0.){
   vec2 maskUV=uv*extraST.xy+extraST.zw-grabMaskSpeed*time;
   if(grabMaskOptions.z>0.)maskUV=vec2(length(uv-.5)*2.*grabMaskOptions.w-grabMaskSpeed.x*time)+extraST.zw;
   if(customEnabled>.5)maskUV+=grabMaskOptions.z>0.?custom1.xx:custom1.xy;
   float strength=clamp(grabOptions.y*(customEnabled>.5?custom1.z:1.),0.,1.);
   mask=(texture(extraTex,maskUV).r-1.)*strength+1.;
   if(grabMaskOptions.y>0.){frag=vec4(vec3(mask),1.);return;}
  }
  vec2 noiseUV=uv*disturbST.xy+disturbST.zw+fract(grabNoiseSpeed*(time/20.));
  if(customEnabled>.5)noiseUV+=custom0.xy;
  vec4 noise=texture(disturbTex,noiseUV);
  if(grabOptions.z>0.){frag=noise*mask;return;}
  vec2 direction=vec2(1.);
  if(grabOptions.x==1.||grabOptions.x==2.)direction=grabDirection;
  if(grabOptions.x==3.)direction=grabUVDir*-.1;
  if(grabOptions.x==4.)direction=normalize(uv-grabUVCenter)*(2.*grabUVOptions.x-1.)*.1;
  vec2 offset=direction*grabIntensity*noise.r*mask*particleTint.r;
  if(customEnabled>.5)offset*=custom0.zw;
  frag=texture(grabTex,gl_FragCoord.xy/viewportSize+offset*vec2(1.,-1.));return;
 }
 if(kind==13.){
  vec2 offset=texture(disturbTex,disturbUV0).rr*intensity;
  vec4 main=texture(mainTex,mainUV0+offset)*shadedColor*texture(extraTex,extraUV0);
  float mask=texture(dissolveTex,dissolveUV0+offset*dissolveInfluence).r;
  float coverage=clamp((mask-amount+border*(1.-evenRound(amount+.5)))/border,0.,1.);
  float alpha=clamp(coverage*main.a*opacity,0.,1.);
  if(alpha<.001)discard;
  frag=vec4(main.rgb*2.,alpha);return;
 }
 if(kind>11.5){
  vec4 texel=texture(mainTex,uv*mainST.xy+mainST.zw);
  float mask=texture(dissolveTex,uv*dissolveST.xy+dissolveST.zw).r;
  float coverage=clamp((mask-(1.-particleTint.a)+particleTint.a*border)/border,0.,1.);
  frag=vec4(texel.rgb*(particleTint.rgb+particleTint.rgb),clamp(coverage*texel.a*color.a,0.,1.));return;
 }
 if(kind>10.5){frag=vec4(1.,0.,1.,1.);return;}
 if(kind>9.5){vec4 noise=texture(disturbTex,uv*disturbST.xy+disturbST.zw);vec2 offset=noise.rg*noise.a*grabIntensity*particleTint.a;frag=texture(grabTex,gl_FragCoord.xy/viewportSize+vec2(offset.x,-offset.y));return;}
 if(kind>8.5){c=texture(mainTex,uv*mainST.xy+mainST.zw)*(shadedColor+shadedColor);float a=clamp((texture(dissolveTex,uv*dissolveST.xy+dissolveST.zw).r-amount+border*(1.-evenRound(amount+.5)))/border,0.,1.);float b=clamp((texture(extraTex,extraUV0).r-amount2+border2*(1.-evenRound(amount2+.5)))/border2,0.,1.);c.a=clamp(c.a*a*b,0.,1.);frag=c;return;}
 if(kind>7.5){vec2 offset=texture(disturbTex,uv*disturbST.xy+disturbST.zw).rr*intensity;c=texture(mainTex,(uv+offset)*mainST.xy+mainST.zw)*shadedColor*originAlpha;frag=c+c;return;}
 if(kind>6.5){
  c=texture(mainTex,mainUV0)*shadedColor;c.rgb*=2.;float a=c.a*opacity+c.a*opacity;
  float threshold=dissolveIntensity+custom1.x,b=customEnabled>.5?clamp(border+custom1.y,0.,1.):border;
  float d=clamp((texture(dissolveTex,dissolveUV0).r-threshold+b*(1.-evenRound(threshold+.5)))/b,0.,1.);
  c.a=clamp(useDissolveTex*(d*a-a)+a,0.,1.);if(premultiply<1.5)c.rgb=c.rgb*c.a*2.;frag=c;return;
 }
 if(kind>5.5){
  c=texture(mainTex,mainUV0)*(shadedColor+shadedColor);float d=texture(dissolveTex,dissolveUV0).r-amount+border*(1.-evenRound(amount+.5));c.a=clamp(c.a*clamp(d/border,0.,1.),0.,1.);frag=c;return;
 }
 if(kind>4.5){
  vec4 tween=uvTween*time;c=texture(mainTex,fract(uv*mainST.xy+mainST.zw+tween.xy))*(shadedColor+shadedColor);float d=texture(dissolveTex,fract(uv*dissolveST.xy+dissolveST.zw+tween.zw)).r-amount+border*(1.-evenRound(amount+.5));c.a=clamp(c.a*clamp(d/border,0.,1.),0.,1.);frag=c;return;
 }
 if(kind>3.5){
  vec4 tween=fract(uvTween*time);
  vec2 weight=weightEnabled>.5?texture(weightTex,weightUV0).rg:vec2(1.);
  vec2 offset=(texture(disturbTex,disturbUV0+tween.zw).rr-anchors.xz)*weight*intensity;
  if(secondDisturb>.5)offset+=(texture(extraTex,extraUV0).rr-anchors.yw)*weight*extraIntensity;
  vec2 displaced=uv+offset;
  c=texture(mainTex,displaced*mainST.xy+mainST.zw+tween.xy)*shadedColor*2.;c*=alphaControl;
  if(useDissolve>.5){float d=texture(dissolveTex,displaced*dissolveST.xy+dissolveST.zw).r-amount+border*(1.-evenRound(amount+.5));c.a=clamp(c.a*clamp(d/border,0.,1.),0.,1.);}
  frag=c;return;
 }
 if(kind<.5||kind>2.5){c=texture(mainTex,mainUV0)*(shadedColor+shadedColor);c.a=clamp(c.a,0.,1.);}
 else{
  vec4 extra=texture(extraTex,extraUV0);
  vec4 noiseSample=texture(disturbTex,disturbUV0);
  float noise=kind==1.?selectedScalar(noiseSample,ramChannels.y):noiseSample.r;
  vec2 displacement=(intensity+custom1.yy)*noise;
  vec2 mainUV=mainUV0,dissolveUV=dissolveUV0;
  if(kind<1.5){mainUV+=displacement*mainInfluence;dissolveUV+=displacement*dissolveInfluence;}
  else{displacement*=extra.rg;mainUV+=displacement*disturbScale;dissolveUV+=displacement*dissolveInfluence;}
  vec4 mainSample=texture(mainTex,mainUV);
  c=(kind==1.?selectedRGBA(mainSample,ramChannels.x):mainSample)*shadedColor;
  if(kind==1.)c*=selectedRGBA(extra,ramChannels.w);
  c.rgb*=2.;float a=c.a*opacity+c.a*opacity;
  float threshold=amount+custom1.x;vec4 dissolveSample=texture(dissolveTex,dissolveUV);float dissolve=(kind==1.?selectedScalar(dissolveSample,ramChannels.z):dissolveSample.r)-threshold+border*(1.-evenRound(threshold+.5));
  c.a=clamp(clamp(dissolve/border,0.,1.)*a,0.,1.);
 }
 if(premultiply<1.5)c.rgb=c.rgb*c.a*2.;
 frag=c;
}`;
const particleVertex = `#version 300 es
in vec2 position;in vec2 texcoord;in vec4 vertexColor;in vec2 projectedGrabDirection;out vec2 uv;out vec4 particleTint;out vec2 grabDirection;
out vec2 mainUV0,disturbUV0,dissolveUV0,extraUV0,weightUV0;
uniform vec4 mainST,disturbST,dissolveST,extraST,weightST,custom0,custom1;
uniform vec2 mainSpeed,disturbSpeed,dissolveSpeed;
uniform float time,kind,uvRotation;uniform vec4 rotation0,rotation1,rotation2,rotation3;
vec2 rotateUV(vec2 value,vec4 matrix){vec2 p=value-.5;return p.x*matrix.xy+p.y*matrix.zw+.5;}
uniform sampler2D vertexNoiseTex,vertexWeightTex;
uniform vec4 vertexNoiseST,vertexWeightST;
uniform vec2 vertexNoiseSpeed,vertexProjection;
uniform vec3 vertexIntensity;
void main(){uv=texcoord;particleTint=vertexColor;grabDirection=projectedGrabDirection;gl_Position=vec4(position,0.,1.);
 if(any(notEqual(vertexIntensity,vec3(0.)))){
  vec2 noiseUV=texcoord*vertexNoiseST.xy+vertexNoiseST.zw+fract(vertexNoiseSpeed*time);
  vec3 noise=textureLod(vertexNoiseTex,noiseUV,0.).rgb-vec3(.5);
  float weight=textureLod(vertexWeightTex,texcoord*vertexWeightST.xy+vertexWeightST.zw,0.).r;
  gl_Position.xy+=noise.xy*weight*vertexIntensity.xy*vertexProjection;
 }
 vec2 mainBase=texcoord*mainST.xy+mainST.zw+custom0.xy,disturbBase=texcoord*disturbST.xy+disturbST.zw+custom1.zw,dissolveBase=texcoord*dissolveST.xy+dissolveST.zw+custom0.zw,extraBase=texcoord*extraST.xy+extraST.zw;
 if(uvRotation>.5&&((kind>.5&&kind<2.5)||(kind>6.5&&kind<7.5))){mainBase=rotateUV(mainBase,rotation0);dissolveBase=rotateUV(dissolveBase,rotation1);extraBase=rotateUV(extraBase,rotation2);disturbBase=rotateUV(disturbBase,rotation3);}
 mainUV0=mainBase+(kind==13.?fract(mainSpeed*time):kind>6.5?mainSpeed*time:kind<.5||kind>2.5?vec2(0.):fract(mainSpeed*time));
 // Anchor uses _UVTween.zw in the fragment stage; its vertex program only applies texture ST.
 disturbUV0=kind==4.?texcoord*disturbST.xy+disturbST.zw:disturbBase+fract(disturbSpeed*time);
 dissolveUV0=dissolveBase+(kind==13.?fract(dissolveSpeed*time):kind>5.5&&kind<6.5?vec2(0.):kind>6.5?dissolveSpeed*time:fract(dissolveSpeed*time));
 extraUV0=extraBase;
 weightUV0=texcoord*weightST.xy+weightST.zw;
}`;
const copyFragment = `#version 300 es
precision highp float;in vec2 uv;uniform sampler2D mainTex;out vec4 frag;void main(){frag=vec4(texture(mainTex,uv).rgb,1.);}`;
export class ParticleRenderer {
  readonly canvas = document.createElement('canvas');
  readonly gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private copy: WebGLProgram;
  private buffer: WebGLBuffer;
  private textures = new Map<string, WebGLTexture>();
  private source: WebGLTexture;
  private white: WebGLTexture;
  private black: WebGLTexture;
  private grab: WebGLTexture;
  private namedGrabs = new Map<string, WebGLTexture>();
  private capturedGrabs = new Set<string>();
  frames = 0;
  drawCalls = 0;
  grabCopies = 0;
  constructor() {
    const g = this.canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      preserveDrawingBuffer: true,
    });
    if (!g) throw new Error('无法创建粒子渲染器');
    this.gl = g;
    const compile = (type: number, code: string) => {
      const s = g.createShader(type)!;
      g.shaderSource(s, code);
      g.compileShader(s);
      if (!g.getShaderParameter(s, g.COMPILE_STATUS)) throw new Error(g.getShaderInfoLog(s)!);
      return s;
    };
    const make = (code: string, vsCode = vertex) => {
      const p = g.createProgram()!,
        vs = compile(g.VERTEX_SHADER, vsCode),
        ps = compile(g.FRAGMENT_SHADER, code);
      g.attachShader(p, vs);
      g.attachShader(p, ps);
      g.bindAttribLocation(p, 0, 'position');
      g.bindAttribLocation(p, 1, 'texcoord');
      g.bindAttribLocation(p, 2, 'vertexColor');
      g.bindAttribLocation(p, 3, 'projectedGrabDirection');
      g.linkProgram(p);
      g.deleteShader(vs);
      g.deleteShader(ps);
      if (!g.getProgramParameter(p, g.LINK_STATUS)) throw new Error(g.getProgramInfoLog(p)!);
      return p;
    };
    this.program = make(particleFragment, particleVertex);
    this.copy = make(copyFragment);
    this.buffer = g.createBuffer()!;
    this.grab = this.newTexture();
    this.source = this.newTexture();
    this.white = this.newTexture(new Uint8Array([255, 255, 255, 255]));
    this.black = this.newTexture(new Uint8Array([0, 0, 0, 255]));
  }
  beginFrame() {
    this.capturedGrabs.clear();
  }
  private newTexture(pixel?: Uint8Array) {
    const g = this.gl,
      t = g.createTexture()!;
    g.bindTexture(g.TEXTURE_2D, t);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
    if (pixel) g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, 1, 1, 0, g.RGBA, g.UNSIGNED_BYTE, pixel);
    return t;
  }
  async load(profile: ParticleProfile | NativeParticleProfile, signal?: AbortSignal) {
    for (const [key, t] of Object.entries(profile.textures))
      if (!this.textures.has(key)) {
        const img = await loadImage(t.url, signal);
        signal?.throwIfAborted();
        if (img.width !== t.width || img.height !== t.height) throw new Error('粒子纹理尺寸不匹配');
        const g = this.gl,
          texture = this.newTexture();
        g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, 1);
        g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, img);
        g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, t.filter ? g.LINEAR : g.NEAREST);
        g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, t.filter ? g.LINEAR : g.NEAREST);
        g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, t.wrapU ? g.CLAMP_TO_EDGE : g.REPEAT);
        g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, t.wrapV ? g.CLAMP_TO_EDGE : g.REPEAT);
        this.textures.set(key, texture);
      }
  }
  private quad(
    x: number,
    y: number,
    w: number,
    h: number,
    flip = false,
    tint: number[] = [1, 1, 1, 1],
  ) {
    const g = this.gl;
    g.disableVertexAttribArray(3);
    g.vertexAttrib2f(3, 0, 0);
    g.disableVertexAttribArray(2);
    g.vertexAttrib4f(2, tint[0], tint[1], tint[2], tint[3]);
    const l = x - w / 2,
      r = x + w / 2,
      b = y - h / 2,
      t = y + h / 2,
      u = flip ? 1 : 0,
      v = 1 - u;
    g.bindBuffer(g.ARRAY_BUFFER, this.buffer);
    g.bufferData(
      g.ARRAY_BUFFER,
      new Float32Array([l, b, u, 0, r, b, v, 0, l, t, u, 1, l, t, u, 1, r, b, v, 0, r, t, v, 1]),
      g.STREAM_DRAW,
    );
    g.enableVertexAttribArray(0);
    g.enableVertexAttribArray(1);
    g.vertexAttribPointer(0, 2, g.FLOAT, false, 16, 0);
    g.vertexAttribPointer(1, 2, g.FLOAT, false, 16, 8);
    g.drawArrays(g.TRIANGLES, 0, 6);
  }
  private material(
    m: ParticleMaterial,
    time: number,
    color: number[],
    custom: number[] = Array(8).fill(0),
  ) {
    const g = this.gl,
      p = this.program;
    g.useProgram(p);
    const loc = (n: string) => g.getUniformLocation(p, n),
      f = m.floats,
      customOn = m.keywords.includes(
        m.shader === 'directional-grab' ? '_CUSTOMDATA_ON' : '_HGCUSTOMVERTEXSTREAM_ON',
      );
    for (const [unit, name, slot] of [
      [0, '_MainTex', 'main'],
      [
        1,
        ['anchor', 'origin', 'grab', 'directional-grab'].includes(m.shader)
          ? '_DisturTex'
          : '_DisturbTex',
        'disturb',
      ],
      [2, m.shader === 'double-dissolve' ? '_DissolveTex_01' : '_DissolveTex', 'dissolve'],
      [
        3,
        m.shader === 'directional-grab'
          ? '_MaskTex'
          : m.shader === 'double-dissolve'
            ? '_DissolveTex_02'
            : m.shader === 'ram' || m.shader === 'ui-ram'
              ? '_RamTex'
              : m.shader === 'anchor'
                ? '_DisturTex_02'
                : '_WeightTex',
        'extra',
      ],
      [4, '_WeightTex', 'weight'],
    ] as const) {
      const t = m.textures[name];
      g.activeTexture(g.TEXTURE0 + unit);
      const texture = t?.key
        ? this.textures.get(t.key)
        : slot === 'disturb' || (m.shader === 'anchor' && slot === 'extra')
          ? this.black
          : this.white;
      if (!texture) throw new Error('粒子纹理未加载：' + t?.key);
      g.bindTexture(g.TEXTURE_2D, texture);
      g.uniform1i(loc(slot + 'Tex'), unit);
      g.uniform4fv(loc(slot + 'ST'), t?.st ?? [1, 1, 0, 0]);
    }
    const vertexDisturb = !!m.vertexDisturb;
    g.uniform3fv(
      loc('vertexIntensity'),
      vertexDisturb ? (m.colors._VertexDisturbIntensity ?? [0, 0, 0]).slice(0, 3) : [0, 0, 0],
    );
    g.uniform2f(loc('vertexNoiseSpeed'), f._VertexDisturbUSpeed ?? 0, f._VertexDisturbVSpeed ?? 0);
    for (const [unit, name, slot] of [
      [6, '_VertexDisturbTex', 'vertexNoise'],
      [7, '_VertexDisturbWeightTex', 'vertexWeight'],
    ] as const) {
      const t = m.textures[name];
      g.activeTexture(g.TEXTURE0 + unit);
      g.bindTexture(g.TEXTURE_2D, t?.key ? this.textures.get(t.key)! : this.white);
      g.uniform1i(loc(slot + 'Tex'), unit);
      g.uniform4fv(loc(slot + 'ST'), t?.st ?? [1, 1, 0, 0]);
    }
    const tint = m.colors[
      [
        'alpha',
        'additive',
        'dissolve',
        'dissolve-static',
        'double-dissolve',
        'vertex-dissolve',
      ].includes(m.shader)
        ? '_TintColor'
        : '_MainColor'
    ] ?? [1, 1, 1, 1];
    g.uniform4fv(
      loc('color'),
      color.map((v, i) => v * tint[i]),
    );
    for (const [name, value] of Object.entries({
      time,
      kind: {
        alpha: 0,
        ram: 1,
        disturb: 2,
        additive: 3,
        anchor: 4,
        dissolve: 5,
        'dissolve-static': 6,
        'dissolve-custom': 7,
        origin: 8,
        'double-dissolve': 9,
        grab: 10,
        'builtin-error': 11,
        'vertex-dissolve': 12,
        'ui-ram': 13,
        'directional-grab': 14,
      }[m.shader],
      amount: m.shader === 'double-dissolve' ? (f._Amount_01 ?? 0) : (f._Amount ?? 0),
      border: m.shader === 'double-dissolve' ? (f._BorderWidth_01 ?? 1) : (f._BorderWidth ?? 1),
      amount2: f._Amount_02 ?? 0,
      border2: f._BorderWidth_02 ?? 1,
      opacity: f._Opacity ?? 1,
      premultiply: m.shader === 'additive' ? 5 : (f._PremultiplyAlpha ?? 5),
      mainInfluence: !!m.vertexDisturb ? 1 : (f._DisturbInfluenceMainUV ?? 1),
      dissolveInfluence: f._DisturbInfluenceDissolveUV ?? 0,
      disturbScale: !!m.disturbScaleEnabled ? (f._DisturbScale ?? 1) : 1,
    }))
      g.uniform1f(loc(name), value);
    g.uniform1i(loc('grabTex'), 5);
    g.uniform2f(loc('viewportSize'), this.canvas.width, this.canvas.height);
    g.uniform1f(loc('grabIntensity'), f._Intensity ?? 0);
    g.uniform4f(loc('grabOptions'), f._DirMode ?? 0, f._MaskIntensity ?? 1, f._ShowNoise ?? 0, 0);
    g.uniform4f(
      loc('grabMaskOptions'),
      f._Mask ?? 0,
      f._ShowMask ?? 0,
      f._PolarCoord ?? 0,
      f._PolarRadius ?? 1,
    );
    g.uniform4f(loc('grabUVOptions'), f._DisturbInvert ?? 0, 0, 0, 0);
    for (const [uniform, property, fallback] of [
      ['grabNoiseSpeed', '_NoiseSpeed', [0, 0]],
      ['grabMaskSpeed', '_MaskSpeed', [0, 0]],
      ['grabUVCenter', '_DisturbCenterUV', [0.5, 0.5]],
      ['grabUVDir', '_DisturbDirUV', [1, 1]],
    ] as const)
      g.uniform2fv(loc(uniform), (m.colors[property] ?? fallback).slice(0, 2));
    g.uniform4fv(
      loc('ramChannels'),
      !!m.vertexDisturb
        ? [0, 0, 0, 0]
        : [
            f._MainTexChannel ?? 0,
            f._DisturbTexChannel ?? 0,
            f._DissolvTexChannel ?? 0,
            f._RamTexChannel ?? 0,
          ],
    );
    g.uniform1f(loc('uvRotation'), f._HG_UV_ROTATION ?? 0);
    for (let i = 0; i < 4; i++)
      g.uniform4fv(loc('rotation' + i), m.colors['_Rotation' + i] ?? [1, 0, 0, 1]);
    g.uniform1f(loc('originAlpha'), m.colors._MainColor?.[3] ?? 1);
    g.uniform1f(loc('weightEnabled'), m.keywords.includes('_WEIGHT_ON') ? 1 : 0);
    g.uniform1f(loc('dissolveIntensity'), f._DissolveIntensity ?? 0);
    g.uniform1f(loc('useDissolveTex'), f._UseDissolveTex ?? 1);
    g.uniform1f(loc('customEnabled'), customOn ? 1 : 0);
    g.uniform4fv(loc('uvTween'), m.colors._UVTween ?? [0, 0, 0, 0]);
    g.uniform4f(
      loc('anchors'),
      f._AnchorU ?? 0,
      f._AnchorU_02 ?? 0,
      f._AnchorV ?? 0,
      f._AnchorV_02 ?? 0,
    );
    g.uniform2f(loc('extraIntensity'), f._IntensityU_02 ?? 0, f._IntensityV_02 ?? 0);
    g.uniform1f(loc('secondDisturb'), f._ToggleUseDisturb2 ?? 0);
    g.uniform1f(loc('useDissolve'), f._ToggleUseDissolve ?? 0);
    g.uniform1f(
      loc('alphaControl'),
      1 + (f._MainColorACtrl ?? 0) * ((m.colors._MainColor?.[3] ?? 1) - 1),
    );
    g.uniform4fv(loc('custom0'), customOn ? custom.slice(0, 4) : [0, 0, 0, 0]);
    g.uniform4fv(loc('custom1'), customOn ? custom.slice(4, 8) : [0, 0, 0, 0]);
    g.uniform2f(loc('mainSpeed'), f._MainUSpeed ?? 0, f._MainVSpeed ?? 0);
    g.uniform2f(loc('disturbSpeed'), f._DisturbUSpeed ?? 0, f._DisturbVSpeed ?? 0);
    g.uniform2f(loc('dissolveSpeed'), f._DissolveUSpeed ?? 0, f._DissolveVSpeed ?? 0);
    g.uniform2f(loc('intensity'), f._IntensityU ?? 0, f._IntensityV ?? 0);
  }
  draw(
    scene: HTMLCanvasElement,
    systems: {
      particles: SignalParticles | NativeParticles;
      layer: number;
      order: number;
      minOrder?: number;
    }[],
    time: number,
    camera: { x: number; y: number },
    range?: { min?: number; max?: number; opaque?: boolean },
  ): HTMLCanvasElement {
    const g = this.gl;
    this.canvas.width = scene.width;
    this.canvas.height = scene.height;
    g.viewport(0, 0, scene.width, scene.height);
    g.disable(g.BLEND);
    g.useProgram(this.copy);
    g.activeTexture(g.TEXTURE0);
    g.bindTexture(g.TEXTURE_2D, this.source);
    g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, 1);
    g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, scene);
    g.uniform1i(g.getUniformLocation(this.copy, 'mainTex'), 0);
    this.quad(0, 0, 2, 2);
    const packets: { draw: ParticleDraw; order: number; instance: number; sequence: number }[] = [];
    for (const system of systems) {
      const sim = system.particles,
        orders =
          sim.profile.renderOrders ??
          [
            ...new Set(
              sim instanceof NativeParticles
                ? [
                    ...sim.profile.nodes.map((n) => n.renderer.m_SortingOrder),
                    ...sim.profile.meshes.map((m) => m.order),
                    ...(sim.profile.standaloneTrails ?? []).map((t) => t.order),
                  ]
                : sim.profile.nodes.map((n) => n.order),
            ),
          ].sort((a, b) => a - b);
      let draws: ParticleDraw[];
      if (sim instanceof NativeParticles) {
        sim.updateVisibility(camera);
        draws = sim.drawables(camera, range?.opaque);
      } else
        draws = [...sim.particles]
          .sort((a, b) => a.node.order - b.node.order)
          .map((p) => {
            const scale = Math.min(1, (p.node.maxSize * 720) / Math.max(p.w, p.h)),
              w = p.w * scale,
              h = p.h * scale,
              l = p.x - w / 2,
              r = p.x + w / 2,
              b = p.y - h / 2,
              t = p.y + h / 2,
              u = p.node.flip ? 1 : 0,
              v = 1 - u;
            return {
              vertices: [l, b, r, b, l, t, l, t, r, b, r, t],
              uv: [u, 0, v, 0, u, 1, u, 1, v, 0, v, 1],
              color: sim.color(p),
              material: sim.profile.materials[p.node.material],
              order: p.node.order,
              depth: p.z,
              custom: Array(8).fill(0),
            };
          });
      draws.forEach((draw, sequence) => {
        if ((draw.material.shader === 'builtin-error') !== !!range?.opaque) return;
        const order =
          sim.profile.kind === 'native-particles-v2' && sim.profile.sortingMode === 'additive'
            ? system.layer * 10 + draw.order
            : 171 + system.layer * 10 + orders.indexOf(draw.order);
        if (
          order < Math.max(system.minOrder ?? -Infinity, range?.min ?? -Infinity) ||
          order > (range?.max ?? Infinity)
        )
          return;
        packets.push({ draw, order, instance: system.order, sequence });
      });
    }
    // Native ShrinkSortingOrders compresses distinct renderer orders, then adds
    // Canvas.sortingOrder + layer*10 - 10. Retired instances can overlap layers.
    if (!packets.length) return scene;
    packets.sort((a, b) => a.order - b.order || a.instance - b.instance || a.sequence - b.sequence);
    let vertices: number[] = [],
      material: ParticleMaterial | null = null,
      custom: number[] = [],
      key = '',
      grabGroup = '';
    const flush = () => {
      if (!material || !vertices.length) return;
      const m = material;
      if (m.shader === 'builtin-error') {
        g.enable(g.CULL_FACE);
        g.frontFace(g.CW);
        g.cullFace(g.BACK);
      } else g.disable(g.CULL_FACE);
      this.material(m, time, [1, 1, 1, 1], custom);
      g.uniform2f(g.getUniformLocation(this.program, 'vertexProjection'), 100 / 640, 100 / 360);
      g.enable(g.BLEND);
      g.blendFuncSeparate(
        m.blend.srcBlend === 1 ? g.ONE : g.SRC_ALPHA,
        m.blend.destBlend === 0 ? g.ZERO : m.blend.destBlend === 1 ? g.ONE : g.ONE_MINUS_SRC_ALPHA,
        m.blend.srcBlendAlpha === 5 ? g.SRC_ALPHA : m.blend.srcBlendAlpha === 1 ? g.ONE : g.ZERO,
        m.blend.destBlendAlpha === 0
          ? g.ZERO
          : m.blend.destBlendAlpha === 1
            ? g.ONE
            : g.ONE_MINUS_SRC_ALPHA,
      );
      g.bindBuffer(g.ARRAY_BUFFER, this.buffer);
      g.bufferData(g.ARRAY_BUFFER, new Float32Array(vertices), g.STREAM_DRAW);
      for (let i = 0; i < 4; i++) g.enableVertexAttribArray(i);
      g.vertexAttribPointer(0, 2, g.FLOAT, false, 40, 0);
      g.vertexAttribPointer(1, 2, g.FLOAT, false, 40, 8);
      g.vertexAttribPointer(2, 4, g.FLOAT, false, 40, 16);
      g.vertexAttribPointer(3, 2, g.FLOAT, false, 40, 32);
      g.drawArrays(g.TRIANGLES, 0, vertices.length / 10);
      this.drawCalls++;
      vertices = [];
    };
    for (const { draw: packet, instance } of packets) {
      if (isGrab(packet.material)) {
        const named = packet.material.grabTexture,
          group = named ? 'named:' + named : instance + ':' + (packet.rendererKey ?? packet.order);
        if (group !== grabGroup) {
          flush();
          g.activeTexture(g.TEXTURE5);
          let texture = this.grab;
          if (named) {
            if (!this.namedGrabs.has(named)) this.namedGrabs.set(named, this.newTexture());
            texture = this.namedGrabs.get(named)!;
          }
          g.bindTexture(g.TEXTURE_2D, texture);
          if (!named || !this.capturedGrabs.has(named)) {
            g.copyTexImage2D(
              g.TEXTURE_2D,
              0,
              g.RGB,
              0,
              0,
              this.canvas.width,
              this.canvas.height,
              0,
            );
            const error = g.getError();
            if (error !== g.NO_ERROR) throw new Error('画面扭曲的输入复制失败：' + error);
            this.grabCopies++;
            if (named) this.capturedGrabs.add(named);
          }
          grabGroup = group;
        }
      } else grabGroup = '';
      const next = packet.custom.join(',');
      if (material !== packet.material || key !== next) {
        flush();
        key = next;
        material = packet.material;
        custom = packet.custom;
      }
      for (let i = 0; i < packet.vertices.length; i += 2)
        vertices.push(
          (packet.vertices[i] + camera.x) / 640,
          (packet.vertices[i + 1] + camera.y) / 360,
          packet.uv[i],
          packet.uv[i + 1],
          ...(packet.colors ? packet.colors.slice(i * 2, i * 2 + 4) : packet.color),
          packet.grabDirections?.[i] ?? 0,
          packet.grabDirections?.[i + 1] ?? 0,
        );
    }
    flush();
    g.disable(g.CULL_FACE);
    g.frontFace(g.CCW);
    if (g.getError() !== g.NO_ERROR) throw new Error('粒子 GPU 渲染失败');
    this.frames++;
    return this.canvas;
  }
  // Same production shader, isolated full-screen geometry for DXBC comparisons.
  sample(
    m: ParticleMaterial,
    time: number,
    color: number[],
    width: number,
    height: number,
    blend = false,
    custom: number[] = Array(8).fill(0),
    scenePixels?: number[],
  ): number[] {
    const g = this.gl;
    this.canvas.width = width;
    this.canvas.height = height;
    g.viewport(0, 0, width, height);
    const target = this.newTexture(),
      fb = g.createFramebuffer()!;
    g.texImage2D(g.TEXTURE_2D, 0, g.RGBA8, width, height, 0, g.RGBA, g.UNSIGNED_BYTE, null);
    g.bindFramebuffer(g.FRAMEBUFFER, fb);
    g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, target, 0);
    g.clearColor(0.17, 0.23, 0.31, 1);
    g.clear(g.COLOR_BUFFER_BIT);
    g.disable(g.BLEND);
    if (blend) {
      g.enable(g.BLEND);
      g.blendFuncSeparate(
        m.blend.srcBlend === 1 ? g.ONE : g.SRC_ALPHA,
        m.blend.destBlend === 0 ? g.ZERO : m.blend.destBlend === 1 ? g.ONE : g.ONE_MINUS_SRC_ALPHA,
        m.blend.srcBlendAlpha === 5 ? g.SRC_ALPHA : m.blend.srcBlendAlpha === 1 ? g.ONE : g.ZERO,
        m.blend.destBlendAlpha === 0
          ? g.ZERO
          : m.blend.destBlendAlpha === 1
            ? g.ONE
            : g.ONE_MINUS_SRC_ALPHA,
      );
    }
    if (isGrab(m)) {
      if (!scenePixels) throw new Error('GrabPass reference needs a source frame');
      g.activeTexture(g.TEXTURE5);
      g.bindTexture(g.TEXTURE_2D, this.grab);
      g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, 0);
      g.texImage2D(
        g.TEXTURE_2D,
        0,
        g.RGBA8,
        width,
        height,
        0,
        g.RGBA,
        g.UNSIGNED_BYTE,
        new Uint8Array(scenePixels),
      );
    }
    this.material(
      m,
      time,
      ['grab', 'directional-grab', 'vertex-dissolve'].includes(m.shader) ? [1, 1, 1, 1] : color,
      custom,
    );
    g.uniform2f(g.getUniformLocation(this.program, 'vertexProjection'), 1, -1);
    if (isGrab(m)) {
      // GrabPass samples in screen coordinates and uses a bottom-up reference frame.
      if (m.shader === 'directional-grab') {
        const data: number[] = [];
        for (const [x, y] of [
          [-1, -1],
          [1, -1],
          [-1, 1],
          [-1, 1],
          [1, -1],
          [1, 1],
        ]) {
          const d = grabObjectDirection([x, y, 0], m);
          data.push(x, y, (x + 1) / 2, (y + 1) / 2, ...color, d[0] * 0.5, -d[1] * 0.5);
        }
        g.bindBuffer(g.ARRAY_BUFFER, this.buffer);
        g.bufferData(g.ARRAY_BUFFER, new Float32Array(data), g.STREAM_DRAW);
        for (let i = 0; i < 4; i++) g.enableVertexAttribArray(i);
        g.vertexAttribPointer(0, 2, g.FLOAT, false, 40, 0);
        g.vertexAttribPointer(1, 2, g.FLOAT, false, 40, 8);
        g.vertexAttribPointer(2, 4, g.FLOAT, false, 40, 16);
        g.vertexAttribPointer(3, 2, g.FLOAT, false, 40, 32);
        g.drawArrays(g.TRIANGLES, 0, 6);
      } else this.quad(0, 0, 2, 2, false, color);
    } else {
      // Match the original reference triangle AND its top-down D3D viewport.
      // The rasterizer's last bit matters on a nearest-filtered texel boundary.
      g.disableVertexAttribArray(3);
      g.vertexAttrib2f(3, 0, 0);
      g.disableVertexAttribArray(2);
      g.vertexAttrib4fv(2, m.shader === 'vertex-dissolve' ? color : [1, 1, 1, 1]);
      g.bindBuffer(g.ARRAY_BUFFER, this.buffer);
      g.bufferData(
        g.ARRAY_BUFFER,
        new Float32Array([-1, 1, 0, 0, -1, -3, 0, 2, 3, 1, 2, 0]),
        g.STREAM_DRAW,
      );
      g.enableVertexAttribArray(0);
      g.enableVertexAttribArray(1);
      g.vertexAttribPointer(0, 2, g.FLOAT, false, 16, 0);
      g.vertexAttribPointer(1, 2, g.FLOAT, false, 16, 8);
      g.drawArrays(g.TRIANGLES, 0, 3);
    }
    const out = new Uint8Array(width * height * 4);
    g.readPixels(0, 0, width, height, g.RGBA, g.UNSIGNED_BYTE, out);
    g.bindFramebuffer(g.FRAMEBUFFER, null);
    g.deleteFramebuffer(fb);
    g.deleteTexture(target);
    if (isGrab(m)) return Array.from(out);
    return Array.from({ length: height }, (_, y) =>
      Array.from(out.subarray((height - 1 - y) * width * 4, (height - y) * width * 4)),
    ).flat();
  }

  dispose() {
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
    this.textures.clear();
  }
}
