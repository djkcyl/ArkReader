import type { StoryHostPort, HostWait } from './story-host';

interface SignalReceiver {
  hostCommands: { waiting: HostWait | null };
  receiveHostSignal(command: 'tutorial' | 'gotopage', signal: string): boolean;
}

/** The archive's host: HOME means its library, and battles are explicit
 * narrative boundaries acknowledged by the reader, never simulated gameplay. */
export class StandaloneStoryHost implements StoryHostPort {
  battle: { stageId: string; isPractice: boolean } | null = null;
  homeRequested = false;
  private closed = false;
  startBattle(request: { stageId: string; isPractice: boolean }): void {
    if (!this.closed) this.battle = { ...request };
  }
  gotoPage(request: Parameters<StoryHostPort['gotoPage']>[0]): boolean {
    if (this.closed || request.destination !== 'HOME') return false;
    this.homeRequested = true;
    return true;
  }
  canContinueBattle(player: SignalReceiver): boolean {
    const wait = player.hostCommands.waiting;
    return (
      !this.closed &&
      !!this.battle &&
      wait?.command === 'tutorial' &&
      wait.signal === 'battle_start'
    );
  }
  continueBattle(player: SignalReceiver): boolean {
    if (!this.canContinueBattle(player) || !player.receiveHostSignal('tutorial', 'battle_start'))
      return false;
    this.battle = null;
    return true;
  }
  dispose(): void {
    this.closed = true;
    this.battle = null;
    this.homeRequested = false;
  }
}
