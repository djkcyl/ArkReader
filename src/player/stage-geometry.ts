/** Pointer and dialog geometry in the player's logical, unrotated axes. */
export function stageRotated(element: Element): boolean {
  return element.closest('[data-stage-rotated]')?.getAttribute('data-stage-rotated') === 'true';
}

export function stageSize(element: Element): { width: number; height: number } {
  const rect = element.getBoundingClientRect();
  return stageRotated(element) ? { width: rect.height, height: rect.width } : rect;
}

export function stagePoint(element: Element, event: { clientX: number; clientY: number }) {
  const rect = element.getBoundingClientRect();
  return stageRotated(element)
    ? {
        x: event.clientY - rect.top,
        y: rect.right - event.clientX,
        width: rect.height,
        height: rect.width,
      }
    : {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
        width: rect.width,
        height: rect.height,
      };
}

export function stageRect(element: Element, reference: Element) {
  const rect = element.getBoundingClientRect(),
    base = reference.getBoundingClientRect();
  return stageRotated(reference)
    ? { x: rect.top - base.top, y: base.right - rect.right, width: rect.height, height: rect.width }
    : { x: rect.left - base.left, y: rect.top - base.top, width: rect.width, height: rect.height };
}

/** Modal dialogs live in the top layer, outside their parent's CSS transform. */
export function fitStageDialog(dialog: HTMLElement, viewport: HTMLElement): void {
  const rect = viewport.getBoundingClientRect(),
    rotated = stageRotated(viewport);
  dialog.dataset.stageRotated = String(rotated);
  Object.assign(dialog.style, {
    left: (rotated ? rect.right : rect.left) + 'px',
    top: rect.top + 'px',
    width: (rotated ? rect.height : rect.width) + 'px',
    height: (rotated ? rect.width : rect.height) + 'px',
    transformOrigin: '0 0',
    transform: rotated ? 'rotate(90deg)' : 'none',
  });
}
