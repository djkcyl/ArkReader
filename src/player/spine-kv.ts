import { spine } from '../vendor/spine38/spine-core.js';
export interface SpineProfile {
  skeleton: any;
  atlases: { text: string; materials: string[] }[];
  scale: number;
  skin: string;
  flipX: boolean;
  flipY: boolean;
  animation: string;
  loop: boolean;
  timeScale: number;
  freeze: boolean;
  clipping: boolean;
  pma: boolean;
  defaultMix: number;
  mixes: [string, string, number][];
}
export interface SpineDraw {
  vertices: number[];
  uv: number[];
  color: number[];
  material: string;
  blend: spine.BlendMode;
}
class AtlasTexture extends spine.Texture {
  readonly material: string;
  constructor(material: string, width: number, height: number) {
    super({ width, height } as HTMLImageElement);
    this.material = material;
  }
  setFilters() {}
  setWraps() {}
  dispose() {}
}
/** SkeletonGraphic's single AnimationState, advanced only while its object is active. */
export class SpineKV {
  readonly skeleton: spine.Skeleton;
  readonly state: spine.AnimationState;
  private clipper = new spine.SkeletonClipping();
  readonly profile: SpineProfile;
  constructor(profile: SpineProfile) {
    this.profile = profile;
    const atlases = profile.atlases.map((a) => {
      let i = 0;
      return new spine.TextureAtlas(a.text, (path: string) => {
        const material = a.materials[i++],
          lines = a.text.split(/\r?\n/),
          at = lines.findIndex((line) => line.trim() === path),
          size = lines[at + 1]?.match(/^size:\s*(\d+)\s*,\s*(\d+)\s*$/);
        if (!material || !size) throw Error('Unbound Spine atlas page dimensions');
        return new AtlasTexture(material, Number(size[1]), Number(size[2]));
      });
    });
    const loader = new spine.AtlasAttachmentLoader({
        findRegion: (name: string) => atlases.map((a) => a.findRegion(name)).find(Boolean),
      } as spine.TextureAtlas),
      reader = new spine.SkeletonJson(loader);
    reader.scale = profile.scale;
    const data = reader.readSkeletonData(profile.skeleton);
    this.skeleton = new spine.Skeleton(data);
    if (profile.skin) this.skeleton.setSkinByName(profile.skin);
    this.skeleton.scaleX = profile.flipX ? -1 : 1;
    this.skeleton.scaleY = profile.flipY ? -1 : 1;
    const stateData = new spine.AnimationStateData(data);
    stateData.defaultMix = profile.defaultMix;
    for (const [from, to, duration] of profile.mixes) stateData.setMix(from, to, duration);
    this.state = new spine.AnimationState(stateData);
    if (profile.animation) this.state.setAnimation(0, profile.animation, profile.loop);
    this.update(0);
  }
  update(dt: number) {
    if (this.profile.freeze) return;
    const delta = Math.max(0, dt) * this.profile.timeScale;
    this.skeleton.update(delta);
    this.state.update(delta);
    this.state.apply(this.skeleton);
    this.skeleton.updateWorldTransform();
  }
  drawables(): SpineDraw[] {
    const result: SpineDraw[] = [],
      clip = this.clipper,
      dark = new spine.Color(0, 0, 0, 1);
    clip.clipEnd();
    for (const slot of this.skeleton.drawOrder) {
      const a = slot.getAttachment();
      if (!a || !slot.bone.active) {
        clip.clipEndWithSlot(slot);
        continue;
      }
      if (a instanceof spine.ClippingAttachment) {
        if (this.profile.clipping) clip.clipStart(slot, a);
        continue;
      }
      let vertices: number[],
        uv: ArrayLike<number>,
        triangles: ArrayLike<number>,
        region: spine.TextureRegion,
        color: spine.Color;
      if (a instanceof spine.MeshAttachment) {
        vertices = Array(a.worldVerticesLength).fill(0);
        a.computeWorldVertices(slot, 0, vertices.length, vertices, 0, 2);
        uv = a.uvs;
        triangles = a.triangles;
        region = a.region;
        color = a.color;
      } else if (a instanceof spine.RegionAttachment) {
        vertices = Array(8).fill(0);
        a.computeWorldVertices(slot.bone, vertices, 0, 2);
        uv = a.uvs;
        triangles = [0, 1, 2, 2, 3, 0];
        region = a.region;
        color = a.color;
      } else {
        clip.clipEndWithSlot(slot);
        continue;
      }
      const c = this.skeleton.color,
        s = slot.color,
        alpha = c.a * s.a * color.a,
        light = new spine.Color(
          c.r * s.r * color.r,
          c.g * s.g * color.g,
          c.b * s.b * color.b,
          alpha,
        );
      if (this.profile.pma) {
        light.r *= alpha;
        light.g *= alpha;
        light.b *= alpha;
        if (slot.data.blendMode === spine.BlendMode.Additive) light.a = 0;
      }
      let positions: number[] = [],
        coords: number[] = [];
      if (clip.isClipping()) {
        clip.clipTriangles(
          vertices,
          vertices.length,
          triangles,
          triangles.length,
          uv,
          light,
          dark,
          false,
        );
        for (const i of clip.clippedTriangles) {
          positions.push(clip.clippedVertices[i * 8], clip.clippedVertices[i * 8 + 1]);
          coords.push(clip.clippedVertices[i * 8 + 6], 1 - clip.clippedVertices[i * 8 + 7]);
        }
      } else
        for (let i = 0; i < triangles.length; i++) {
          const index = triangles[i];
          positions.push(vertices[index * 2], vertices[index * 2 + 1]);
          coords.push(uv[index * 2], 1 - uv[index * 2 + 1]);
        }
      result.push({
        vertices: positions,
        uv: coords,
        color: [light.r, light.g, light.b, light.a],
        material:
          (region as spine.TextureAtlasRegion).texture instanceof AtlasTexture
            ? ((region as spine.TextureAtlasRegion).texture as AtlasTexture).material
            : ((region as spine.TextureAtlasRegion).page.texture as AtlasTexture).material,
        blend: slot.data.blendMode,
      });
      clip.clipEndWithSlot(slot);
    }
    clip.clipEnd();
    return result;
  }
}
