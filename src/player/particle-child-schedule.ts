/** CollectSubEmittersRecursive selects dt before ScheduleUpdateJobsHelper's
 * KeepUpdating wakes the child. Culling removes independent registration; it
 * does not prevent a parent job from updating and re-registering its child.
 * UnityPlayer: AC3060, ACB660, AC8ED0. */
export function particleChildSchedule(playState: number, delta: number, now: number) {
  return {
    delta: playState === 1 ? delta : 0,
    playState: 1 as const,
    emissionStopped: true,
    stoppedAt: now,
    resetPosition: playState !== 1,
    registered: true,
  };
}
