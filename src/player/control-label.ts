/** Preserve authored graphic children when an action changes its caption. */
export function setControlLabel(button: HTMLElement, text: string): void {
  const labels = button.querySelectorAll<HTMLElement>('[data-native-label]');
  for (const label of labels.length ? labels : [button])
    if (label.textContent !== text) label.textContent = text;
}
