import './library-heading.css';

export function libraryHeading(eyebrow: string, title: string, titleId?: string) {
  const root = document.createElement('header');
  root.className = 'library-heading';
  const copy = document.createElement('div');
  copy.className = 'library-heading-copy';
  const kicker = document.createElement('div');
  kicker.className = 'archive-kicker library-heading-kicker';
  kicker.textContent = eyebrow;
  const row = document.createElement('div');
  row.className = 'library-heading-title-row';
  const heading = document.createElement('h1');
  heading.className = 'library-heading-title';
  heading.textContent = title;
  if (titleId) heading.id = titleId;
  const actions = document.createElement('div');
  actions.className = 'library-heading-actions';
  row.append(heading);
  copy.append(kicker, row);
  root.append(copy, actions);
  return { root, heading, row, actions };
}
