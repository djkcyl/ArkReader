/** Authored command names with no executor in the pinned Windows AVG registry.
 * Keep this explicit: a missing web implementation must still fail admission. */
export const nativeUnhandledCommands = new Set([
  'duration',
  'palysound',
  'dealy',
  'delau',
  'daley',
  'stopmucis',
  'musicvolune',
  'dialo',
  'delat',
  'delayt',
  'chaa',
  'charslsot',
  'dialogs',
  'delay=',
  '[character',
  'dalay',
  'delya',
]);
