import { QuickNotices } from '../core/quick-notice';
import { quickNoticeProfile as P } from '../core/quick-notice-profile';
import './quick-notice.css';
import { NativeSelectableSurface } from './native-selectable';
/** The native account tag knownStoryAcceleration is a local preference here;
 * acknowledging a story hint never contacts the official account server. */
export class QuickNoticeView {
  private readonly model = new QuickNotices();
  private readonly views = new Map<number, HTMLElement>();
  private known = false;
  private selectable: NativeSelectableSurface;
  constructor(private root: HTMLElement) {
    root.className = 'quick-notices';
    root.setAttribute('aria-live', 'polite');
    this.selectable = new NativeSelectableSurface(
      root,
      '.quick-notice-known',
      () => true,
      (el) => [{ element: el.querySelector('span')! }],
    );
    try {
      this.known = localStorage.getItem('arkreader.knownStoryAcceleration') === '1';
    } catch {
      /* Keep state in memory. */
    }
  }
  start(eligible: boolean): void {
    this.clear();
    if (eligible && !this.known) this.model.add(true, Date.now(), performance.now());
  }
  rapidClick(): void {
    this.model.add(false, Date.now(), performance.now());
  }
  clear(): void {
    this.model.clear();
    this.views.clear();
    this.root.replaceChildren();
  }
  update(now = Date.now(), animationNow = performance.now()): void {
    this.model.tick(now, animationNow);
    for (const [id, view] of this.views)
      if (!this.model.records.some((r) => r.id === id)) {
        view.remove();
        this.views.delete(id);
      }
    for (const record of this.model.records) {
      let view = this.views.get(record.id);
      if (!view) {
        view = document.createElement('div');
        view.className = 'quick-notice';
        view.dataset.notice = String(record.id);
        const text = document.createElement('div');
        text.className = 'quick-notice-text';
        text.textContent = P.text;
        view.append(text);
        if (record.button) {
          const button = document.createElement('button');
          button.className = 'quick-notice-known';
          button.setAttribute('aria-label', P.buttonText);
          const label = document.createElement('span');
          label.textContent = P.buttonText;
          button.append(label);
          view.append(button);
          button.onclick = () => {
            if (!this.model.hide(record.id, performance.now())) return;
            this.known = true;
            try {
              localStorage.setItem('arkreader.knownStoryAcceleration', '1');
            } catch {
              /* Keep state in memory. */
            }
          };
        }
        this.views.set(record.id, view);
        this.root.append(view);
      }
      const frame = this.model.frame(record, animationNow);
      view.hidden = animationNow < record.showAt;
      view.style.opacity = String(frame.alpha);
      view.style.top = frame.y / 12.8 + 'cqw';
      view.dataset.phase =
        record.hideAt !== null
          ? 'hide'
          : animationNow < record.showAt
            ? 'delay'
            : frame.alpha < 1
              ? 'show'
              : 'hold';
      view.dataset.button = String(record.button);
      const button = view.querySelector('button');
      if (button) button.disabled = record.hideAt !== null;
    }
    this.selectable.update();
  }
}
