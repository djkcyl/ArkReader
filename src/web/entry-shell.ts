import {
  applicationHeader,
  createApplicationRail,
  decorateApplicationHeader,
  markApplicationPage,
  type ApplicationPage,
} from '../app/application-chrome';
import { startupDownloads } from '../app/download-page';
import { mountMobilePlatform } from '../app/mobile';
import { mountScrollbars } from '../app/scrollbars';
import '../style.css';
import '../app/desktop-shell.css';
import '../app/qol.css';
import '../app/library-layout.css';
import '../app/native-application.css';
import '../app/mobile.css';
import './entry-shell.css';

export class EntryShell {
  private rail = createApplicationRail();
  private root = document.createElement('div');
  private startup = document.getElementById('startup-root')!;
  private downloads = startupDownloads();
  private status = document.createElement('p');
  private retry = document.createElement('button');
  private events = new AbortController();
  private requestResources!: () => void;
  readonly resourcesRequested = new Promise<void>((resolve) => {
    this.requestResources = resolve;
  });
  constructor(page: ApplicationPage, warm: boolean) {
    mountMobilePlatform();
    document.body.classList.add('desktop-app', 'app-native-ui', 'web-entry-shell');
    document.body.classList.toggle('web-restoring', warm);
    this.root.id = 'app';
    this.root.innerHTML = applicationHeader;
    const header = this.root.querySelector<HTMLElement>('.brand')!;
    decorateApplicationHeader(header);
    header.querySelector('a')!.onclick = (event) => {
      event.preventDefault();
      this.show('library');
    };
    this.status.className = 'web-entry-status';
    this.status.setAttribute('role', 'status');
    this.retry.type = 'button';
    this.retry.textContent = '重试';
    this.retry.hidden = true;
    this.retry.onclick = () => location.reload();
    header.append(this.status, this.retry);
    this.root.append(this.startup, this.downloads.root);
    document.body.prepend(this.rail, this.root);
    for (const button of this.rail.querySelectorAll<HTMLButtonElement>('button[data-page]'))
      button.onclick = () => this.show(button.dataset.page as ApplicationPage);
    document.addEventListener('arkreader-show-library', () => this.show('library'), {
      signal: this.events.signal,
    });
    document.addEventListener(
      'arkreader-startup-finished',
      () => {
        this.events.abort();
        this.rail.remove();
        document.body.classList.remove('web-entry-shell', 'web-restoring');
      },
      { once: true },
    );
    delete document.documentElement.dataset.downloadEntry;
    this.show(page);
    mountScrollbars();
  }
  show(page: ApplicationPage): void {
    document.body.dataset.desktopPage = page;
    markApplicationPage(this.rail, page);
    const downloading = page === 'downloads';
    this.downloads.root.hidden = !downloading;
    this.startup.hidden = downloading;
    const url = new URL(location.href);
    if (downloading) url.searchParams.set('page', 'downloads');
    else url.searchParams.delete('page');
    history.replaceState(history.state, '', url);
    if (!downloading) this.requestResources();
  }
  update(message: string): void {
    this.status.textContent = message;
  }
  ready(): void {
    this.downloads.setReady(true);
    this.update('');
  }
  fail(message: string): void {
    this.update(message);
    this.retry.hidden = false;
  }
}
