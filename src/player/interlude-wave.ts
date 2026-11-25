import { loadImage } from './asset-load';
/** The shipped Torappu/UI/DoubleDissolve VS/PS, without scene transforms.
 * Source pixel math is checked against the original DXBC in batch 18. */
export interface InterludeTexture {
  url: string;
  width: number;
  height: number;
  filter: number;
  wrapU: number;
  wrapV: number;
}
export interface WaveMaterial {
  shader: 'ui-dual-dissolve';
  floats: Record<string, number>;
  colors: Record<string, number[]>;
  textures: Record<string, { texture: string | null; st: number[] }>;
}
export class InterludeWave {
  readonly canvas = document.createElement('canvas');
  readonly gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private buffer: WebGLBuffer;
  private textures = new Map<string, WebGLTexture>();
  constructor() {
    const g = this.canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: false,
      antialias: false,
      preserveDrawingBuffer: true,
    });
    if (!g) throw new Error('无法创建 Interlude 装饰渲染器');
    this.gl = g;
    const compile = (type: number, source: string) => {
      const s = g.createShader(type)!;
      g.shaderSource(s, source);
      g.compileShader(s);
      if (!g.getShaderParameter(s, g.COMPILE_STATUS)) throw new Error(g.getShaderInfoLog(s)!);
      return s;
    };
    const vs = compile(
      g.VERTEX_SHADER,
      `#version 300 es
   in vec2 position;out vec2 uv;void main(){gl_Position=vec4(position,0.,1.);uv=(position+1.)*.5;}`,
    );
    const ps = compile(
      g.FRAGMENT_SHADER,
      `#version 300 es
   precision highp float;in vec2 uv;out vec4 frag;
   uniform sampler2D mainTex,noiseA,noiseB;uniform vec4 tint,vertexColor,stA,stB,speeds,mainConfig;uniform vec2 amount,border;uniform float time;
   float evenRound(float x){float n=floor(x),r=x-n;return r<.5?n:r>.5?n+1.:n+mod(n,2.);}
   void main(){vec4 c=vertexColor*tint;
    float a=amount.x*c.r,b=amount.y*c.g;
    a=a+border.x*(1.-evenRound(a+.5));b=b+border.y*(1.-evenRound(b+.5));
    float da=clamp((texture(noiseA,uv*stA.xy+stA.zw+time*speeds.xy).r-a)/border.x,0.,1.);
    float db=clamp((texture(noiseB,uv*stB.xy+stB.zw+time*speeds.zw).r-b)/border.y,0.,1.);
    vec4 main=texture(mainTex,uv*mainConfig.xy);float alpha=clamp(da*db*main.a,0.,1.)*c.a;
    if(alpha<.001)discard;frag=vec4(main.rgb*tint.rgb,alpha);
   }`,
    );
    const p = g.createProgram()!;
    g.attachShader(p, vs);
    g.attachShader(p, ps);
    g.bindAttribLocation(p, 0, 'position');
    g.linkProgram(p);
    g.deleteShader(vs);
    g.deleteShader(ps);
    if (!g.getProgramParameter(p, g.LINK_STATUS)) throw new Error(g.getProgramInfoLog(p)!);
    this.program = p;
    this.buffer = g.createBuffer()!;
  }
  async load(textures: Record<string, InterludeTexture>, signal?: AbortSignal) {
    for (const [id, t] of Object.entries(textures)) {
      if (this.textures.has(id)) continue;
      const img = await loadImage(t.url, signal);
      signal?.throwIfAborted();
      if (img.width !== t.width || img.height !== t.height)
        throw new Error('Interlude 纹理尺寸不一致');
      const g = this.gl,
        texture = g.createTexture()!;
      g.bindTexture(g.TEXTURE_2D, texture);
      g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, 1);
      g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, img);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, t.filter ? g.LINEAR : g.NEAREST);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, t.filter ? g.LINEAR : g.NEAREST);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, t.wrapU ? g.CLAMP_TO_EDGE : g.REPEAT);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, t.wrapV ? g.CLAMP_TO_EDGE : g.REPEAT);
      this.textures.set(id, texture);
    }
  }
  render(
    m: WaveMaterial,
    main: string,
    time: number,
    width: number,
    height: number,
    color = [1, 1, 1, 1],
    blend = false,
  ) {
    const g = this.gl;
    this.canvas.width = width;
    this.canvas.height = height;
    g.viewport(0, 0, width, height);
    g.disable(g.BLEND);
    g.clearColor(blend ? 0.17 : 0, blend ? 0.23 : 0, blend ? 0.31 : 0, blend ? 1 : 0);
    g.clear(g.COLOR_BUFFER_BIT);
    if (blend) {
      g.enable(g.BLEND);
      g.blendFunc(g.SRC_ALPHA, g.ONE_MINUS_SRC_ALPHA);
    }
    g.useProgram(this.program);
    const loc = (n: string) => g.getUniformLocation(this.program, n);
    for (const [unit, name, key] of [
      [0, 'mainTex', main],
      [1, 'noiseA', m.textures._DissolveMapA.texture!],
      [2, 'noiseB', m.textures._DissolveMapB.texture!],
    ] as const) {
      const texture = this.textures.get(key);
      if (!texture) throw new Error('未加载 Interlude 纹理：' + key);
      g.activeTexture(g.TEXTURE0 + unit);
      g.bindTexture(g.TEXTURE_2D, texture);
      g.uniform1i(loc(name), unit);
    }
    g.uniform4fv(loc('tint'), m.colors._Color);
    g.uniform4fv(loc('vertexColor'), color);
    g.uniform4fv(loc('stA'), m.textures._DissolveMapA.st);
    g.uniform4fv(loc('stB'), m.textures._DissolveMapB.st);
    g.uniform4fv(loc('speeds'), m.colors._DissolveTillingSpeed);
    g.uniform4fv(loc('mainConfig'), m.colors._MainTexConfig);
    g.uniform2f(loc('amount'), m.floats._AmountA, m.floats._AmountB);
    g.uniform2f(loc('border'), m.floats._BorderWidthA, m.floats._BorderWidthB);
    g.uniform1f(loc('time'), time);
    g.bindBuffer(g.ARRAY_BUFFER, this.buffer);
    g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), g.STREAM_DRAW);
    g.enableVertexAttribArray(0);
    g.vertexAttribPointer(0, 2, g.FLOAT, false, 0, 0);
    g.drawArrays(g.TRIANGLES, 0, 3);
    if (g.getError() !== g.NO_ERROR) throw new Error('Interlude 声波 GPU 绘制失败');
    return this.canvas;
  }
  dispose() {
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
    this.textures.clear();
  }
}
