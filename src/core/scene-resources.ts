import type { Command } from './scheduler.ts';

/** Extra profiles requested by the renderer in addition to a chapter's assets. */
export function sceneResources(commands: Command[]) {
  return {
    focus: commands.some((c) => c.name === 'focusout'),
    filters: commands.some(
      (c) =>
        c.name === 'cameraeffect' ||
        c.name === 'glitchtween' ||
        (c.name === 'charslot' && c.params.glitch !== undefined),
    ),
    slider: commands.some(
      (c) => c.name === 'blocker' && ['slider', 'verticalslider'].includes(String(c.params.style)),
    ),
  };
}
