import { nativeColorUnit } from '../core/color32';
export interface BlockerState {
  r: number;
  g: number;
  b: number;
  a: number;
  style: number;
  flipX: boolean;
  flipY: boolean;
  image: string;
}
export function blockerStyle(value: unknown): number {
  return value === 'slider' ? 1 : value === 'verticalslider' ? 2 : 0;
}
export interface BlockerProfile {
  version: string;
  floats: Record<string, number>;
  mask: { url: string; width: number; height: number };
}
const vertex =
  'attribute vec2 position;varying vec2 uv;void main(){uv=position*.5+.5;gl_Position=vec4(position,0.,1.);}';
const pixel = `precision highp float;varying vec2 uv;uniform sampler2D mask;uniform vec4 color,parameters;uniform vec2 flip;uniform float vertical;
void main(){vec2 p=mix(uv,vec2(1.)-uv,flip);float q=clamp((color.a-.2)*1.25,0.,1.);float start=q*(parameters.w+parameters.x)-parameters.w;float span=mix(parameters.w,mix(parameters.y,parameters.z,vertical),q);vec2 coord=vertical>.5?vec2((p.y-start)/span,p.x):vec2((p.x-start)/span,p.y);gl_FragColor=vec4(color.rgb,clamp(texture2D(mask,coord).a+color.a,0.,1.));}`;
/** Original SlideMask pixel formula, including its additive color-alpha term. */
export class SliderBlocker {
  readonly canvas = document.createElement('canvas');
  private gl: WebGLRenderingContext;
  private program: WebGLProgram;
  constructor(
    readonly profile: BlockerProfile,
    mask: HTMLImageElement,
  ) {
    const g = this.canvas.getContext('webgl', {
      alpha: true,
      premultipliedAlpha: false,
      antialias: false,
      preserveDrawingBuffer: true,
    });
    if (!g) throw new Error('无法创建遮罩转场');
    this.gl = g;
    const compile = (type: number, text: string) => {
      const s = g.createShader(type)!;
      g.shaderSource(s, text);
      g.compileShader(s);
      if (!g.getShaderParameter(s, g.COMPILE_STATUS))
        throw new Error(g.getShaderInfoLog(s) ?? 'Blocker shader failed');
      return s;
    };
    const vs = compile(g.VERTEX_SHADER, vertex),
      ps = compile(g.FRAGMENT_SHADER, pixel),
      p = g.createProgram()!;
    g.attachShader(p, vs);
    g.attachShader(p, ps);
    g.bindAttribLocation(p, 0, 'position');
    g.linkProgram(p);
    g.deleteShader(vs);
    g.deleteShader(ps);
    if (!g.getProgramParameter(p, g.LINK_STATUS))
      throw new Error(g.getProgramInfoLog(p) ?? 'Blocker link failed');
    this.program = p;
    g.useProgram(p);
    const buffer = g.createBuffer();
    g.bindBuffer(g.ARRAY_BUFFER, buffer);
    g.bufferData(
      g.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      g.STATIC_DRAW,
    );
    g.enableVertexAttribArray(0);
    g.vertexAttribPointer(0, 2, g.FLOAT, false, 0, 0);
    const t = g.createTexture();
    g.bindTexture(g.TEXTURE_2D, t);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
    g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, 1);
    g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, mask);
    const f = profile.floats,
      values = [f._Slide, f._Width, f._Height, f._End];
    if (!values.every(Number.isFinite) || f._End <= 0 || f._Width <= 0 || f._Height <= 0)
      throw new Error('不支持的转场材质参数');
    g.uniform4fv(g.getUniformLocation(p, 'parameters'), values);
  }
  draw(state: BlockerState, width: number, height: number): HTMLCanvasElement {
    const g = this.gl,
      p = this.program;
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    g.viewport(0, 0, width, height);
    g.useProgram(p);
    g.uniform4f(
      g.getUniformLocation(p, 'color'),
      nativeColorUnit(state.r),
      nativeColorUnit(state.g),
      nativeColorUnit(state.b),
      nativeColorUnit(state.a),
    );
    g.uniform2f(g.getUniformLocation(p, 'flip'), state.flipX ? 1 : 0, state.flipY ? 1 : 0);
    g.uniform1f(g.getUniformLocation(p, 'vertical'), state.style === 2 ? 1 : 0);
    g.drawArrays(g.TRIANGLES, 0, 6);
    if (g.getError() !== g.NO_ERROR) throw new Error('遮罩转场 GPU 错误');
    return this.canvas;
  }
  dispose() {
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
