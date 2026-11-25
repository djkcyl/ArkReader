import type { Command } from './scheduler.ts';

const destinations = [
  'NONE',
  'HOME',
  'SQUAD',
  'CHAR_REPO',
  'HANDBOOK',
  'STAGE',
  'BUILDING',
  'RECRUIT_ADVANCED',
  'RECRUIT_NORMAL',
  'SHOP',
  'MISSION',
  'FRIEND',
  'BUILDING_MANUF',
  'BUILDING_WORKSHOP',
  'BUILDING_TRADE',
] as const;
export type PageDestination = (typeof destinations)[number];
export function pageDestination(value: unknown): PageDestination | null {
  const text = String(value ?? '')
    .trim()
    .toUpperCase();
  const index = /^[+-]?\d+$/.test(text)
    ? Number(text)
    : destinations.indexOf(text as PageDestination);
  return index > 0 && index < destinations.length ? destinations[index] : null;
}

/** Commands requiring a host rather than only the AVG renderer. */
export function storyHostRequirements(commands: Command[]): Command[] {
  return commands.filter(
    (c) =>
      c.name === 'tutorial' ||
      (c.name === 'startbattle' && !!String(c.params.stageId ?? '')) ||
      (c.name === 'gotopage' && !!pageDestination(c.params.dest)),
  );
}

/** The standalone archive supports its own HOME and an explicit reader action
 * at the battle boundary. It has no arbitrary gameplay signal producer. */
export function unsupportedStandaloneHostCommands(commands: Command[]): Command[] {
  const hasBattle = commands.some(
    (c) => c.name === 'startbattle' && !!String(c.params.stageId ?? ''),
  );
  return storyHostRequirements(commands).filter((c) => {
    if (c.name === 'startbattle') return false;
    if (c.name === 'gotopage')
      return pageDestination(c.params.dest) !== 'HOME' || !!String(c.params.waitForSignal ?? '');
    return (
      !hasBattle ||
      c.params.waitForSignal !== 'battle_start' ||
      !!String(c.params.abortForSignal ?? '')
    );
  });
}
