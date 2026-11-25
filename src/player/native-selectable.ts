/** Reader prefab Selectable: Disabled > Pressed > Selected > Highlighted.
 * Pointer selection persists after release. Touch release does not leave a
 * synthetic mouse hover. Painting is separate: only m_TargetGraphic is tinted.
 * One delegated surface survives recycled Reader rows without per-row listeners.
 */
type TintTarget = {
  element: HTMLElement;
  pseudo?: string;
};
export class NativeSelectableSurface {
  private hovered: HTMLElement | null = null;
  private pressed = new Map<number, HTMLElement>();
  private submitted = new Set<HTMLElement>();
  private submitJobs: {
    element: HTMLElement;
    elapsed: number;
    last: number;
  }[] = [];
  private submitFrame = 0;
  private animations = new WeakMap<HTMLElement, Map<string, Animation>>();
  private running = new Set<Animation>();
  constructor(
    private root: HTMLElement,
    private selector: string,
    private enabled: () => boolean,
    private targets: (el: HTMLElement) => TintTarget[] = () => [],
    private fadeSeconds = 0.1,
  ) {
    const find = (target: EventTarget | null) =>
      target instanceof Element ? target.closest<HTMLElement>(selector) : null;
    root.addEventListener('native-submit-feedback', (e) => {
      const el = find(e.target);
      if (!el || !this.enabled() || el.matches(':disabled')) return;
      // Button.OnSubmit selects Pressed after invoking onClick; OnFinishSubmit
      // returns to currentSelectionState after ColorBlock.fadeDuration, unscaled.
      this.submitted.add(el);
      this.update();
      const elapsed = (
        e as CustomEvent<{
          delta: number;
        }>
      ).detail.delta;
      if (!this.fadeSeconds) {
        this.submitted.delete(el);
        this.update();
        return;
      }
      this.submitJobs.push({
        element: el,
        elapsed,
        last: (document.timeline.currentTime as number) ?? performance.now(),
      });
      if (!this.submitFrame)
        this.submitFrame = requestAnimationFrame((time) => this.finishSubmits(time));
    });
    root.addEventListener('pointerover', (e) => {
      if (e.pointerType !== 'touch') {
        this.hovered = find(e.target);
        this.update();
      }
    });
    root.addEventListener('pointerout', (e) => {
      if (e.pointerType !== 'touch') {
        const next = find(e.relatedTarget);
        this.hovered = next && root.contains(next) ? next : null;
        this.update();
      }
    });
    root.addEventListener(
      'pointerdown',
      (e) => {
        const el = find(e.target);
        if (e.button !== 0 || !this.enabled() || !el || el.matches(':disabled')) return;
        el.focus({ preventScroll: true });
        this.pressed.set(e.pointerId, el);
        this.update();
      },
      true,
    );
    const release = (e: PointerEvent) => {
      if (this.pressed.delete(e.pointerId)) this.update();
    };
    window.addEventListener('pointerup', release, true);
    window.addEventListener('pointercancel', release, true);
    root.addEventListener('focusin', () => this.update());
    root.addEventListener('focusout', () => queueMicrotask(() => this.update()));
    window.addEventListener('blur', () => {
      this.pressed.clear();
      this.submitted.clear();
      this.hovered = null;
      this.update();
    });
  }
  /** Native OnDisable/InstantClearState: a different prefab must not inherit
   * the outgoing graphic's tint, focus or unfinished color tween. */
  reset(): void {
    for (const animation of this.running) animation.cancel();
    this.running.clear();
    this.animations = new WeakMap();
    this.hovered = null;
    this.pressed.clear();
    this.submitted.clear();
    this.submitJobs = [];
    cancelAnimationFrame(this.submitFrame);
    this.submitFrame = 0;
    for (const el of this.root.querySelectorAll<HTMLElement>(this.selector)) {
      if (document.activeElement === el) el.blur();
      delete el.dataset.nativeState;
    }
  }
  update(): void {
    const enabled = this.enabled();
    if (!enabled) {
      this.pressed.clear();
      this.submitted.clear();
      this.hovered = null;
    }
    for (const el of this.submitted) if (!el.isConnected || el.hidden) this.submitted.delete(el);
    for (const [id, el] of this.pressed) if (!el.isConnected || el.hidden) this.pressed.delete(id);
    for (const el of this.root.querySelectorAll<HTMLElement>(this.selector)) {
      const state =
        !enabled || el.hidden
          ? 'normal'
          : el.matches(':disabled')
            ? 'disabled'
            : this.submitted.has(el) || [...this.pressed.values()].includes(el)
              ? 'pressed'
              : document.activeElement === el
                ? 'selected'
                : this.hovered === el
                  ? 'highlighted'
                  : 'normal';
      if (el.dataset.nativeState === state) continue;
      const initial = el.dataset.nativeState === undefined;
      // Closed, lazily populated dialogs may not have target graphics yet.
      // A window blur still updates their selection state.
      const targets = this.targets(el)
        .filter((target) => target.element instanceof Element)
        .map((target) => {
          const style = getComputedStyle(target.element, target.pseudo);
          return { ...target, from: { filter: style.filter, opacity: style.opacity } };
        });
      el.dataset.nativeState = state;
      for (const { element, pseudo, from } of targets) {
        let animations = this.animations.get(element);
        if (!animations) {
          animations = new Map();
          this.animations.set(element, animations);
        }
        const key = pseudo ?? '',
          previous = animations.get(key);
        if (previous) {
          previous.cancel();
          this.running.delete(previous);
        }
        animations.delete(key);
        const style = getComputedStyle(element, pseudo),
          to = { filter: style.filter, opacity: style.opacity };
        if (
          initial ||
          !enabled ||
          !this.fadeSeconds ||
          (from.filter === to.filter && from.opacity === to.opacity)
        )
          continue;
        // Graphic.CrossFadeColor restarts a full fade from the current color.
        // CSS transitions shorten reversed fades, which is not the native tween.
        const animation = element.animate([from, to], {
          duration: this.fadeSeconds * 1000,
          easing: 'linear',
          pseudoElement: pseudo,
        });
        animations.set(key, animation);
        this.running.add(animation);
        void animation.finished
          .then(() => {
            this.running.delete(animation);
            if (animations!.get(key) === animation) animations!.delete(key);
          })
          .catch(() => {
            this.running.delete(animation);
          });
      }
    }
  }
  private finishSubmits(time: number): void {
    this.submitFrame = 0;
    this.submitJobs = this.submitJobs.filter((job) => {
      if (!this.enabled() || !job.element.isConnected || job.element.hidden) {
        this.submitted.delete(job.element);
        return false;
      }
      // Each OnSubmit starts its own coroutine. An earlier completion restores
      // currentSelectionState even when a later submission is still waiting.
      if (job.elapsed >= this.fadeSeconds) {
        this.submitted.delete(job.element);
        return false;
      }
      job.elapsed = job.elapsed + (time - job.last) / 1000;
      job.last = time;
      return true;
    });
    this.update();
    if (this.submitJobs.length)
      this.submitFrame = requestAnimationFrame((next) => this.finishSubmits(next));
  }
}
