import type { CatalogData } from '../player/catalog-view';
import type { ViewingProgress } from '../core/viewing-progress';
import {
  emptyShelf,
  parseShelf,
  rememberStory,
  recordProgress,
  forgetStory,
  type ProgressLedger,
} from './reading-state';
import { chapterProgressView, storyProgressView } from './reading-progress-view';
import type { PlaybackPosition } from '../core/playback-position';
import type { PlaybackTarget } from '../player/restore-position';
import { resumeChoice } from './resume-choice';
import { libraryHeading } from './library-heading';
import { ReadingPreviews, previewText } from './reading-preview';
import type { ScriptSource } from '../core/script-preview';
import { confirmAction } from './action-confirm';
export { parseShelf, rememberStory } from './reading-state';

type LibraryTab = 'catalog' | 'recent' | 'favorites' | 'cache';
const tabs: LibraryTab[] = ['catalog', 'recent', 'favorites', 'cache'];

export class ReadingShelf {
  private data = emptyShelf();
  private catalog?: CatalogData;
  private groups = new Map<string, { id: string; name: string; ids: string[] }>();
  private membership = new Map<string, string>();
  private saveTimer?: ReturnType<typeof setTimeout>;
  private dirty = false;
  private mode: LibraryTab = 'catalog';
  private root = document.createElement('div');
  private tablist = document.createElement('div');
  private favorite = document.createElement('button');
  private selected = '';
  private previews: ReadingPreviews;
  constructor(
    private open: (id: string, target?: PlaybackTarget) => void,
    private changed: (ledger: ProgressLedger) => void,
    withCache = false,
    loadScript: (id: string) => Promise<ScriptSource> = async (id) => {
      const response = await fetch(
        '/api/story-script/' + id.split('/').map(encodeURIComponent).join('/'),
        { signal: AbortSignal.timeout(10000) },
      );
      if (!response.ok) throw Error('剧情文本暂不可用');
      return response.json();
    },
  ) {
    this.previews = new ReadingPreviews(
      loadScript,
      () => (document.getElementById('nickname') as HTMLInputElement | null)?.value || '博士',
      (id) => {
        this.render();
        document.dispatchEvent(new CustomEvent('arkreader-reading-preview', { detail: { id } }));
      },
    );
    const availableTabs = withCache ? tabs : tabs.filter((tab) => tab !== 'cache');
    try {
      this.data = parseShelf(localStorage.getItem('arkreader.shelf'));
    } catch {}
    try {
      const saved = localStorage.getItem('arkreader.libraryTab');
      if (availableTabs.includes(saved as LibraryTab)) this.mode = saved as LibraryTab;
    } catch {}
    const intro = document.getElementById('intro')!;
    const directory = document.createElement('section');
    directory.id = 'library-catalog';
    directory.className = 'library-panel';
    directory.append(...Array.from(intro.childNodes));
    this.root.className = 'library-panels';
    this.root.append(directory);
    this.tablist.className = 'library-tabs';
    this.tablist.setAttribute('role', 'tablist');
    this.tablist.setAttribute('aria-label', '剧情库');
    for (const [index, tab] of availableTabs.entries()) {
      const button = document.createElement('button');
      button.type = 'button';
      button.id = `library-tab-${tab}`;
      button.dataset.shelf = tab;
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-controls', `library-${tab}`);
      const label = document.createElement('span');
      label.textContent = ['剧情目录', '历史记录', '收藏', '缓存'][index];
      button.append(label);
      if (tab !== 'catalog') {
        const count = document.createElement('span');
        count.className = 'library-tab-count';
        button.append(count);
      }
      button.onclick = () => this.show(tab);
      this.tablist.append(button);
      const panel = tab === 'catalog' ? directory : document.createElement('section');
      panel.id = `library-${tab}`;
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', button.id);
      panel.tabIndex = 0;
      if (tab === 'cache') {
        panel.className = 'library-panel';
        this.root.append(panel);
      } else if (tab !== 'catalog') {
        panel.className = 'library-panel reading-panel';
        panel.innerHTML = /* HTML */ `<div
          class="shelf-items"
          tabindex="0"
          aria-label="${tab === 'recent' ? '历史记录列表' : '收藏列表'}"
        ></div>`;
        const heading = libraryHeading(
          tab === 'recent' ? 'READING HISTORY' : 'SAVED STORIES',
          tab === 'recent' ? '历史记录' : '收藏',
        );
        heading.root.classList.add('reading-heading');
        const count = document.createElement('span');
        count.className = 'reading-count library-heading-count';
        heading.actions.append(count);
        panel.prepend(heading.root);
        this.root.append(panel);
      }
    }
    this.tablist.onkeydown = (event) => {
      const current = availableTabs.indexOf(this.mode);
      let next: number;
      if (event.key === 'ArrowRight') next = (current + 1) % availableTabs.length;
      else if (event.key === 'ArrowLeft')
        next = (current + availableTabs.length - 1) % availableTabs.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = availableTabs.length - 1;
      else return;
      event.preventDefault();
      this.show(availableTabs[next]);
      this.tablist
        .querySelector<HTMLButtonElement>(`[data-shelf="${availableTabs[next]}"]`)!
        .focus();
    };
    intro.append(this.tablist, this.root);
    document.addEventListener('arkreader-show-catalog', () => this.show('catalog'));
    document.addEventListener('arkreader-show-cache', () => {
      if (withCache) this.show('cache');
    });
    this.show(this.mode);
    this.favorite.id = 'favorite-story';
    this.favorite.type = 'button';
    this.favorite.textContent = '☆ 收藏';
    this.favorite.hidden = true;
    document.getElementById('start')!.after(this.favorite);
    this.favorite.onclick = () => void this.toggleFavorite(this.selected);
    document.addEventListener('catalog-selection', (event) => {
      this.selected = (event as CustomEvent).detail.id ?? '';
      this.syncFavorite();
    });
    document.addEventListener('arkreader-resource-idle', () => {
      this.flush();
      this.render();
      this.changed(this.data.progress);
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.flush();
    });
    window.addEventListener('pagehide', () => this.flush());
    window.addEventListener('beforeunload', () => this.flush());
    this.render();
  }
  setCatalog(catalog: CatalogData) {
    this.catalog = catalog;
    this.groups.clear();
    this.membership.clear();
    for (const group of catalog.groups ?? []) {
      this.groups.set(group.id, {
        id: group.id,
        name: group.name,
        ids: group.stories.map((row) => row.id),
      });
      for (const row of group.stories) this.membership.set(row.id, group.id);
    }
    for (const row of catalog.stories)
      if (!this.membership.has(row.id)) {
        const id = row.groupId ?? 'offline';
        if (!this.groups.has(id))
          this.groups.set(id, { id, name: row.groupName ?? '剧情档案', ids: [] });
        this.groups.get(id)!.ids.push(row.id);
        this.membership.set(row.id, id);
      }
    this.render();
    this.changed(this.data.progress);
  }
  remember(id: string) {
    this.data = rememberStory(this.data, id);
    this.save();
    this.changed(this.data.progress);
  }
  resume(id: string) {
    const choice = resumeChoice(this.data.progress[id]);
    if (choice?.target.position && !choice.approximate)
      choice.preview = this.previews.get(id, choice.target.position);
    return choice;
  }
  scriptSource(id: string, source: ScriptSource) {
    this.previews.source(id, source);
  }
  update(id: string, progress: ViewingProgress, position?: PlaybackPosition) {
    if (!recordProgress(this.data, id, progress, position)) return;
    this.dirty = true;
    this.changed(this.data.progress);
    if (!this.saveTimer) this.saveTimer = setTimeout(() => this.flush(), 500);
  }
  flush() {
    clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    if (this.dirty) this.save();
  }
  private save() {
    try {
      localStorage.setItem('arkreader.shelf', JSON.stringify(this.data));
      this.dirty = false;
    } catch {
      this.dirty = true;
    }
  }
  private show(tab: LibraryTab) {
    this.mode = tab;
    for (const button of this.tablist.querySelectorAll<HTMLButtonElement>('[role=tab]')) {
      const active = button.dataset.shelf === tab;
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
    }
    for (const panel of this.root.querySelectorAll<HTMLElement>(':scope > [role=tabpanel]'))
      panel.hidden = panel.id !== `library-${tab}`;
    try {
      localStorage.setItem('arkreader.libraryTab', tab);
    } catch {}
    document.dispatchEvent(new CustomEvent('library-tab-changed', { detail: { tab } }));
    this.render();
  }
  private syncFavorite() {
    this.favorite.hidden = !this.selected;
    this.favorite.textContent = this.data.favorites.includes(this.selected) ? '★ 已收藏' : '☆ 收藏';
    this.favorite.setAttribute('aria-pressed', String(this.data.favorites.includes(this.selected)));
  }
  private async toggleFavorite(id: string) {
    if (!id) return;
    const removing = this.data.favorites.includes(id);
    const label = this.catalog?.stories.find((row) => row.id === id)?.label ?? id;
    if (
      !(await confirmAction(
        removing ? '取消收藏？' : '收藏这段剧情？',
        label,
        removing ? '取消收藏' : '收藏',
      ))
    )
      return;
    this.data.favorites = removing
      ? this.data.favorites.filter((story) => story !== id)
      : [id, ...this.data.favorites.filter((story) => story !== id)].slice(0, 200);
    this.save();
    this.render();
    this.syncFavorite();
  }
  private async removeHistory(id: string, label: string) {
    if (
      !(await confirmAction('删除这条阅读记录？', `${label}\n该剧情的观看进度也会清除。`, '删除'))
    )
      return;
    forgetStory(this.data, id);
    this.save();
    this.changed(this.data.progress);
    this.render();
    document.getElementById('library-tab-recent')!.focus({ preventScroll: true });
  }
  private render() {
    const known = new Map(this.catalog?.stories.map((row) => [row.id, row]));
    for (const tab of ['recent', 'favorites'] as const) {
      const rows = (
        tab === 'recent' ? this.data.recent.map((r) => r.id) : this.data.favorites
      ).filter((id) => known.has(id));
      this.tablist.querySelector(`[data-shelf="${tab}"] .library-tab-count`)!.textContent = String(
        rows.length,
      );
      const panel = this.root.querySelector(`#library-${tab}`)!;
      panel.querySelector('.reading-count')!.textContent = `${rows.length} 段剧情`;
      const list = panel.querySelector('.shelf-items')!,
        scroll = list.scrollTop;
      list.replaceChildren();
      const chapters = new Map<string, HTMLElement>();
      for (const [index, id] of rows.entries()) {
        const row = known.get(id)!,
          record = this.data.recent.find((r) => r.id === id),
          button = document.createElement('article');
        const progress = this.data.progress[id],
          groupId = this.membership.get(id)!,
          chapter = this.groups.get(groupId)!;
        button.className = 'shelf-story';
        button.dataset.recentStory = id;
        const number = document.createElement('span');
        number.className = 'shelf-number';
        number.textContent = String(index + 1).padStart(2, '0');
        const text = document.createElement('span');
        text.className = 'shelf-story-text';
        const group = document.createElement('span');
        group.className = 'shelf-group';
        group.textContent = [row.groupName, row.code, row.tag].filter(Boolean).join(' / ');
        const title = document.createElement('strong');
        title.textContent = row.title ?? row.label;
        const meta = document.createElement('span');
        meta.className = 'shelf-meta';
        meta.textContent =
          tab === 'recent' && record
            ? new Date(record.at).toLocaleString('zh-CN', {
                month: 'long',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })
            : progress?.percent === null
              ? '旧记录未记录观看位置'
              : progress
                ? progress.complete
                  ? '已读完'
                  : '阅读中'
                : '尚未阅读';
        const position = progress?.position,
          resume = resumeChoice(progress),
          approximate = resume?.approximate === true;
        const actions = document.createElement('div');
        actions.className = 'shelf-actions';
        const action = document.createElement('button');
        action.type = 'button';
        action.className = 'shelf-open';
        action.textContent = resume
          ? approximate
            ? `快进至约 ${resume.percent}% →`
            : `继续 ${resume.percent}% →`
          : record
            ? '重新阅读 →'
            : '开始阅读 →';
        if (resume)
          action.title = approximate
            ? '按最高进度恢复，遇到未记录的选项时暂停'
            : '从最高进度继续阅读';
        action.dataset.resumeStory = id;
        action.onclick = () => this.open(id, resume?.target);
        actions.append(action);
        const secondary = document.createElement('div');
        secondary.className = 'shelf-secondary';
        if (position || approximate) {
          const restart = document.createElement('button');
          restart.type = 'button';
          restart.className = 'shelf-restart';
          restart.textContent = '从头播放';
          restart.dataset.restartStory = id;
          restart.onclick = () => this.open(id);
          secondary.append(restart);
        }
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'shelf-restart shelf-remove';
        remove.textContent = tab === 'recent' ? '删除' : '取消收藏';
        remove.setAttribute('aria-label', `${remove.textContent}：${row.label}`);
        if (tab === 'recent') {
          remove.dataset.deleteHistory = id;
          remove.onclick = () => void this.removeHistory(id, row.label);
        } else {
          remove.dataset.removeFavorite = id;
          remove.onclick = () => void this.toggleFavorite(id);
        }
        secondary.append(remove);
        actions.append(secondary);
        const excerpt = document.createElement('span');
        excerpt.className = 'shelf-excerpt';
        excerpt.textContent = approximate
          ? '遇到未记录的选项时，需要重新选择'
          : position && this.mode === tab
            ? previewText(this.previews.get(id, position))
            : '';
        excerpt.title = excerpt.textContent;
        text.append(group, title, excerpt);
        button.append(number, text, storyProgressView(id, progress), meta, actions);
        if (tab === 'recent') {
          if (!chapters.has(groupId)) {
            const section = document.createElement('section');
            section.className = 'history-chapter';
            section.dataset.historyGroup = groupId;
            const heading = document.createElement('div');
            heading.className = 'history-chapter-heading';
            const name = document.createElement('h2');
            name.textContent = chapter.name;
            heading.append(name, chapterProgressView(groupId, chapter.ids, this.data.progress));
            const stories = document.createElement('div');
            stories.className = 'history-chapter-stories';
            section.append(heading, stories);
            list.append(section);
            chapters.set(groupId, stories);
          }
          chapters.get(groupId)!.append(button);
        } else {
          const summary = chapterProgressView(groupId, chapter.ids, this.data.progress);
          summary.classList.add('shelf-chapter-progress');
          button.insertBefore(summary, meta);
          meta.hidden = true;
          list.append(button);
        }
      }
      if (!rows.length) {
        const empty = document.createElement('div');
        empty.className = 'shelf-empty';
        const title = document.createElement('h2');
        title.textContent = tab === 'recent' ? '还没有阅读记录' : '还没有收藏的剧情';
        const hint = document.createElement('p');
        hint.textContent =
          tab === 'recent'
            ? '打开一段剧情后，会自动记录在这里。'
            : '在剧情目录选择一段故事，点击“收藏”即可添加。';
        const browse = document.createElement('button');
        browse.type = 'button';
        browse.textContent = '浏览剧情目录 →';
        browse.onclick = () => {
          this.show('catalog');
          document.getElementById('library-tab-catalog')!.focus();
        };
        empty.append(title, hint, browse);
        list.append(empty);
      }
      list.scrollTop = scroll;
    }
  }
}
