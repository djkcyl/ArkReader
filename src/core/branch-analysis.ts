import { labelTargets, type Command } from './scheduler.ts';
import { decisionButtons, parseInt32OrZero } from './decision.ts';

export interface ChoiceStep {
  commandIndex: number;
  line: number;
  option: number;
  value: number;
}
interface State {
  value: number;
  references: number[] | null;
  count: bigint;
  witness: ChoiceStep[];
}
const enabled = (s: State, c: Command) =>
  !s.references?.length ||
  s.value === 0 ||
  c.name === 'predicate' ||
  s.references.includes(s.value);
const key = (s: State) => JSON.stringify([s.value, s.references]);
const references = (c: Command) =>
  c.params.references === undefined
    ? null
    : String(c.params.references).split(';').map(parseInt32OrZero);
const options = (c: Command) =>
  decisionButtons(c.params.options, c.params.values).map((button) => button.value);

export function traceBranchPath(commands: Command[], prefix: ChoiceStep[], complete = false) {
  let state: State = { value: 0, references: null, count: 1n, witness: [] },
    cursor = 0;
  const executedIndices: number[] = [],
    choices: ChoiceStep[] = [];
  const targets = labelTargets(commands),
    backEdges = new Set<string>();
  for (let i = 0; i < commands.length; i++) {
    const c = commands[i];
    if (!enabled(state, c)) continue;
    executedIndices.push(i);
    if (c.name === 'warp' && typeof c.params.name === 'string') {
      const dest = targets.get(c.params.name);
      if (dest !== undefined) {
        if (dest <= i) {
          const edge = JSON.stringify([i, cursor, key(state)]);
          if (backEdges.has(edge)) throw Error('Branch witness cycles on a warp');
          backEdges.add(edge);
        }
        i = dest - 1;
        continue;
      }
    }
    if (c.name === 'predicate') state.references = references(c);
    if (c.name === 'decision') {
      const requested = prefix[cursor],
        values = options(c);
      if (requested && requested.commandIndex !== i)
        throw new Error('Invalid branch witness prefix');
      if (!requested && !complete) throw new Error('Incomplete branch witness');
      const option = requested?.option ?? 0,
        value = values[option];
      if (value === undefined) throw new Error('Invalid branch option');
      if (requested) {
        if (requested.value !== value) throw new Error('Invalid branch witness value');
        cursor++;
      }
      const step = { commandIndex: i, line: c.line, option, value };
      choices.push(step);
      state.value = value;
      state.references = null;
    }
  }
  if (cursor !== prefix.length) throw new Error('Unreachable branch witness suffix');
  return { executedIndices, choices };
}

/** Exact control-state reachability for the implemented Decision/Predicate model.
 * Merging control states does NOT merge visual states or claim full frame equivalence.
 */
