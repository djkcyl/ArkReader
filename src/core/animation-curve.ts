export interface StreamKey {
  time: number;
  coefficients: [number, number, number, number];
}
/** Unity StreamedClip words: frame time, key count, then (curve index, c0..c3).
 * A key evaluates c0*dt^3 + c1*dt^2 + c2*dt + c3 until the next key.
 */
export function readStreamedCurves(words: number[], curveCount: number): StreamKey[][] {
  const bytes = new ArrayBuffer(words.length * 4),
    data = new DataView(bytes);
  words.forEach((word, i) => data.setUint32(i * 4, word, true));
  const curves: StreamKey[][] = Array.from({ length: curveCount }, () => []);
  let offset = 0;
  while (offset < data.byteLength) {
    if (offset + 8 > data.byteLength) throw new Error('Truncated native streamed-clip frame');
    const time = data.getFloat32(offset, true),
      count = data.getUint32(offset + 4, true);
    offset += 8;
    if (Number.isNaN(time) || count > (data.byteLength - offset) / 20)
      throw new Error('Invalid native streamed-clip frame');
    for (let n = 0; n < count; n++) {
      const index = data.getUint32(offset, true);
      offset += 4;
      if (index >= curveCount) throw new Error('Native curve binding index out of range');
      const coefficients = Array.from({ length: 4 }, () => {
        const v = data.getFloat32(offset, true);
        offset += 4;
        return v;
      }) as StreamKey['coefficients'];
      if (!coefficients.every(Number.isFinite))
        throw new Error('Invalid native curve coefficients');
      curves[index].push({ time, coefficients });
    }
  }
  return curves;
}
export function sampleStreamedCurve(keys: StreamKey[], time: number): number {
  if (!keys.length) return 0;
  // Serialized key times are float32; compare on the same timeline boundary.
  time = Math.fround(time);
  let key = keys[0];
  for (const next of keys) {
    if (next.time > time) break;
    key = next;
  }
  const [a, b, c, d] = key.coefficients;
  if (key.time < -1e30 || key.time > time) return d;
  const dt = time - key.time;
  return ((a * dt + b) * dt + c) * dt + d;
}
