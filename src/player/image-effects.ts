import type { NativeParticleProfile } from './native-particles.ts';
import type { ParticleProfile } from './particles.ts';
export const IMAGE_EFFECTS = ['avg_066_screen_distortion', 'avg_doctor_wakeup'];
export type ImageEffectTexture = ParticleProfile['textures'][string];

/** Renderer.material instances only the first slot of the listed mesh renderers.
 * Sprite.texture supplies the entire texture, retaining its native sampler. */
export function bindImageEffect(
  profile: NativeParticleProfile,
  texture: ImageEffectTexture,
): NativeParticleProfile {
  if (!profile.imageBindings) throw Error('图像特效缺少原版网格绑定');
  const key = 'imgfx:' + texture.url,
    materials = { ...profile.materials };
  const meshes = profile.meshes.map((mesh) => {
    if (mesh.materialSlot !== 0 || !profile.imageBindings!.includes(mesh.rendererKey!)) return mesh;
    const source = materials[mesh.material],
      id = mesh.material + ':imgfx:' + mesh.rendererKey;
    if (!source.textures._MainTex) throw Error('图像特效缺少主纹理属性');
    materials[id] = {
      ...source,
      textures: { ...source.textures, _MainTex: { ...source.textures._MainTex, key } },
    };
    return { ...mesh, material: id };
  });
  return { ...profile, materials, meshes, textures: { ...profile.textures, [key]: texture } };
}
