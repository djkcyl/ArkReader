import { drawChoiceLabel } from './choice-label';
import { readingMarkup } from '../core/sticker-color';
import { NativeSelectableSurface } from './native-selectable';
const surfaces = new WeakMap<HTMLElement, NativeSelectableSurface>();

const resize = new ResizeObserver((entries) => {
  for (const entry of entries) {
    const canvas = entry.target as HTMLCanvasElement;
    if (canvas.isConnected) drawChoiceLabel(canvas, canvas.textContent ?? '');
  }
});

/** Shared by the actual player and the render-audit harness. */
export function renderChoices(
  container: HTMLElement,
  choices: readonly { text: string; value: number; disabled?: boolean }[],
  choose: (index: number) => void,
  press?: () => void,
): void {
  let surface = surfaces.get(container);
  if (!surface) {
    surface = new NativeSelectableSurface(
      container,
      'button',
      () => !container.hidden,
      (el) => [{ element: el, pseudo: '::before' }],
      0,
    );
    surfaces.set(container, surface);
  }
  surface.reset();
  for (const label of container.querySelectorAll('canvas')) resize.unobserve(label);
  container.replaceChildren();
  choices.forEach((choice, index) => {
    const button = document.createElement('button');
    button.dataset.option = String(index);
    button.disabled = !!choice.disabled;
    const label = document.createElement('canvas');
    label.className = 'choice-label';
    label.textContent = choice.text;
    button.setAttribute('aria-label', readingMarkup(choice.text)?.plain ?? choice.text);
    label.setAttribute('aria-hidden', 'true');
    button.append(label);
    // AudioClickPlayer handles pointer-down independently of Selectable's
    // left-button/interactable gate; a disabled option can still play UI audio.
    if (press) button.onpointerdown = () => press();
    button.onclick = () => choose(index);
    container.append(button);
    drawChoiceLabel(label, choice.text);
    resize.observe(label, {
      box:
        'devicePixelContentBoxSize' in ResizeObserverEntry.prototype
          ? 'device-pixel-content-box'
          : 'content-box',
    });
  });
  surface.update();
}
