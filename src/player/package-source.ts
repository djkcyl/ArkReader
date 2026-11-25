import type { CatalogStory } from './catalog-view';
interface ChapterEntry extends CatalogStory {
  url: string;
}
const metadata =
  typeof document === 'undefined'
    ? null
    : document.querySelector<HTMLMetaElement>('meta[name="arkreader-chapters"]');
export const packagedChapters: ChapterEntry[] | undefined = metadata
  ? JSON.parse(metadata.content)
  : undefined;

export function profileUrl(name: 'profile' | 'blocker-profile' | 'filter-profile'): string {
  return packagedChapters ? `./player/${name}.json` : `/api/${name}`;
}

export function playerMediaUrl(file: string): string {
  return (packagedChapters ? './media/' : '/media/') + file;
}
