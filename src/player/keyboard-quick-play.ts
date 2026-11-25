import type { StoryPlayer } from './runtime';

/** A temporary hold owns neither the saved touch speed nor the auto preference. */
export class KeyboardQuickPlay {
  private keys = new Set<string>();
  private pressedAt = 0;
  private blocked = false;
  private session?: { player: StoryPlayer; speed: number; auto: boolean };
  get active(): boolean {
    return !!this.session;
  }
  constructor(
    private player: () => StoryPlayer | undefined,
    private eligible: () => boolean,
    private cancelPointer: () => void,
  ) {}
  keydown(event: KeyboardEvent): void {
    if (event.key !== 'Control') {
      if (this.keys.size) {
        this.stop();
        this.blocked = true;
      }
      return;
    }
    if (event.repeat || this.keys.has(event.code)) return;
    if (!this.keys.size) {
      this.pressedAt = performance.now();
      this.blocked =
        event.defaultPrevented ||
        event.isComposing ||
        event.altKey ||
        event.metaKey ||
        !this.eligible() ||
        (event.target instanceof HTMLElement &&
          (event.target.isContentEditable ||
            !!event.target.closest('input,textarea,select,#script-panel')));
    }
    this.keys.add(event.code);
  }
  keyup(event: KeyboardEvent): void {
    if (event.key !== 'Control') return;
    this.keys.delete(event.code);
    if (!this.keys.size) this.cancel();
  }
  update(now: number): void {
    if (!this.keys.size || this.blocked) return;
    if (!this.eligible() || (this.session && this.session.player !== this.player())) {
      this.stop();
      this.blocked = true;
      return;
    }
    // Leave ordinary Ctrl shortcuts untouched before starting a held key.
    if (this.session || now - this.pressedAt < 150) return;
    this.cancelPointer();
    const player = this.player();
    if (!player) return;
    const session = { player, speed: player.quickSpeedIndex, auto: player.auto };
    player.setQuickSpeed(3);
    if (player.beginQuickPlay()) this.session = session;
    else player.setQuickSpeed(session.speed);
  }
  private stop(): void {
    const session = this.session;
    this.session = undefined;
    if (!session) return;
    session.player.endQuickPlay();
    session.player.setQuickSpeed(session.speed);
    if (session.auto && this.eligible()) session.player.setAuto(true);
  }
  cancel(): void {
    this.stop();
    this.keys.clear();
    this.blocked = false;
  }
}
