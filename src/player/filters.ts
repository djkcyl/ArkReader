export interface FilterState {
  grayscale: number;
  inverse: number;
  chaos: number;
  chaosFrom: string;
  chaosTo: string;
}
interface Color {
  r: number;
  g: number;
  b: number;
  a: number;
}
interface Preset {
  weight: number;
  blurRange: number;
  chaosRange: number;
  maskRadius: number;
  maskSmoothness: number;
  maskCenter: { x: number; y: number };
  chaosColor1: Color;
  chaosColor2: Color;
}
export interface FilterProfile {
  version: string;
  materials: Record<string, { floats: Record<string, number>; vectors: Record<string, Color> }>;
  presets: Record<string, Preset>;
  glitch?: Record<string, import('./character-glitch').GlitchPreset>;
}

const vertex = `attribute vec2 position;varying vec2 uv;void main(){uv=position*.5+.5;gl_Position=vec4(position,0.,1.);}`;
const common = `precision highp float;varying vec2 uv;uniform sampler2D source;uniform vec2 center;uniform float radius,smoothness;
float outsideMask(){float d=length(uv-center)-radius;float t=smoothness==0.?step(0.,d):clamp(d/smoothness,0.,1.);return t*t*(3.-2.*t);}`;
// Independent shader implementations checked against the original DXBC.
const gray =
  common +
  `uniform float amount,inverse;void main(){vec4 c=texture2D(source,uv);c=mix(c,vec4(1.)-c,inverse);float y=dot(c.rgb,vec3(.299,.587,.114));gl_FragColor=vec4(mix(c.rgb,vec3(y),amount),c.a);}`;
const chaos =
  common +
  `uniform float time,phase,weight,intensity,alpha1,alpha2;uniform vec4 offset1,offset2;uniform vec3 color1,color2;
vec2 rotate(vec2 v,float a){return vec2(cos(a)*v.x-sin(a)*v.y,sin(a)*v.x+cos(a)*v.y);}
vec3 brighter(vec3 a,vec3 b){return dot(a,vec3(.299,.587,.114))>dot(b,vec3(.299,.587,.114))?a:b;}
void main(){float w=outsideMask()*weight;vec2 base=uv*offset1.xy;vec3 original=texture2D(source,uv).rgb;
vec3 first=brighter(texture2D(source,base+rotate(offset1.zw,time)*w*intensity).rgb,color1);
vec3 second=brighter(texture2D(source,base+rotate(offset2.zw,-time-phase)*w*intensity).rgb,color2);
gl_FragColor=vec4(mix(mix(original,first,alpha1*w),second,alpha2*w),texture2D(source,uv).a);}`;
const blur =
  common +
  `uniform vec2 stepSize;void main(){vec2 d=stepSize*outsideMask();vec4 c=texture2D(source,uv)*.2270270288;
c+=(texture2D(source,uv+d)+texture2D(source,uv-d))*.1945945919;
c+=(texture2D(source,uv+d*2.)+texture2D(source,uv-d*2.))*.1216216236;
c+=(texture2D(source,uv+d*3.)+texture2D(source,uv-d*3.))*.0540540554;
c+=(texture2D(source,uv+d*4.)+texture2D(source,uv-d*4.))*.0162162166;gl_FragColor=c;}`;

