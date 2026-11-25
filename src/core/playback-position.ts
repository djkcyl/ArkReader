export type PlaybackAction =
  | { step: number; kind: 'choice'; index: number }
  | { step: number; kind: 'skip' }
  | { step: number; kind: 'signal'; command: 'tutorial' | 'gotopage'; signal: string };
export interface PlaybackPosition {
  schema: 1;
  script: string;
  index: number;
  step: number;
  percent: number;
  actions: PlaybackAction[];
  seen: [number, number][];
}
/** Content identity, not a game-version constant. Includes script substitutions. */
export function scriptIdentity(script: string, variables: Record<string, unknown>): string {
  const text =
    script +
    '\n' +
    JSON.stringify(Object.entries(variables).sort(([a], [b]) => a.localeCompare(b)));
  let a = 2166136261,
    b = 5381;
  for (let i = 0; i < text.length; i++) {
    a = Math.imul(a ^ text.charCodeAt(i), 16777619);
    b = Math.imul(b, 33) ^ text.charCodeAt(i);
  }
  return `${text.length}:${a >>> 0}:${b >>> 0}`;
}
export function parsePosition(value: unknown): PlaybackPosition | undefined {
  if (!value || typeof value !== 'object') return;
  const p = value as PlaybackPosition;
  const int = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 0;
  if (
    p.schema !== 1 ||
    typeof p.script !== 'string' ||
    p.script.length > 100 ||
    !int(p.index) ||
    !int(p.step) ||
    p.step < 1 ||
    !Number.isFinite(p.percent) ||
    p.percent < 0 ||
    p.percent > 100 ||
    !Array.isArray(p.actions) ||
    p.actions.length > 10000 ||
    !Array.isArray(p.seen) ||
    p.seen.length > 1024
  )
    return;
  let previous = 0;
  for (const a of p.actions) {
    if (!a || !int(a.step) || a.step < previous || a.step > p.step) return;
    previous = a.step;
    if (a.kind === 'choice') {
      if (!int(a.index) || a.index > 2) return;
    } else if (a.kind === 'signal') {
      if (
        !['tutorial', 'gotopage'].includes(a.command) ||
        typeof a.signal !== 'string' ||
        a.signal.length > 200
      )
        return;
    } else if (a.kind !== 'skip') return;
  }
  if (
    p.seen.some(
      (r) => !Array.isArray(r) || r.length !== 2 || !int(r[0]) || !int(r[1]) || r[1] < r[0],
    )
  )
    return;
  return {
    schema: 1,
    script: p.script,
    index: p.index,
    step: p.step,
    percent: p.percent,
    actions: p.actions,
    seen: p.seen,
  };
}
