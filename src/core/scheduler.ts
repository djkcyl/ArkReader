import { nativeUnhandledCommands } from './native-unhandled.ts';
/** Executor completion protocol recovered from AVGController.DoExecuteCommands
 * (coroutine MoveNext RVA 0x4180280). This is not a renderer or a complete port.
 */
import { DecisionPredicator } from './decision.ts';

export interface Command {
  name: string;
  text: string | null;
  params: Record<string, unknown>;
  line: number;
}
// AVGGotoLabel.GotoLabelController.PreprocessCommands registers the final
// occurrence of each case-sensitive label. TryGotoLabel resumes after it.
export function labelTargets(commands: Command[]): Map<string, number> {
  const targets = new Map<string, number>();
  commands.forEach((c, i) => {
    if (c.name === 'label' && typeof c.params.name === 'string') targets.set(c.params.name, i + 1);
  });
  return targets;
}
export interface Executor {
  execute(command: Command, finished: () => void): void;
  signal?(signal: Command): void;
  forceEnd?(): void;
  uiInput?: boolean;
}
export interface PostChecker {
  enter(command: Command): void;
  exit(command: Command): void;
}

export class Scheduler {
  readonly predicator = new DecisionPredicator();
  readonly executors = new Map<string, Executor[]>();
  readonly postCheckers = new Map<string, PostChecker[]>();
  readonly blocking: Executor[] = [];
  readonly decisionExecutors: Executor[] = [];
  readonly unknownCommands: Command[] = [];
  index = 0;
  current: Command | null = null;
  currentDecision: Command | null = null;
  waitingForInput = false;
  ended = false;
  yieldAfterCommand?: () => boolean;
  private activeCheckers: PostChecker[] = [];
  private generation = 0;
  private readonly labels: Map<string, number>;
  private pendingGoto: number | null = null;

  constructor(
    readonly commands: Command[],
    readonly strict = true,
    private readonly onUnhandled?: (c: Command) => void,
  ) {
    // PreprocessCommands indexes the whole list, including labels in predicate blocks.
    this.labels = labelTargets(commands);
  }

  warp(name: unknown): number | null {
    const label = typeof name === 'string' ? this.labels.get(name) : undefined;
    if (label === undefined) return null;
    this.pendingGoto = label;
    return this.pendingGoto;
  }

  private advanceIndex(): void {
    this.index = this.pendingGoto ?? this.index + 1;
    this.pendingGoto = null;
  }

  register(name: string, executor: Executor): void {
    const normalized = name.toLowerCase();
    this.executors.set(normalized, [...(this.executors.get(normalized) ?? []), executor]);
  }

  /** Call once per frame. Immediate completions continue in the same frame. */
  tick(): void {
    if (this.ended || this.blocking.length) return;
    if (this.current) {
      for (const checker of this.activeCheckers) checker.exit(this.current);
      this.activeCheckers = [];
      this.waitingForInput = false;
      this.current = null;
      this.advanceIndex();
    }
    const jumps = new Set<number>();
    while (this.index < this.commands.length) {
      const command = this.commands[this.index];
      if (!this.predicator.needToExecute(command.name)) {
        this.index++;
        continue;
      }
      const handlers = this.executors.get(command.name.toLowerCase()) ?? [];
      // AVGController._GetCommandExecutors lowercases the literal name.
      // Its empty-list path advances without invoking an executor or waiting.
      if (!handlers.length && nativeUnhandledCommands.has(command.name.toLowerCase())) {
        this.onUnhandled?.(command);
        this.index++;
        continue;
      }
      if (!handlers.length && this.strict)
        throw new Error(`不支持的剧情指令：${command.name}（第 ${command.line} 行）`);
      if (!handlers.length) {
        this.unknownCommands.push(command);
        this.index++;
        continue;
      }
      this.current = command;
      this.waitingForInput = false;
      if (command.name === 'decision') {
        this.decisionExecutors.length = 0;
        this.currentDecision = command;
      }
      for (const executor of handlers) {
        this.blocking.push(executor);
        this.waitingForInput ||= !!executor.uiInput;
        if (executor.uiInput && command.name === 'decision') this.decisionExecutors.push(executor);
        const generation = this.generation;
        let complete = false;
        executor.execute(command, () => {
          if (complete || generation !== this.generation) return;
          complete = true;
          const i = this.blocking.indexOf(executor);
          if (i !== -1) this.blocking.splice(i, 1);
        });
      }
      this.activeCheckers = this.postCheckers.get(command.name) ?? [];
      for (const checker of this.activeCheckers) checker.enter(command);
      if (this.blocking.length || this.yieldAfterCommand?.()) return;
      for (const checker of this.activeCheckers) checker.exit(command);
      this.activeCheckers = [];
      this.waitingForInput = false;
      this.current = null;
      const origin = this.index,
        backward = this.pendingGoto !== null && this.pendingGoto <= origin;
      this.advanceIndex();
      // Yield only if an immediate loop traverses the same backward edge again.
      // This preserves input responsiveness for malformed cyclic scripts.
      if (backward) {
        if (jumps.has(origin)) return;
        jumps.add(origin);
      }
    }
    this.ended = true;
  }

  resumeAfter(index: number): void {
    // Invalidate completions from the interrupted command before resuming.
    this.generation++;
    this.pendingGoto = null;
    for (const executor of new Set(this.blocking)) executor.forceEnd?.();
    this.blocking.length = 0;
    this.activeCheckers = [];
    this.waitingForInput = false;
    this.current = null;
    this.index = index + 1;
  }

  stop(): void {
    this.generation++;
    this.pendingGoto = null;
    this.ended = true;
    for (const executor of new Set(this.blocking)) executor.forceEnd?.();
    this.blocking.length = 0;
  }
}
