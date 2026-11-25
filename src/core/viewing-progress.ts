export interface ViewingProgress {
  percent: number;
  complete: boolean;
  skipped: boolean;
}

/** Script-position estimate, independent of elapsed time, pauses and playback speed.
 * Predicate branches advance normally; explicit user skips leave unread intervals.
 */
export class ViewingProgressTracker {
  private cursor = 0;
  private ranges: [number, number][] = [];
  private ended = false;
  private skipped = false;
  constructor(private total: number) {}
  get snapshot(): [number, number][] {
    return this.ranges.map((r) => [...r]);
  }
  restore(ranges: [number, number][], index: number): void {
    this.ranges = [];
    this.ended = false;
    this.skipped = false;
    for (const [start, end] of ranges) {
      this.cursor = Math.max(0, Math.min(this.total, start));
      this.observe(end);
    }
    this.cursor = Math.max(0, Math.min(this.total, index));
    this.skipped = this.ranges.reduce((n, [a, b]) => n + b - a, 0) < this.cursor;
  }
  observe(index: number): void {
    const end = Math.max(0, Math.min(this.total, index));
    if (end > this.cursor) {
      const ordered = [...this.ranges, [this.cursor, end] as [number, number]].sort(
        (a, b) => a[0] - b[0],
      );
      this.ranges = [];
      for (const range of ordered) {
        const last = this.ranges.at(-1);
        if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
        else this.ranges.push([...range]);
      }
    }
    this.cursor = end;
  }
  jump(index: number): void {
    const target = Math.max(0, Math.min(this.total, index));
    this.skipped ||= target > this.cursor;
    this.cursor = target;
  }
  finish(): void {
    this.observe(this.total);
    this.ended = true;
  }
  get value(): ViewingProgress {
    const seen = this.ranges.reduce((sum, [start, end]) => sum + end - start, 0);
    const complete = this.ended && seen >= this.total;
    return {
      percent: complete
        ? 100
        : Math.min(99, this.total ? Math.floor((seen / this.total) * 100) : 0),
      complete,
      skipped: this.skipped && !complete,
    };
  }
}
