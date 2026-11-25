/** PC Escape is checked by KeyboardTriggerProcessor's pressed edge before
 * virtual-button dispatch. BackPressManager resolves active listeners without
 * requiring EventSystem's selected object to be the background.
 */
export class StoryBackInput {
  private held = false;
  private pending = false;
  constructor(
    private accepts: (event: KeyboardEvent) => boolean,
    private dispatch: () => void,
  ) {
    document.addEventListener(
      'keydown',
      (event) => {
        if (event.code !== 'Escape' && event.key !== 'Escape') return;
        if (
          event.defaultPrevented ||
          event.isComposing ||
          event.ctrlKey ||
          event.altKey ||
          event.metaKey ||
          !this.accepts(event)
        )
          return;
        // Suppress HTMLDialog's independent OS-repeat handling as well. One native
        // press must not dismiss successive layers as focus changes during a hold.
        event.preventDefault();
        event.stopPropagation();
        if (!this.held && !event.repeat) this.pending = true;
        this.held = true;
      },
      true,
    );
    document.addEventListener(
      'keyup',
      (event) => {
        if (event.code === 'Escape' || event.key === 'Escape') this.held = false;
      },
      true,
    );
    window.addEventListener('blur', () => this.clear());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.clear();
    });
  }
  update(): void {
    if (!this.pending) return;
    this.pending = false;
    if (!document.hidden) this.dispatch();
  }
  clear(): void {
    this.held = false;
    this.pending = false;
  }
}
