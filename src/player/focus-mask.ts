export interface AlphaLayer {
  main: HTMLImageElement;
  face?: HTMLImageElement;
  red: boolean;
  faceRect?: { x: number; y: number; width: number; height: number };
}
export interface MaskGeometry {
  matrix: DOMMatrix;
  rect: [number, number, number, number];
  uv: [number, number, number, number];
}
const vertex = `attribute vec2 position;uniform mat3 matrix;uniform vec4 rect,uvRect;uniform vec2 viewport;varying vec2 uv;void main(){vec2 p=rect.xy+position*rect.zw;vec3 screen=matrix*vec3(p,1.);gl_Position=vec4(screen.x/viewport.x*2.-1.,1.-screen.y/viewport.y*2.,0.,1.);uv=uvRect.xy+position*uvRect.zw;}`;
const fragment = `precision highp float;varying vec2 uv;uniform sampler2D mainTex,faceTex;uniform float red,useFace,opacity,amount,ghost,soft,rimScale,rimLerp;uniform vec4 faceRect;uniform vec2 mainTexel,faceTexel;
float value(vec4 c){return mix(c.a,c.r,red);}
float alphaAt(vec2 p,vec2 f){bool face=useFace>0.&&f.x>=0.&&f.y>=0.&&f.x<=1.&&f.y<=1.;return face?value(texture2D(faceTex,f)):value(texture2D(mainTex,p));}
void main(){vec2 f=useFace>0.?(uv-faceRect.xy)/faceRect.zw:vec2(-1.);float a=alphaAt(uv,f);
if(ghost>0.){if(soft>0.){float center=a;vec2 m=mainTexel*rimScale,d=faceTexel*rimScale;a=clamp(a+alphaAt(uv+m,f+d)+alphaAt(uv-m,f-d)+alphaAt(uv+m*vec2(-1.,1.),f+d*vec2(-1.,1.))+alphaAt(uv+m*vec2(1.,-1.),f+d*vec2(1.,-1.)),0.,1.);a=mix(center,a,rimLerp);}if(a<.01)discard;gl_FragColor=vec4(1.,1.,1.,a*opacity*amount);}
else {a*=opacity;gl_FragColor=vec4(vec3(1.-a),a);}}`;

/** Stores 1 - the original UI render-target alpha in RGB, with opaque alpha.
 * Normal UI uses SrcAlpha/OneMinusSrcAlpha for alpha too; ghost alpha uses
 * ReverseSubtract One/One and its material writes only the alpha channel.
 */
export class FocusMask {
  readonly canvas = document.createElement('canvas');
  private gl: WebGLRenderingContext;
  private program: WebGLProgram;
  private textures = new Map<HTMLImageElement, WebGLTexture>();
  constructor(
    readonly rimScale = 3,
    readonly rimLerp = 1,
  ) {
    const g = this.canvas.getContext('webgl', {
      alpha: false,
      antialias: false,
      preserveDrawingBuffer: true,
    });
    if (!g) throw new Error('无法创建失焦通道遮罩');
    this.gl = g;
    const compile = (type: number, text: string) => {
      const s = g.createShader(type)!;
      g.shaderSource(s, text);
      g.compileShader(s);
      if (!g.getShaderParameter(s, g.COMPILE_STATUS))
        throw new Error(g.getShaderInfoLog(s) ?? 'Focus mask shader failed');
      return s;
    };
    const vs = compile(g.VERTEX_SHADER, vertex),
      ps = compile(g.FRAGMENT_SHADER, fragment),
      p = g.createProgram()!;
    g.attachShader(p, vs);
    g.attachShader(p, ps);
    g.bindAttribLocation(p, 0, 'position');
    g.linkProgram(p);
    g.deleteShader(vs);
    g.deleteShader(ps);
    if (!g.getProgramParameter(p, g.LINK_STATUS))
      throw new Error(g.getProgramInfoLog(p) ?? 'Focus mask link failed');
    this.program = p;
    g.useProgram(p);
    const b = g.createBuffer();
    g.bindBuffer(g.ARRAY_BUFFER, b);
    g.bufferData(
      g.ARRAY_BUFFER,
      new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]),
      g.STATIC_DRAW,
    );
    g.enableVertexAttribArray(0);
    g.vertexAttribPointer(0, 2, g.FLOAT, false, 0, 0);
    g.enable(g.BLEND);
    g.blendEquation(g.FUNC_ADD);
  }
  begin(w: number, h: number) {
    const g = this.gl;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    g.viewport(0, 0, w, h);
    g.clearColor(0, 0, 0, 1);
    g.clear(g.COLOR_BUFFER_BIT);
    g.useProgram(this.program);
    g.uniform2f(g.getUniformLocation(this.program, 'viewport'), w, h);
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
      g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, 0);
      g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
      g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, image);
      this.textures.set(image, t);
    } else g.bindTexture(g.TEXTURE_2D, t);
    g.uniform1i(g.getUniformLocation(this.program, name), unit);
  }
  draw(
    layer: AlphaLayer,
    geometry: MaskGeometry,
    opacity: number,
    amount: number,
    soft: boolean,
    normal = true,
  ) {
    if (opacity <= 0) return;
    const g = this.gl,
      p = this.program,
      m = geometry.matrix,
      loc = (k: string) => g.getUniformLocation(p, k),
      r = layer.faceRect;
    this.bind(layer.main, 0, 'mainTex');
    this.bind(layer.face ?? layer.main, 1, 'faceTex');
    g.uniformMatrix3fv(
      loc('matrix'),
      false,
      new Float32Array([m.a, m.b, 0, m.c, m.d, 0, m.e, m.f, 1]),
    );
    g.uniform4fv(loc('rect'), geometry.rect);
    g.uniform4fv(loc('uvRect'), geometry.uv);
    g.uniform4fv(loc('faceRect'), r ? [r.x, r.y, r.width, r.height] : [0, 0, 1, 1]);
    g.uniform1f(loc('useFace'), layer.face && r ? 1 : 0);
    g.uniform1f(loc('red'), layer.red ? 1 : 0);
    g.uniform1f(loc('opacity'), Math.max(0, Math.min(1, opacity)));
    g.uniform1f(loc('amount'), amount);
    g.uniform1f(loc('soft'), soft ? 1 : 0);
    g.uniform1f(loc('rimScale'), this.rimScale);
    g.uniform1f(loc('rimLerp'), this.rimLerp);
    g.uniform2f(loc('mainTexel'), 1 / layer.main.width, 1 / layer.main.height);
    g.uniform2f(loc('faceTexel'), 1 / (layer.face?.width ?? 1), 1 / (layer.face?.height ?? 1));
    if (normal) {
      g.uniform1f(loc('ghost'), 0);
      g.blendFuncSeparate(g.SRC_ALPHA, g.ONE_MINUS_SRC_ALPHA, g.ZERO, g.ONE);
      g.drawArrays(g.TRIANGLES, 0, 6);
    }
    if (amount > 0) {
      g.uniform1f(loc('ghost'), 1);
      g.blendFuncSeparate(g.SRC_ALPHA, g.ONE, g.ZERO, g.ONE);
      g.drawArrays(g.TRIANGLES, 0, 6);
    }
    const error = g.getError();
    if (error !== g.NO_ERROR) throw new Error(`失焦遮罩 GPU 错误 ${error}`);
  }
  dispose() {
    this.textures.clear();
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
