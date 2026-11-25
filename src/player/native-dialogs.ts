/** Story modal listeners are ordered by activation, independently of HTML
 * order. Back and directional navigation must resolve the same top layer. */
class NativeDialogStack {
  private dialogs: HTMLDialogElement[] = [
    ...document.querySelectorAll<HTMLDialogElement>('dialog[open]'),
  ];
  private observer = new MutationObserver((records) => this.track(records));
  constructor() {
    this.observer.observe(document.documentElement, {
      subtree: true,
      attributes: true,
      attributeFilter: ['open'],
      attributeOldValue: true,
    });
  }
  private track(records: MutationRecord[]): void {
    for (const [index, record] of records.entries()) {
      if (!(record.target instanceof HTMLDialogElement)) continue;
      const dialog = record.target,
        next = records.slice(index + 1).find((item) => item.target === dialog);
      const after = next ? next.oldValue !== null : dialog.open;
      if ((record.oldValue !== null) === after) continue;
      this.dialogs = this.dialogs.filter((entry) => entry !== dialog);
      if (after) this.dialogs.push(dialog);
    }
  }
  top(): HTMLDialogElement | undefined {
    this.track(this.observer.takeRecords());
    this.dialogs = this.dialogs.filter((dialog) => dialog.isConnected && dialog.open);
    return this.dialogs.at(-1);
  }
}
let stack: NativeDialogStack | undefined;
export function topNativeDialog(): HTMLDialogElement | undefined {
  return (stack ??= new NativeDialogStack()).top();
}
