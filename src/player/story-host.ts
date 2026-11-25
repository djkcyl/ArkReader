import type { Command } from '../core/scheduler';
import { nativeBoolean } from '../core/values';

import { pageDestination, type PageDestination } from '../core/story-host-requirements';
export { pageDestination, type PageDestination } from '../core/story-host-requirements';
export interface StoryHostPort {
  /** Requests scene entry; the command does not wait for battle_start. */
  startBattle(request: { stageId: string; isPractice: boolean }): void;
  /** True means the host accepted the route, not that its scene has loaded. */
  gotoPage(request: { destination: PageDestination; zoneId: string; stageId: string }): boolean;
}
export interface HostWait {
  command: 'tutorial' | 'gotopage';
  signal: string;
  abortSignal: string;
}

/** AVG's nonvisual host protocol. This does not implement game/tutorial UI. */
export class StoryHostCommands {
  private pending: (HostWait & { done: () => void }) | null = null;
  constructor(
    private readonly port: StoryHostPort | undefined,
    private readonly abort: () => void,
  ) {}
  get waiting(): HostWait | null {
    const p = this.pending;
    return p ? { command: p.command, signal: p.signal, abortSignal: p.abortSignal } : null;
  }
  execute(command: Command, done: () => void): void {
    const p = command.params;
    if (command.name === 'startbattle') {
      const stageId = String(p.stageId ?? '');
      const isPractice = nativeBoolean(p.isPractice ?? false);
      if (stageId) {
        if (!this.port) throw Error('此剧情需要战斗入口宿主');
        this.port.startBattle({ stageId, isPractice });
      }
      done();
      return;
    }
    if (command.name === 'tutorial') {
      this.pending = {
        command: 'tutorial',
        signal: String(p.waitForSignal ?? ''),
        abortSignal: String(p.abortForSignal ?? ''),
        done,
      };
      return;
    }
    const destination = pageDestination(p.dest);
    if (!destination) {
      done();
      return;
    }
    if (!this.port) throw Error('此剧情需要页面路由宿主');
    const wait: HostWait & { done: () => void } = {
      command: 'gotopage',
      signal: String(p.waitForSignal ?? ''),
      abortSignal: '',
      done,
    };
    // Store before routing: the native callback may receive a synchronous signal.
    this.pending = wait;
    const zoneId = String(p.zoneId ?? ''),
      stageId = String(p.stageId ?? '');
    const accepted = this.port.gotoPage({ destination, zoneId, stageId });
    // RouteToStage is void and always waits when both IDs are supplied. Generic
    // routes wait only after successful dispatch and with a nonempty signal.
    const blocking =
      (destination === 'STAGE' && !!zoneId && !!stageId) || (accepted && !!wait.signal);
    if (!blocking && this.pending === wait) {
      this.pending = null;
      done();
    }
  }
  signal(command: string, signal: string): boolean {
    const p = this.pending;
    if (!p || p.command !== command) return false;
    const match = signal === p.signal || (p.command === 'tutorial' && p.signal === 'any');
    const abort = !match && p.command === 'tutorial' && !!p.abortSignal && signal === p.abortSignal;
    if (!match && !abort) return false;
    this.pending = null;
    p.done();
    if (abort) this.abort();
    return true;
  }
  cancel(): void {
    this.pending = null;
  }
}
