export function profileUrl(name: 'profile' | 'blocker-profile' | 'filter-profile'): string {
  return `/api/${name}`;
}

export function playerMediaUrl(file: string): string {
  return '/media/' + file;
}
