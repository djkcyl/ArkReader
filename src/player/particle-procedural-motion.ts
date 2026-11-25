import { ParticleRandom, type NativeCurve } from './particle-math.ts';
import { integrateParticleCurve, sampleParticleCurve } from './particle-curve.ts';
import { particleLifetimeInverse } from './particle-numeric.ts';
const vector = (matrix: number[], v: number[]) =>
  [0, 1, 2].map((i) => matrix[i] * v[0] + (matrix[i + 4] * v[1] + matrix[i + 8] * v[2]));
export function proceduralParticleRotation(
  module: any,
  percent: number,
  inverseLife: number,
  seed: number,
  direction: number,
): number[] {
  if (!module.enabled) return [0, 0, 0];
  const age = Math.max(0, percent * 0.01),
    life = particleLifetimeInverse(inverseLife),
    random = new ParticleRandom(seed, 'rotation').value(),
    sign = new ParticleRandom(seed, 'rotation-direction').value() > direction ? 1 : -1;
  return (
    module.separateAxes ? [module.x, module.y, module.curve] : [null, null, module.curve]
  ).map((curve) => (curve ? integrateParticleCurve(curve, age, random) * sign * life : 0));
}
/** Original UpdateProcedural motion, after GenerateProcedural and Shape.Start.
 * Qualification restricts this path to local simulation. Velocity replay does
 * not apply speedModifier; the next ordinary step evaluates that separately. */
export function proceduralParticleMotion(input: {
  position: number[];
  velocity: number[];
  elapsed: number;
  percent: number;
  inverseLife: number;
  seed: number;
  modules: Record<string, any>;
  inverse: number[];
  scale: number[];
}) {
  const { modules: m, seed, inverseLife } = input,
    age = Math.max(0, input.percent * 0.01),
    elapsed = input.elapsed,
    life = particleLifetimeInverse(inverseLife);
  const gravity = vector(input.inverse, [0, -9.81 * m.InitialModule.gravityModifier.scalar, 0]);
  const gravityStep = gravity.map((v) => v * elapsed);
  let position = input.position.map(
      (v, j) => 0.5 * elapsed * gravityStep[j] + input.velocity[j] * elapsed + v,
    ),
    velocity = input.velocity.map((v, j) => gravityStep[j] + v),
    animated = [0, 0, 0];
  const inverseScaled = input.inverse.map((v, i) =>
    i % 4 < 3 && i < 12 ? v * input.scale[Math.floor(i / 4)] : v,
  );
  const transform = (module: any, v: number[]) =>
    module.inWorldSpace ? vector(inverseScaled, v) : v;
  for (const kind of ['velocity', 'force'] as const) {
    const module = m[kind === 'velocity' ? 'VelocityModule' : 'ForceModule'];
    if (!module.enabled) continue;
    const curves: NativeCurve[] = [module.x, module.y, module.z];
    const rng = new ParticleRandom(seed, kind),
      random = curves.map(() => rng.value());
    const once = curves.map((c, j) => integrateParticleCurve(c, age, random[j], false));
    if (kind === 'velocity') {
      const displacement = transform(
        module,
        once.map((v) => v / inverseLife),
      );
      position = position.map((v, j) => v + displacement[j]);
      animated = transform(
        module,
        curves.map((c, j) => sampleParticleCurve(c, age, random[j])),
      );
    } else {
      const displacement = transform(
        module,
        curves.map((c, j) => integrateParticleCurve(c, age, random[j], true) * life * life),
      );
      const force = transform(
        module,
        once.map((v) => v * life),
      );
      position = position.map((v, j) => v + displacement[j]);
      velocity = velocity.map((v, j) => v + force[j]);
    }
  }
  return { position, velocity, animated };
}