/** Scene-only post processing. Native EFFECT_ORDER is focusout, chaos, grayscale. */
export class SceneFilters {
  readonly canvas = document.createElement('canvas');
  private gl: WebGLRenderingContext;
  private programs: Record<string, WebGLProgram>;
  private input: WebGLTexture;
  private targets: { texture: WebGLTexture; framebuffer: WebGLFramebuffer }[] = [];
  private locations = new Map<WebGLProgram, Map<string, WebGLUniformLocation | null>>();
  constructor(readonly profile: FilterProfile) {
    const gl = this.canvas.getContext('webgl', {
      alpha: false,
      antialias: false,
      premultipliedAlpha: false,
    });
    if (!gl) throw new Error('当前设备未提供剧情滤镜所需的 WebGL');
    this.gl = gl;
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
        throw new Error(gl.getShaderInfoLog(shader) ?? 'Shader failed');
      return shader;
    };
    const vs = compile(gl.VERTEX_SHADER, vertex);
    this.programs = Object.fromEntries(
      Object.entries({ gray, chaos, blur }).map(([name, source]) => {
        const fs = compile(gl.FRAGMENT_SHADER, source),
          p = gl.createProgram()!;
        gl.attachShader(p, vs);
        gl.attachShader(p, fs);
        gl.bindAttribLocation(p, 0, 'position');
        gl.linkProgram(p);
        gl.deleteShader(fs);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS))
          throw new Error(gl.getProgramInfoLog(p) ?? 'Shader link failed');
        return [name, p];
      }),
    );
    gl.deleteShader(vs);
    const vertices = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vertices);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.input = this.texture();
    for (let i = 0; i < 2; i++)
      this.targets.push({ texture: this.texture(), framebuffer: gl.createFramebuffer()! });
  }
  private texture(): WebGLTexture {
    const gl = this.gl,
      t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  private uniform(program: WebGLProgram, key: string, values: number[]): void {
    const gl = this.gl,
      cache = this.locations.get(program) ?? new Map();
    this.locations.set(program, cache);
    if (!cache.has(key)) cache.set(key, gl.getUniformLocation(program, key));
    const loc = cache.get(key)!;
    if (values.length === 1) gl.uniform1f(loc, values[0]);
    else if (values.length === 2) gl.uniform2fv(loc, values);
    else if (values.length === 3) gl.uniform3fv(loc, values);
    else gl.uniform4fv(loc, values);
  }
  draw(scene: HTMLCanvasElement, state: FilterState, time: number): HTMLCanvasElement {
    const gl = this.gl,
      w = scene.width,
      h = scene.height;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      for (const t of this.targets) {
        gl.bindTexture(gl.TEXTURE_2D, t.texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, t.framebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.texture, 0);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
          throw new Error('滤镜帧缓冲不完整');
      }
    }
    gl.viewport(0, 0, w, h);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.input);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, scene);
    let texture = this.input,
      passIndex = 0;
    const pass = (name: string, uniforms: Record<string, number[]>, last: boolean) => {
      const p = this.programs[name],
        target = this.targets[passIndex++ % 2];
      gl.useProgram(p);
      gl.bindFramebuffer(gl.FRAMEBUFFER, last ? null : target.framebuffer);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      for (const [key, v] of Object.entries(uniforms)) this.uniform(p, key, v);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      texture = target.texture;
    };
    const from = this.profile.presets[state.chaosFrom],
      to = this.profile.presets[state.chaosTo];
    const chaosEnabled = state.chaos !== 0 && from && to;
    if (chaosEnabled) {
      const t = Math.max(0, Math.min(1, state.chaos)),
        lerp = (a: number, b: number) => a + (b - a) * t;
      const center = [
          lerp(from.maskCenter.x, to.maskCenter.x),
          lerp(from.maskCenter.y, to.maskCenter.y),
        ],
        mask = {
          center,
          radius: [lerp(from.maskRadius, to.maskRadius)],
          smoothness: [lerp(from.maskSmoothness, to.maskSmoothness)],
        };
      const material = this.profile.materials.mat_chaos,
        vec = (name: string) => {
          const c = material.vectors[name];
          return [c.r, c.g, c.b, c.a];
        };
      const color = (a: Color, b: Color) => [lerp(a.r, b.r), lerp(a.g, b.g), lerp(a.b, b.b)];
      pass(
        'chaos',
        {
          ...mask,
          time: [time],
          phase: [material.floats._Phase],
          weight: [lerp(from.weight, to.weight)],
          intensity: [lerp(from.chaosRange, to.chaosRange)],
          alpha1: [material.floats._ChaosAlpha],
          alpha2: [material.floats._ChaosAlpha2],
          offset1: vec('_ChaosOffset'),
          offset2: vec('_ChaosOffset2'),
          color1: color(from.chaosColor1, to.chaosColor1),
          color2: color(from.chaosColor2, to.chaosColor2),
        },
        false,
      );
      const size = lerp(from.blurRange, to.blurRange);
      pass('blur', { ...mask, stepSize: [size / w, 0] }, false);
      pass(
        'blur',
        { ...mask, stepSize: [0, size / h] },
        state.grayscale === 0 && state.inverse === 0,
      );
    }
    if (!chaosEnabled || state.grayscale !== 0 || state.inverse !== 0)
      pass('gray', { amount: [state.grayscale], inverse: [state.inverse] }, true);
    const error = gl.getError();
    if (error !== gl.NO_ERROR) throw new Error(`滤镜 GPU 错误 ${error}`);
    return this.canvas;
  }
  dispose(): void {
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
