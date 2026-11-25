export interface EffectPose {
  x: number;
  y: number;
  z?: number;
  flip: number;
  rotation?: {
    x: number;
    y: number;
    z: number;
    w: number;
  };
}
export interface EffectMotionOptions extends EffectPose {
  xto: number;
  yto: number;
  movedelay: number;
  movetime: number;
}
export const defaultEffectMotion: EffectMotionOptions = {
  x: 0,
  y: 0,
  flip: 0,
  xto: -1,
  yto: -1,
  movedelay: 0,
  movetime: 0,
};
/** AVGBattleEffectPanel only moves when BOTH integer targets differ from -1.
 * Its DOLocalMove uses the default OutQuad ease and then SetDelay. */
export function effectPose(options: EffectMotionOptions, age: number): EffectPose {
  let x = options.x,
    y = options.y;
  if (options.xto !== -1 && options.yto !== -1 && age > Math.max(0, options.movedelay)) {
    const t =
        options.movetime <= 0
          ? 1
          : Math.min(1, (age - Math.max(0, options.movedelay)) / options.movetime),
      ease = -t * (t - 2);
    x = x + (options.xto - x) * ease;
    y = y + (options.yto - y) * ease;
  }
  // Native switch handles 1 and 2 individually; 3 is NOT a bitwise both-axis flip.
  const pose: EffectPose = {
    x,
    y,
    flip: options.flip === 1 || options.flip === 2 ? options.flip : 0,
  };
  if (options.rotation) pose.rotation = options.rotation;
  return pose;
}
export function flipRotation(flip: number) {
  return flip === 1
    ? { x: 0, y: 1, z: 0, w: 0 }
    : flip === 2
      ? { x: 1, y: 0, z: 0, w: 0 }
      : { x: 0, y: 0, z: 0, w: 1 };
}
export function euler(degrees: number[]) {
  const [x, y, z] = degrees.map((a) => a * (Math.PI / 180) * 0.5);
  const sx = Math.sin(x),
    cx = Math.cos(x),
    sy = Math.sin(y),
    cy = Math.cos(y),
    sz = Math.sin(z),
    cz = Math.cos(z);
  return {
    x: sx * cy * cz + cx * sy * sz,
    y: cx * sy * cz - sx * cy * sz,
    z: cx * cy * sz - sx * sy * cz,
    w: cx * cy * cz + sx * sy * sz,
  };
}
/** _TryParseRotation adjusts one Euler component before _GenEffect assigns localRotation. */
export function foregroundRotation(x: number, y: number, z: number, flip: number) {
  return euler([flip === 2 ? x + 180 : x, flip === 1 ? y + 180 : y, z]);
}