export function analyzeBranches(commands: Command[], pathLimit = 4096) {
  let states: State[] = [{ value: 0, references: null, count: 1n, witness: [] }];
  const reachability: {
    commandIndex: number;
    line: number;
    reachable: boolean;
    witness: ChoiceStep[] | null;
  }[] = [];
  const decisionOptions: {
    commandIndex: number;
    line: number;
    option: number;
    value: number;
    witness: ChoiceStep[];
  }[] = [];
  const targets = labelTargets(commands),
    arrivals = new Map<number, State[]>();
  const target = (c: Command) =>
    c.name === 'warp' && typeof c.params.name === 'string' ? targets.get(c.params.name) : undefined;
  const cyclic = commands.some((c, i) => {
    const to = target(c);
    return to !== undefined && to <= i;
  });
  for (const [i, c] of commands.entries()) {
    states.push(...(arrivals.get(i) ?? []));
    const active = states.filter((s) => enabled(s, c));
    reachability.push({
      commandIndex: i,
      line: c.line,
      reachable: !!active.length,
      witness: active[0]?.witness ?? null,
    });
    const next: State[] = [];
    for (const s of states) {
      if (!enabled(s, c)) {
        next.push(s);
        continue;
      }
      const dest = target(c);
      if (dest !== undefined && dest > i + 1) {
        const pending = arrivals.get(dest) ?? [];
        pending.push(s);
        arrivals.set(dest, pending);
        continue;
      }
      if (c.name === 'predicate') next.push({ ...s, references: references(c) });
      else if (c.name === 'decision') {
        for (const [option, value] of options(c).entries()) {
          const step = { commandIndex: i, line: c.line, option, value },
            witness = [...s.witness, step];
          next.push({ value, references: null, count: s.count, witness });
          if (!decisionOptions.some((d) => d.commandIndex === i && d.option === option))
            decisionOptions.push({ ...step, witness });
        }
      } else next.push(s);
    }
    const merged = new Map<string, State>();
    for (const s of next) {
      const k = key(s),
        old = merged.get(k);
      if (old) old.count += s.count;
      else merged.set(k, { ...s });
    }
    states = [...merged.values()];
  }
  states.push(...(arrivals.get(commands.length) ?? []));
  const pathCount = states.reduce((sum, s) => sum + s.count, 0n);
  const paths: ChoiceStep[][] = [];
  if (!cyclic && pathCount <= BigInt(pathLimit)) {
    const stack = [
      { i: 0, state: { value: 0, references: null, count: 1n, witness: [] } as State },
    ];
    while (stack.length) {
      let { i, state } = stack.pop()!;
      for (; i < commands.length; i++) {
        const c = commands[i];
        if (!enabled(state, c)) continue;
        const dest = target(c);
        if (dest !== undefined) {
          i = dest - 1;
          continue;
        }
        if (c.name === 'predicate') state = { ...state, references: references(c) };
        if (c.name === 'decision') {
          const opts = options(c);
          for (let option = opts.length - 1; option >= 0; option--)
            stack.push({
              i: i + 1,
              state: {
                value: opts[option],
                references: null,
                count: 1n,
                witness: [
                  ...state.witness,
                  { commandIndex: i, line: c.line, option, value: opts[option] },
                ],
              },
            });
          break;
        }
      }
      if (i === commands.length) paths.push(state.witness);
    }
  }
  const exhaustive = !cyclic && pathCount <= BigInt(pathLimit);
  if (!exhaustive && !cyclic) {
    const unique = new Map<string, ChoiceStep[]>();
    const seenPrefixes = new Set<string>();
    for (const prefix of [
      ...reachability.filter((r) => r.reachable).map((r) => r.witness!),
      ...decisionOptions.map((r) => r.witness),
    ]) {
      const signature = JSON.stringify(prefix.map((s) => [s.commandIndex, s.option]));
      if (seenPrefixes.has(signature)) continue;
      seenPrefixes.add(signature);
      const path = traceBranchPath(commands, prefix, true).choices;
      unique.set(JSON.stringify(path.map((s) => [s.commandIndex, s.option])), path);
    }
    // Select complete witnesses covering the exact control-state graph. Visual
    // states are NOT merged; each selected witness plays from a fresh player.
    const remaining = new Set([
      ...reachability.filter((r) => r.reachable).map((r) => 'c:' + r.commandIndex),
      ...decisionOptions.map((r) => `q:${r.commandIndex}:${r.option}`),
    ]);
    const candidates = [...unique.values()].map((path) => ({
      path,
      covers: [
        ...traceBranchPath(commands, path).executedIndices.map((i) => 'c:' + i),
        ...path.map((s) => `q:${s.commandIndex}:${s.option}`),
      ],
    }));
    while (remaining.size) {
      let bestIndex = -1,
        bestScore = 0;
      for (const [index, item] of candidates.entries()) {
        let score = 0;
        for (const key of item.covers) if (remaining.has(key)) score++;
        if (score > bestScore) {
          bestScore = score;
          bestIndex = index;
        }
      }
      if (bestIndex < 0) throw new Error('Branch witness coverage incomplete');
      const [best] = candidates.splice(bestIndex, 1);
      paths.push(best.path);
      for (const item of best.covers) remaining.delete(item);
    }
  }
  const otherFlow = commands
    .filter(
      (c, i) =>
        (target(c) ?? Infinity) <= i ||
        [
          'optionbranch',
          'condition',
          'gotolabel',
          'gotostage',
          'gotopage',
          'skiptothis',
          'skipnode',
          'startbattle',
          'end',
          'narration',
        ].includes(c.name),
    )
    .map((c) => ({ line: c.line, command: c.name }));
  return {
    model: 'Decision/Predicate Int32 state',
    otherFlow,
    pathCount: pathCount.toString(),
    pathsEnumerated: paths.length,
    coverageMode: exhaustive ? 'exhaustive-paths' : 'complete-branch-witnesses',
    branchesComplete: otherFlow.length === 0,
    pathsComplete: otherFlow.length === 0 && exhaustive && paths.length === Number(pathCount),
    paths,
    reachability,
    decisionOptions,
  };
}
