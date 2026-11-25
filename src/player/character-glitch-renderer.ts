import type { GlitchPreset } from './character-glitch';
export interface GlitchTextures {
  main: HTMLImageElement;
  alpha: HTMLImageElement;
  face?: HTMLImageElement;
  faceAlpha?: HTMLImageElement;
  split: boolean;
  faceRect?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}
export interface GlitchGeometry {
  matrix: DOMMatrix;
  rect: [number, number, number, number];
  uv: [number, number, number, number];
}
const vertex = `attribute vec2 position;uniform mat3 matrix;uniform vec4 rect,uvRect;uniform vec2 viewport;varying vec2 uv;void main(){uv=uvRect.xy+position*uvRect.zw;vec3 p=matrix*vec3(rect.xy+position*rect.zw,1.);gl_Position=vec4(p.x/viewport.x*2.-1.,1.-p.y/viewport.y*2.,0.,1.);}`;
// Torappu/UI/AVG_Char_AlphaSplit, original DXBC PS4. UVs are bottom-up.
const fragment = `precision highp float;varying vec2 uv;
uniform sampler2D mainTex,alphaTex,faceTex,faceAlphaTex;
uniform vec4 faceRect;uniform float hasFace,split,brightness,opacity,blackStart,blackEnd,inverse;
uniform float time,scaledTime,speed,threshold,intensity,lineNum;uniform vec3 maskColor,filterColor,lineColor;
float noise(vec2 p){return fract(sin(dot(p,vec2(17.1299991607666,3.7100000381469727)))*43758.546875);}
void main(){vec2 f=(uv-faceRect.xy)/faceRect.zw;vec4 c=texture2D(mainTex,uv);c.a=mix(c.a,texture2D(alphaTex,uv).r,split);
if(hasFace>0.&&all(greaterThanEqual(f,vec2(0.)))&&all(lessThanEqual(f,vec2(1.)))){c=texture2D(faceTex,f);c.a=mix(c.a,texture2D(faceAlphaTex,f).r,split);}
c*=vec4(vec3(brightness),opacity);if(c.a<.001)discard;
if(blackStart>=0.&&blackStart<blackEnd&&blackEnd<=1.){float m=clamp((blackEnd-uv.y)/(blackEnd-blackStart),0.,1.);if(inverse>.5)m=1.-m;c.rgb*=m;}
float phase=scaledTime*speed,frame=floor(time*speed);
vec2 blue=(uv*vec2(.004694835748523474,.18083181977272034)+phase)*frame;
vec4 rg=uv.xyxy*vec4(-.004694835748523474,.18083181977272034,.004694835748523474,-.18083181977272034);
rg.xy=scaledTime*speed+rg.xy;rg.zw=scaledTime*speed-rg.zw;rg*=frame;
vec3 n=vec3(noise(rg.xy),noise(rg.zw),noise(blue));
float mask=clamp((uv.y-threshold)/(1.-threshold),0.,1.);mask=mask*mask*(3.-2.*mask);
vec3 color=c.rgb*mix(vec3(1.),maskColor,mask)+(n*2.-1.)*intensity*mask;
color=mix(color,color*lineColor,step(.6,fract((uv.y-scaledTime)*lineNum)));
color=1.-(1.-color)*(1.-filterColor);gl_FragColor=vec4(color,c.a);}`;
/** Dedicated original-texture pass; does not tint/quantize a precomposed face. */
export class CharacterGlitchRenderer {
  readonly canvas = document.createElement('canvas');
  readonly gl: WebGLRenderingContext;
  private program: WebGLProgram;
  private textures = new Map<HTMLImageElement, WebGLTexture>();
  constructor() {
    const g = this.canvas.getContext('webgl', {
      alpha: true,
      premultipliedAlpha: false,
      antialias: false,
      preserveDrawingBuffer: true,
    });
    if (!g) throw Error('无法创建立绘故障材质');
    this.gl = g;
    const compile = (type: number, source: string) => {
      const s = g.createShader(type)!;
      g.shaderSource(s, source);
      g.compileShader(s);
      if (!g.getShaderParameter(s, g.COMPILE_STATUS)) throw Error(g.getShaderInfoLog(s)!);
      return s;
    };
    const vs = compile(g.VERTEX_SHADER, vertex),
      fs = compile(g.FRAGMENT_SHADER, fragment),
      p = g.createProgram()!;
    g.attachShader(p, vs);
    g.attachShader(p, fs);
    g.bindAttribLocation(p, 0, 'position');
    g.linkProgram(p);
    g.deleteShader(vs);
    g.deleteShader(fs);
    if (!g.getProgramParameter(p, g.LINK_STATUS)) throw Error(g.getProgramInfoLog(p)!);
    this.program = p;
    g.useProgram(p);
    g.bindBuffer(g.ARRAY_BUFFER, g.createBuffer());
    g.bufferData(
      g.ARRAY_BUFFER,
      new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]),
      g.STATIC_DRAW,
    );
    g.enableVertexAttribArray(0);
    g.vertexAttribPointer(0, 2, g.FLOAT, false, 0, 0);
  }
  private bind(image: HTMLImageElement, unit: number, name: string) {
    const g = this.gl;
    g.activeTexture(g.TEXTURE0 + unit);
    let t = this.textures.get(image);
    if (!t) {
      t = g.createTexture()!;
      g.bindTexture(g.TEXTURE_2D, t);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
      g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, 1);
      g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
      g.pixelStorei(g.UNPACK_COLORSPACE_CONVERSION_WEBGL, g.NONE);
      g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, image);
      this.textures.set(image, t);
    } else g.bindTexture(g.TEXTURE_2D, t);
    g.uniform1i(g.getUniformLocation(this.program, name), unit);
  }
  draw(
    s: GlitchTextures,
    p: GlitchPreset,
    time: number,
    brightness = 1,
    opacity = 1,
    start = 0,
    end = 0,
    inverse = false,
    width = s.main.width,
    height = s.main.height,
    geometry?: GlitchGeometry,
  ): HTMLCanvasElement {
    const g = this.gl,
      loc = (name: string) => g.getUniformLocation(this.program, name);
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    g.viewport(0, 0, width, height);
    g.useProgram(this.program);
    g.clearColor(0, 0, 0, 0);
    g.clear(g.COLOR_BUFFER_BIT);
    const m = geometry?.matrix;
    g.uniformMatrix3fv(
      loc('matrix'),
      false,
      new Float32Array(m ? [m.a, m.b, 0, m.c, m.d, 0, m.e, m.f, 1] : [1, 0, 0, 0, 1, 0, 0, 0, 1]),
    );
    g.uniform2f(loc('viewport'), width, height);
    g.uniform4fv(loc('rect'), geometry?.rect ?? [0, 0, width, height]);
    g.uniform4fv(loc('uvRect'), geometry?.uv ?? [0, 1, 1, -1]);
    this.bind(s.main, 0, 'mainTex');
    this.bind(s.alpha, 1, 'alphaTex');
    this.bind(s.face ?? s.main, 2, 'faceTex');
    this.bind(s.faceAlpha ?? s.alpha, 3, 'faceAlphaTex');
    const r = s.faceRect;
    g.uniform4fv(loc('faceRect'), r ? [r.x, 1 - r.y - r.height, r.width, r.height] : [0, 0, 1, 1]);
    for (const [k, v] of Object.entries({
      hasFace: s.face && r ? 1 : 0,
      split: s.split ? 1 : 0,
      brightness,
      opacity,
      blackStart: start,
      blackEnd: end,
      inverse: inverse ? 1 : 0,
      time,
      scaledTime: time / 20,
      speed: p.glichSpeed,
      threshold: p.glichThreshold,
      intensity: p.glichIntensity,
      lineNum: Math.trunc(p.glichLineNum),
    }))
      g.uniform1f(loc(k), v);
    for (const k of ['maskColor', 'filterColor', 'lineColor'] as const) {
      const c = p[k];
      g.uniform3f(loc(k), c.r, c.g, c.b);
    }
    g.drawArrays(g.TRIANGLES, 0, 6);
    if (g.getError() !== g.NO_ERROR) throw Error('立绘故障材质 GPU 错误');
    return this.canvas;
  }
  dispose() {
    this.textures.clear();
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
