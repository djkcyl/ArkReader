import type { OperationStatus } from './resource-api';
export type LoadingState = Pick<OperationStatus, 'phase' | 'message' | 'done' | 'total'> &
  Partial<OperationStatus>;

/** The backend owns planning/download/conversion; decoding finishes the graph. */
export function loadingProgress(previous: number, state: LoadingState): number {
  let value = state.overallProgress;
  if (state.phase === 'decode')
    value = 0.9 + 0.09 * (state.total ? Math.min(1, state.done / state.total) : 0);
  else if (state.phase === 'seek')
    value = 0.99 + 0.009 * (state.total ? Math.min(1, state.done / state.total) : 0);
  else if (state.phase === 'started') value = 1;
  else if (value === undefined) {
    // Static exports and older servers do not expose aggregate transfer state.
    const spans: Record<string, [number, number]> = {
      queue: [0, 0],
      compatibility: [0.01, 0.02],
      ui: [0.02, 0.12],
      resources: [0.12, 0.16],
      download: [0.16, 0.7],
      convert: [0.7, 0.88],
      verify: [0.88, 0.9],
      ready: [0.9, 0.9],
    };
    const [start, end] = spans[state.phase] ?? [0, 0];
    value = start + (end - start) * (state.total ? Math.min(1, state.done / state.total) : 0);
  }
  return Math.max(previous, Math.max(0, Math.min(1, Number.isFinite(value) ? value! : 0)));
}
