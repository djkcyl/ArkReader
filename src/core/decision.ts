/** Native evidence: Windows 2.7.91, RVA 0x4179B00, 0x41C7730, 0x41C7980. */
export class DecisionPredicator {
  decisionValue = 0;
  referenceValues: number[] | null = null;
  readonly selectedIndexes = new Map<number, number>();

  needToExecute(command: string): boolean {
    if (!this.referenceValues?.length || this.decisionValue === 0) return true;
    if (command === 'predicate') return true;
    return this.referenceValues.includes(this.decisionValue);
  }

  beginDecision(): void {
    this.decisionValue = 0;
    this.referenceValues = null;
  }

  setPredicate(references?: string): void {
    this.referenceValues =
      references === undefined ? null : references.split(';').map(parseInt32OrZero);
  }

  select(value: number, optionIndex: number, line: number): void {
    this.decisionValue = value;
    if (line > 0) this.selectedIndexes.set(line, optionIndex);
  }
}

/** Int32.TryParse default NumberStyles.Integer, including overflow failure. */
export function parseInt32OrZero(text: string): number {
  const normalized = text.trim();
  if (!/^[+-]?[0-9]+$/.test(normalized)) return 0;
  const value = Number(normalized);
  return Number.isInteger(value) && value >= -2147483648 && value <= 2147483647 ? value : 0;
}

export function optionValue(values: string, index: number): number {
  const parts = values.split(';');
  return index < 0 || index >= parts.length ? 0 : parseInt32OrZero(parts[index]);
}

/** DecisionPanel #4691 has three button roots; PlaybackPanel keeps the full string. */
export const DECISION_BUTTON_COUNT = 3;
// ui.ON_DEFAULT_BTN_CLICK in the client audio_data table.
export const DECISION_PRESS_CLIP = 'g_ui_btn_n';
// AudioClickPlayer internal CancelBtn / ConfirmBtn, official audio_data.
export const SKIP_CANCEL_CLIP = 'g_ui_back';
export const SKIP_CONFIRM_CLIP = 'g_ui_confirm';

export function decisionButtons(options: unknown, values: unknown) {
  return String(options ?? '')
    .split(';', DECISION_BUTTON_COUNT)
    .map((text, index) => ({
      text: text.startsWith('&') ? text.slice(1) : text,
      value: optionValue(String(values ?? ''), index),
      ...(text.startsWith('&') ? { disabled: true } : {}),
    }));
}
