import { quickNoticeProfile as P } from './quick-notice-profile';
/** AVGController.get_toastQuickPlay records accepted presses before checking
 * story/mode eligibility. Its DateTime intervals are independent of story time. */
export class QuickClickRecord {
  private first: number | null = null;
  private last = 0;
  private count = 0;
  press(now: number): boolean {
    if (
      this.first === null ||
      now - this.last > P.perClickMs ||
      now - this.first > P.totalClickMs
    ) {
      this.first = this.last = now;
      this.count = 1;
      return false;
    }
    this.last = now;
    if (++this.count < P.clicks) return false;
    this.first = null;
    this.count = 0;
    return true;
  }
}
export interface QuickNoticeRecord {
  id: number;
  button: boolean;
  showAt: number;
  endAt: number;
  hideAt: number | null;
  hideAlpha: number;
  hideY: number;
}
/** One native signature, rejected while in the host's active records. Removed
 * views may still fade while another notification enters. */
export class QuickNotices {
  readonly records: QuickNoticeRecord[] = [];
  private serial = 0;
  add(button: boolean, now: number, animationNow = now): boolean {
    if (this.records.some((r) => r.hideAt === null)) return false;
    const delay = button ? P.initialDelayMs : 0;
    this.records.push({
      id: ++this.serial,
      button,
      showAt: animationNow + delay,
      endAt: now + delay + (button ? P.initialMs : P.rapidMs),
      hideAt: null,
      hideAlpha: 0,
      hideY: P.hideY,
    });
    return true;
  }
  frame(r: QuickNoticeRecord, now: number): { alpha: number; y: number } {
    const t = Math.min(1, Math.max(0, (now - (r.hideAt ?? r.showAt)) / P.fadeMs)),
      ease = t * (2 - t);
    return r.hideAt === null
      ? { alpha: ease, y: P.hideY + (P.showY - P.hideY) * ease }
      : { alpha: r.hideAlpha * (1 - ease), y: r.hideY + (P.hideY - r.hideY) * ease };
  }
  hide(id: number, now: number): boolean {
    const r = this.records.find((r) => r.id === id && r.hideAt === null);
    if (!r) return false;
    const f = this.frame(r, now);
    r.hideAt = now;
    r.hideAlpha = f.alpha;
    r.hideY = f.y;
    return true;
  }
  tick(now: number, animationNow = now): void {
    for (const r of this.records)
      if (r.hideAt === null && now > r.endAt) this.hide(r.id, animationNow);
    for (let i = this.records.length - 1; i >= 0; i--) {
      const r = this.records[i];
      if (r.hideAt !== null && animationNow - r.hideAt >= P.fadeMs) this.records.splice(i, 1);
    }
  }
  clear(): void {
    this.records.length = 0;
  }
}
