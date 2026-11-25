/** Use analytical prewarm only when modules do not depend on simulation history. */
export function particleSupportsProcedural(
  main: {
    moveWithTransform?: number;
    stopAction?: number;
    subEmitterModuleEnabled?: boolean;
  },
  m: Record<string, any>,
): boolean {
  if (
    main.moveWithTransform !== 0 ||
    main.stopAction ||
    main.subEmitterModuleEnabled ||
    m.EmissionModule.rateOverDistance.scalar !== 0
  )
    return false;
  if (
    [
      'ClampVelocityModule',
      'InheritVelocityModule',
      'NoiseModule',
      'RotationBySpeedModule',
      'CollisionModule',
      'TriggerModule',
    ].some((k) => m[k]?.enabled)
  )
    return false;
  if (m.TrailModule?.enabled && m.TrailModule.mode === 0) return false;
  const initial = m.InitialModule;
  if (
    initial.enabled &&
    (initial.gravityModifier.minMaxState !== 0 || initial.startLifetime.scalar === Infinity)
  )
    return false;
  const shape = m.ShapeModule;
  if (
    shape.enabled &&
    (([4, 8, 10, 17].includes(shape.type) && shape.arc.mode !== 0) ||
      (shape.type === 12 && shape.radius.mode !== 0))
  )
    return false;
  const supports = (c: any) => {
    if (c.minMaxState === 0 || c.minMaxState === 3) return true;
    const valid = (curve: any) => {
      const keys = curve.m_Curve;
      if (!keys.length) return true;
      // Serialized infinity 0/1 map to public PingPong/Loop; 2 is Clamp.
      if (keys[0].time !== 0) {
        if ([0, 1].includes(curve.m_PreInfinity)) return false;
      }
      if (keys.at(-1).time !== 1) {
        if ([0, 1].includes(curve.m_PostInfinity)) return false;
      }
      return true;
    };
    return valid(c.maxCurve) && (c.minMaxState !== 2 || valid(c.minCurve));
  };
  const rotation = m.RotationModule;
  if (
    rotation.enabled &&
    (!supports(rotation.curve) ||
      (rotation.separateAxes && (!supports(rotation.x) || !supports(rotation.y))))
  )
    return false;
  const velocity = m.VelocityModule;
  if (
    velocity.enabled &&
    (['x', 'y', 'z'].some((k) => !supports(velocity[k])) ||
      ['orbitalX', 'orbitalY', 'orbitalZ', 'radial'].some((k) => velocity[k].scalar !== 0))
  )
    return false;
  const force = m.ForceModule;
  if (
    force.enabled &&
    (force.randomizePerFrame || ['x', 'y', 'z'].some((k) => !supports(force[k])))
  )
    return false;
  return true;
}
export interface ParticleVisibilityInput {
  mode: number;
  looping: boolean;
  duration: number;
  maxLifetime: number;
  phase: number;
  playState: number;
  culled: boolean;
  culledAt: number;
  now: number;
  stoppedAt: number;
  emissionStopped: boolean;
  particles: number;
  ring: number;
}
export function particleVisibilityResume(c: ParticleVisibilityInput): {
  kind: 'none' | 'resume' | 'finish';
  steps: {
    dt: number;
    emissionStopped: boolean;
  }[];
} {
  if (!c.culled || c.playState !== 1) return { kind: 'none', steps: [] };
  const elapsed = c.now - c.culledAt;
  const alive =
    (c.ring !== 0 && c.particles > 0) ||
    ((c.looping || elapsed + c.phase <= c.maxLifetime + c.duration) &&
      (!c.emissionStopped || c.now - c.stoppedAt <= c.maxLifetime));
  if (!alive) return { kind: 'finish', steps: [] };
  const steps: {
    dt: number;
    emissionStopped: boolean;
  }[] = [];
  // CalculateRequiredCatchupTime converts to float before fmodf for loops.
  const wrap = (seconds: number) => (c.looping ? seconds % c.duration : seconds);
  if (c.mode === 1) {
    if (c.stoppedAt > c.culledAt) {
      const before = wrap(c.stoppedAt - c.culledAt);
      steps.push(
        { dt: before, emissionStopped: false },
        { dt: wrap(elapsed - before), emissionStopped: true },
      );
    } else if (elapsed > 0) steps.push({ dt: wrap(elapsed), emissionStopped: c.emissionStopped });
  }
  return { kind: 'resume', steps };
}
