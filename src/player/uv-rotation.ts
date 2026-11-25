import type { ParticleMaterial } from './particles';
export interface UVRotation {
  renderer: string;
  property: string;
  angles: (number | null)[];
}
/** FxUVRotation._CalculateMatrix (GameAssembly 0x5D0C20).
 * Indexed vectors are [cos,-sin,sin,cos], applied about UV (0.5,0.5). */
export function uvRotationMatrix(degrees: number): number[] {
  const angle = degrees * (Math.PI / 180),
    s = Math.sin(angle),
    c = Math.cos(angle);
  return [c, -s, s, c];
}
export class UVRotator {
  private bindings: Map<string, Record<string, number[]>>;
  private outputs = new WeakMap<ParticleMaterial, Map<string, ParticleMaterial>>();
  constructor(definitions: UVRotation[]) {
    this.bindings = new Map(
      definitions.map((d) => [
        d.renderer,
        Object.fromEntries(
          d.angles.map((a, i) => [d.property + i, a === null ? [1, 0, 0, 1] : uvRotationMatrix(a)]),
        ),
      ]),
    );
  }
  material(renderer: string | undefined, source: ParticleMaterial): ParticleMaterial {
    const binding = renderer ? this.bindings.get(renderer) : undefined;
    if (!binding) return source;
    let byRenderer = this.outputs.get(source);
    if (!byRenderer) {
      byRenderer = new Map();
      this.outputs.set(source, byRenderer);
    }
    let out = byRenderer.get(renderer!);
    if (!out) {
      out = { ...source };
      byRenderer.set(renderer!, out);
    }
    out.floats = { ...source.floats, _HG_UV_ROTATION: 1 };
    out.colors = { ...source.colors, ...binding };
    out.textures = source.textures;
    return out;
  }
}
