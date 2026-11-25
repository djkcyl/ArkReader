/** Serialized AVGController._quickAutoSpeed and AVGButton/AVGQuickPlay timing. */
export const quickSpeeds = [
  { label: '4×', typeDelay: 0.01, base: 0.2, perChar: 0 },
  { label: '8×', typeDelay: 0.005, base: 0.1, perChar: 0 },
  { label: '16×', typeDelay: 0.0025, base: 0.05, perChar: 0 },
  { label: '32×', typeDelay: 0.00125, base: 0.025, perChar: 0 },
] as const;

export class QuickPress {
  private pointer: number | null = null;
  private pressedAt = 0;
  private countedAt: number | null = null;
  private y = 0;
  active = false;
  side: 'left' | 'right' = 'right';
  constructor(
    private readonly start: () => boolean,
    private readonly stop: () => void,
    private readonly drag: (direction: number) => void,
  ) {}
  down(pointer: number, x: number, y: number, width: number, now: number): void {
    if (this.pointer !== null) return;
    this.pointer = pointer;
    this.pressedAt = now;
    this.countedAt = null;
    this.y = y;
    this.side = x < width / 2 ? 'right' : 'left';
  }
  update(now: number, eligible: boolean): void {
    if (this.pointer === null) return;
    if (!eligible) {
      this.cancel();
      return;
    }
    if (this.countedAt === null) {
      if (now - this.pressedAt >= 350) this.countedAt = now;
      return;
    }
    if (!this.active && now - this.countedAt >= 550) this.active = this.start();
  }
  progress(now: number): number {
    return this.countedAt === null ? 0 : Math.min(1, Math.max(0, (now - this.countedAt) / 550));
  }
  get counting(): boolean {
    return this.countedAt !== null && !this.active;
  }
  move(pointer: number, y: number): void {
    if (this.pointer !== pointer || this.countedAt === null) return;
    const delta = this.y - y; // Unity's screen y points up.
    if (Math.abs(delta) < 65) return;
    if (this.active) this.drag(delta > 0 ? 1 : -1);
    this.y = y;
  }
  up(pointer: number): void {
    if (this.pointer === pointer) this.cancel();
  }
  cancel(): void {
    if (this.active) this.stop();
    this.active = false;
    this.pointer = null;
    this.countedAt = null;
  }
}
