export interface OperatorMetadata {
  id: string;
  name: string;
  appellation: string;
  rarity?: number;
  profession?: number;
  position?: number;
  factionIds?: string[];
  secondaryFactionIds?: string[];
  displayFactionId?: string;
}
export interface OperatorFilterOptions {
  rarities: number[];
  professions: { id: number; name: string }[];
  positions: { id: number; name: string }[];
  factions: { id: string; name: string; level: number; order: number }[];
}
export interface OperatorFilters {
  rarities: number[];
  professions: number[];
  positions: number[];
  factions: string[];
  includeSecondary: boolean;
}
export const emptyOperatorFilters = (): OperatorFilters => ({
  rarities: [],
  professions: [],
  positions: [],
  factions: [],
  includeSecondary: false,
});
export function normalizeOperatorFilters(
  value: unknown,
  options: OperatorFilterOptions,
): OperatorFilters {
  const input = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const select = <T extends string | number>(name: string, allowed: T[]): T[] => [
    ...new Set(
      Array.isArray(input[name])
        ? (input[name] as unknown[]).filter((v): v is T => allowed.includes(v as T))
        : [],
    ),
  ];
  return {
    rarities: select('rarities', options.rarities),
    professions: select(
      'professions',
      options.professions.map((row) => row.id),
    ),
    positions: select(
      'positions',
      options.positions.map((row) => row.id),
    ),
    factions: select(
      'factions',
      options.factions.map((row) => row.id),
    ),
    includeSecondary: input.includeSecondary === true,
  };
}
export function operatorMatches(
  operator: OperatorMetadata | undefined,
  filter: OperatorFilters,
): boolean {
  if (
    !filter.rarities.length &&
    !filter.professions.length &&
    !filter.positions.length &&
    !filter.factions.length
  )
    return true;
  if (!operator) return false;
  if (filter.rarities.length && !filter.rarities.includes(operator.rarity ?? 0)) return false;
  if (
    filter.professions.length &&
    !(filter.professions.reduce((mask, flag) => mask | flag, 0) & (operator.profession ?? 0))
  )
    return false;
  if (
    filter.positions.length &&
    !(filter.positions.reduce((mask, flag) => mask | flag, 0) & (operator.position ?? 0))
  )
    return false;
  const powers = [
    ...(operator.factionIds ?? []),
    ...(filter.includeSecondary ? (operator.secondaryFactionIds ?? []) : []),
  ];
  return !filter.factions.length || filter.factions.some((id) => powers.includes(id));
}
export const operatorFilterCount = (filter: OperatorFilters) =>
  filter.rarities.length +
  filter.professions.length +
  filter.positions.length +
  filter.factions.length;
