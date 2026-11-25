export interface FocusConfig {
  blur: boolean;
  color: 'none' | 'grayscale' | 'inverse';
  highResolution: boolean;
}
export function focusTargetSize(w: number, h: number, highResolution = false): [number, number] {
  const max = highResolution ? 960 : 480,
    ratio = Math.min(1, max / w, max / h);
  // Round to valid texture dimensions after fitting within the size limit.
  return [Math.max(1, Math.trunc(w * ratio + 0.5)), Math.max(1, Math.trunc(h * ratio + 0.5))];
}
const vertex =
  'attribute vec2 position;varying vec2 uv;void main(){uv=position*.5+.5;gl_Position=vec4(position,0.,1.);}';
const common = 'precision highp float;varying vec2 uv;uniform sampler2D source;';
const shaders = {
  down:
    common +
    `uniform vec2 texel;void main(){gl_FragColor=(texture2D(source,uv+texel)+texture2D(source,uv-texel*.5)+texture2D(source,uv+texel*vec2(.5,-.5))+texture2D(source,uv+texel*vec2(-.5,.5)))*.25;}`,
  blur:
    common +
    `uniform vec2 delta;void main(){vec4 c=texture2D(source,uv);vec3 rgb=c.rgb*.324;rgb+=(texture2D(source,uv-delta).rgb+texture2D(source,uv+delta).rgb)*.232;rgb+=(texture2D(source,uv-delta*2.).rgb+texture2D(source,uv+delta*2.).rgb)*.0855;rgb+=(texture2D(source,uv-delta*3.).rgb+texture2D(source,uv+delta*3.).rgb)*.0205;gl_FragColor=vec4(rgb,c.a);}`,
  color:
    common +
    `uniform float mode;void main(){vec4 c=texture2D(source,uv);if(mode==1.)c.rgb=vec3(dot(c.rgb,vec3(.299,.587,.114)));if(mode==2.)c=vec4(1.)-c;gl_FragColor=c;}`,
  copy: common + 'void main(){gl_FragColor=texture2D(source,uv);}',
  combine:
    common +
    `uniform sampler2D original,mask;void main(){vec4 a=texture2D(original,uv),b=texture2D(source,uv);float m=texture2D(mask,uv).r;gl_FragColor=vec4(mix(a.rgb,b.rgb,m),a.a);}`,
};
type Target = {
  texture: WebGLTexture;
  framebuffer: WebGLFramebuffer;
  width: number;
  height: number;
};
/** Original MobileBlur passes 0/1/2 and mat_blit_ghost composition.
 * Mask stores 1 - native scene alpha; the native ghost blend subtracts alpha.
 */
