import type { BlurParameters } from './bg-effects';
const vertex =
  'attribute vec2 position;varying vec2 uv;void main(){uv=position*.5+.5;gl_Position=vec4(position,0.,1.);}';
const base = 'precision highp float;varying vec2 uv;uniform sampler2D source;';
const shaders = {
  copy: base + 'void main(){gl_FragColor=vec4(texture2D(source,uv).rgb,1.);}',
  blur:
    base +
    'uniform vec2 delta;void main(){vec4 c=texture2D(source,uv+delta)*.25;c=texture2D(source,uv+delta*vec2(-1.,1.))*.25+c;c=texture2D(source,uv-delta)*.25+c;gl_FragColor=texture2D(source,uv+delta*vec2(1.,-1.))*.25+c;}',
  combine:
    base +
    'uniform sampler2D original;uniform float amount;void main(){gl_FragColor=vec4(mix(texture2D(original,uv).rgb,texture2D(source,uv).rgb,amount),1.);}',
};
type Target = {
  texture: WebGLTexture;
  framebuffer: WebGLFramebuffer;
  width: number;
  height: number;
};
export class BackgroundBlur {
  readonly canvas = document.createElement('canvas');
  private gl: WebGLRenderingContext;
  private programs: Record<string, WebGLProgram>;
  private original: WebGLTexture;
  private targets: Target[] = [];
  constructor() {
    const g = this.canvas.getContext('webgl', {
      alpha: false,
      antialias: false,
      preserveDrawingBuffer: true,
    });
    if (!g) throw new Error('无法创建背景特效渲染器');
    this.gl = g;
    const compile = (type: number, text: string) => {
      const s = g.createShader(type)!;
      g.shaderSource(s, text);
      g.compileShader(s);
      if (!g.getShaderParameter(s, g.COMPILE_STATUS))
        throw new Error(g.getShaderInfoLog(s) ?? 'Background shader failed');
      return s;
    };
    const vs = compile(g.VERTEX_SHADER, vertex);
    this.programs = Object.fromEntries(
      Object.entries(shaders).map(([key, text]) => {
        const p = g.createProgram()!,
          ps = compile(g.FRAGMENT_SHADER, text);
        g.attachShader(p, vs);
        g.attachShader(p, ps);
        g.bindAttribLocation(p, 0, 'position');
        g.linkProgram(p);
        g.deleteShader(ps);
        if (!g.getProgramParameter(p, g.LINK_STATUS))
          throw new Error(g.getProgramInfoLog(p) ?? 'Background shader link failed');
        return [key, p];
      }),
    );
    g.deleteShader(vs);
    const b = g.createBuffer();
    g.bindBuffer(g.ARRAY_BUFFER, b);
    g.bufferData(
      g.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      g.STATIC_DRAW,
    );
    g.enableVertexAttribArray(0);
    g.vertexAttribPointer(0, 2, g.FLOAT, false, 0, 0);
    this.original = this.texture();
    for (let i = 0; i < 2; i++)
      this.targets.push({
        texture: this.texture(),
        framebuffer: g.createFramebuffer()!,
        width: 0,
        height: 0,
      });
  }
  private texture() {
    const g = this.gl,
      t = g.createTexture()!;
    g.bindTexture(g.TEXTURE_2D, t);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
    return t;
  }
  private pass(
    name: keyof typeof shaders,
    input: WebGLTexture,
    target: Target | null,
    w: number,
    h: number,
    delta = [0, 0],
    amount = 1,
  ) {
    const g = this.gl,
      p = this.programs[name];
    g.activeTexture(g.TEXTURE0);
    if (target && (target.width !== w || target.height !== h)) {
      target.width = w;
      target.height = h;
      g.bindTexture(g.TEXTURE_2D, target.texture);
      g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, w, h, 0, g.RGBA, g.UNSIGNED_BYTE, null);
      g.bindFramebuffer(g.FRAMEBUFFER, target.framebuffer);
      g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, target.texture, 0);
    }
    g.bindFramebuffer(g.FRAMEBUFFER, target?.framebuffer ?? null);
    if (target && g.checkFramebufferStatus(g.FRAMEBUFFER) !== g.FRAMEBUFFER_COMPLETE)
      throw new Error('背景特效帧缓冲不完整');
    g.viewport(0, 0, w, h);
    g.useProgram(p);
    g.bindTexture(g.TEXTURE_2D, input);
    g.uniform1i(g.getUniformLocation(p, 'source'), 0);
    g.uniform2fv(g.getUniformLocation(p, 'delta'), delta);
    g.uniform1f(g.getUniformLocation(p, 'amount'), amount);
    if (name === 'combine') {
      g.activeTexture(g.TEXTURE1);
      g.bindTexture(g.TEXTURE_2D, this.original);
      g.uniform1i(g.getUniformLocation(p, 'original'), 1);
    }
    g.drawArrays(g.TRIANGLES, 0, 6);
  }
  draw(scene: HTMLCanvasElement, p: BlurParameters, highResolution = false): HTMLCanvasElement {
    const g = this.gl,
      w = scene.width,
      h = scene.height;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    g.activeTexture(g.TEXTURE0);
    g.bindTexture(g.TEXTURE_2D, this.original);
    g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, 1);
    g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, scene);
    const downscale = p.quality === 0 ? 2 : highResolution ? 2 : 4,
      sw = Math.max(1, Math.trunc(w / downscale)),
      sh = Math.max(1, Math.trunc(h / downscale));
    const strength = Math.max(0, p.degree - 0.2) / 0.8,
      amount = p.degree <= 0.2 ? p.degree / 0.2 : 1;
    this.pass('copy', this.original, this.targets[0], sw, sh);
    let current = 0;
    // HGMobileBlurRenderer.m_spread, verified against metadata's SHA256 field.
    const spreads = [0.5, 1.5, 2.5, 2.5];
    if (strength > 0)
      for (let i = 0; i < (p.mode === 0 ? 1 : 4); i++) {
        let dx = 1 / sw,
          dy = 1 / sh;
        for (const factor of [spreads[i], p.spread, strength]) {
          dx = dx * factor;
          dy = dy * factor;
        }
        const next = 1 - current;
        this.pass('blur', this.targets[current].texture, this.targets[next], sw, sh, [dx, dy]);
        current = next;
      }
    this.pass('combine', this.targets[current].texture, null, w, h, [0, 0], amount);
    if (g.getError() !== g.NO_ERROR) throw new Error('背景特效 GPU 错误');
    return this.canvas;
  }
  dispose() {
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