export class FocusFilter {
  readonly canvas = document.createElement('canvas');
  private gl: WebGLRenderingContext;
  private programs: Record<string, WebGLProgram>;
  private source: WebGLTexture;
  private mask: WebGLTexture;
  private targets: Target[] = [];
  private blurMaterialCreated = false;
  constructor() {
    const gl = this.canvas.getContext('webgl', {
      alpha: true,
      premultipliedAlpha: false,
      antialias: false,
      preserveDrawingBuffer: true,
    });
    if (!gl) throw new Error('无法创建失焦滤镜');
    this.gl = gl;
    const compile = (type: number, text: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, text);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
        throw new Error(gl.getShaderInfoLog(s) ?? 'Focus shader failed');
      return s;
    };
    const vs = compile(gl.VERTEX_SHADER, vertex);
    this.programs = Object.fromEntries(
      Object.entries(shaders).map(([key, text]) => {
        const ps = compile(gl.FRAGMENT_SHADER, text),
          p = gl.createProgram()!;
        gl.attachShader(p, vs);
        gl.attachShader(p, ps);
        gl.bindAttribLocation(p, 0, 'position');
        gl.linkProgram(p);
        gl.deleteShader(ps);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS))
          throw new Error(gl.getProgramInfoLog(p) ?? 'Focus link failed');
        return [key, p];
      }),
    );
    gl.deleteShader(vs);
    const v = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, v);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.source = this.texture();
    this.mask = this.texture();
    for (let i = 0; i < 2; i++)
      this.targets.push({
        texture: this.texture(),
        framebuffer: gl.createFramebuffer()!,
        width: 0,
        height: 0,
      });
  }
  private texture() {
    const gl = this.gl,
      t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  private upload(t: WebGLTexture, image: HTMLCanvasElement) {
    const g = this.gl;
    g.activeTexture(g.TEXTURE0);
    g.bindTexture(g.TEXTURE_2D, t);
    g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, 1);
    g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, image);
  }
  private target(t: Target, w: number, h: number) {
    const g = this.gl;
    if (t.width !== w || t.height !== h) {
      t.width = w;
      t.height = h;
      g.bindTexture(g.TEXTURE_2D, t.texture);
      g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, w, h, 0, g.RGBA, g.UNSIGNED_BYTE, null);
      g.bindFramebuffer(g.FRAMEBUFFER, t.framebuffer);
      g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, t.texture, 0);
    }
  }
  private pass(
    name: keyof typeof shaders,
    input: WebGLTexture,
    target: Target | null,
    w: number,
    h: number,
    values: Record<string, number[]> = {},
  ) {
    const g = this.gl,
      p = this.programs[name];
    g.activeTexture(g.TEXTURE0);
    if (target) this.target(target, w, h);
    g.bindFramebuffer(g.FRAMEBUFFER, target?.framebuffer ?? null);
    if (target && g.checkFramebufferStatus(g.FRAMEBUFFER) !== g.FRAMEBUFFER_COMPLETE)
      throw new Error('失焦帧缓冲不完整');
    g.viewport(0, 0, w, h);
    g.useProgram(p);
    g.bindTexture(g.TEXTURE_2D, input);
    g.uniform1i(g.getUniformLocation(p, 'source'), 0);
    for (const [key, v] of Object.entries(values)) {
      const l = g.getUniformLocation(p, key);
      if (v.length === 1) g.uniform1f(l, v[0]);
      else g.uniform2fv(l, v);
    }
    if (name === 'combine') {
      g.activeTexture(g.TEXTURE1);
      g.bindTexture(g.TEXTURE_2D, this.source);
      g.uniform1i(g.getUniformLocation(p, 'original'), 1);
      g.activeTexture(g.TEXTURE2);
      g.bindTexture(g.TEXTURE_2D, this.mask);
      g.uniform1i(g.getUniformLocation(p, 'mask'), 2);
    }
    g.drawArrays(g.TRIANGLES, 0, 6);
  }
  draw(scene: HTMLCanvasElement, mask: HTMLCanvasElement, config: FocusConfig): HTMLCanvasElement {
    const w = scene.width,
      h = scene.height;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.upload(this.source, scene);
    this.upload(this.mask, mask);
    let input = this.source,
      n = 0;
    const render = (
      name: keyof typeof shaders,
      width: number,
      height: number,
      values: Record<string, number[]> = {},
    ) => {
      const t = this.targets[n++ % 2];
      this.pass(name, input, t, width, height, values);
      input = t.texture;
    };
    if (config.blur) this.blurMaterialCreated = true;
    const mode = config.color === 'grayscale' ? 1 : config.color === 'inverse' ? 2 : 0;
    if (config.blur || mode === 0) {
      const [sw, sh] = focusTargetSize(w, h, config.highResolution);
      render(this.blurMaterialCreated ? 'down' : 'copy', sw, sh, { texel: [1 / w, 1 / h] });
      if (mode) render('color', sw, sh, { mode: [mode] });
      render(this.blurMaterialCreated ? 'blur' : 'copy', sw, sh, { delta: [0, 1 / sh] });
      render(this.blurMaterialCreated ? 'blur' : 'copy', sw, sh, { delta: [1 / sw, 0] });
    } else render('color', w, h, { mode: [mode] });
    this.pass('combine', input, null, w, h);
    const error = this.gl.getError();
    if (error !== this.gl.NO_ERROR) throw new Error(`失焦 GPU 错误 ${error}`);
    return this.canvas;
  }
  /** Test an individual independent pass against original DXBC output. */
  referencePass(
    scene: HTMLCanvasElement,
    name: 'down' | 'blur',
    w: number,
    h: number,
    values: Record<string, number[]>,
  ): HTMLCanvasElement {
    this.canvas.width = w;
    this.canvas.height = h;
    this.upload(this.source, scene);
    this.pass(name, this.source, null, w, h, values);
    return this.canvas;
  }
  dispose() {
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
