import './catalog-view.css';
import type { ProgressLedger } from '../app/reading-state';
import { chapterProgressView, storyProgressView } from '../app/reading-progress-view';
import { OperatorFilterView } from '../app/operator-filter-view';
import type { OperatorFilterOptions, OperatorMetadata } from '../app/operator-filter-model';
import { libraryHeading } from '../app/library-heading';

export interface CatalogStory {
  id: string;
  label: string;
  title?: string;
  code?: string;
  tag?: string;
  variant?: string;
  groupId?: string;
  groupName?: string;
  category?: string;
  cover?: string;
  subtitle?: string;
  theme?: string;
  operator?: OperatorMetadata;
  recordId?: string;
  recordName?: string;
  recordOrder?: number;
}
interface CatalogGroup {
  id: string;
  name: string;
  category: string;
  stories: CatalogStory[];
  cover?: string;
  hasCover?: boolean;
  subtitle?: string;
  theme?: string;
  operator?: CatalogStory['operator'];
}
export interface CatalogData {
  stories: CatalogStory[];
  categories?: { id: string; name: string }[];
  groups?: CatalogGroup[];
  operatorFilters?: OperatorFilterOptions | null;
}
const ENGLISH: Record<string, string> = {
  main: 'MAIN THEME',
  side: 'SIDE STORY',
  mini: 'STORY COLLECTION',
  memory: 'OPERATOR RECORDS',
  roguelike: 'INTEGRATED STRATEGIES',
  sandbox: 'RECLAMATION ALGORITHM',
  other: 'SPECIAL RECORDS',
};
const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls = '',
  text = '',
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  node.className = cls;
  node.textContent = text;
  return node;
};

export class CatalogView {
  private data: CatalogData = { stories: [] };
  private groups: CatalogGroup[] = [];
  private selected = '';
  private category = '';
  private opened?: CatalogGroup;
  private search: HTMLInputElement;
  private nav: HTMLElement;
  private content: HTMLElement;
  private status: HTMLElement;
  private details: HTMLElement;
  private retry: HTMLButtonElement;
  private heading: HTMLElement;
  private back: HTMLButtonElement;
  private ready = false;
  private searchTimer?: ReturnType<typeof setTimeout>;
  private covers: HTMLImageElement[] = [];
  private coverRequests = 0;
  private observer: IntersectionObserver;
  private saved: { category?: string; group?: string; selected?: string; query?: string } = {};
  private reading: ProgressLedger = {};
  private cached = new Set<string>();
  private filters: OperatorFilterView;
  private directoryScroll = 0;
  constructor(
    private root: HTMLElement,
    private start: HTMLButtonElement,
    reload: () => void,
    private play?: () => void,
  ) {
    root.innerHTML = /* HTML */ `<div class="archive-body">
        <nav id="catalog-nav" aria-label="剧情分类"></nav>
        <div class="archive-workspace">
          <p id="catalog-status" role="status"></p>
          <div id="catalog-content"></div>
          <button id="catalog-retry" type="button" hidden>重新加载目录</button>
        </div>
      </div>
      <p id="catalog-detail" aria-live="polite"></p>`;
    const heading = libraryHeading('RHODES ISLAND / ARCHIVES', '剧情回顾', 'catalog-heading');
    heading.root.classList.add('archive-top');
    const back = document.createElement('button');
    back.id = 'catalog-back';
    back.type = 'button';
    back.hidden = true;
    back.title = '返回章节目录';
    back.setAttribute('aria-label', '返回章节目录');
    back.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m10 5-7 7 7 7M3 12h18"/></svg><span>返回</span>';
    heading.row.prepend(back);
    heading.actions.innerHTML =
      '<label class="catalog-search"><span class="sr-only">搜索全部剧情</span><input id="story-search" type="search" placeholder="搜索干员 / 章节 / 剧情" autocomplete="off"><span aria-hidden="true">⌕</span></label>';
    root.prepend(heading.root);
    this.search = root.querySelector('#story-search')!;
    this.nav = root.querySelector('#catalog-nav')!;
    this.content = root.querySelector('#catalog-content')!;
    this.status = root.querySelector('#catalog-status')!;
    this.details = root.querySelector('#catalog-detail')!;
    this.retry = root.querySelector('#catalog-retry')!;
    this.heading = root.querySelector('#catalog-heading')!;
    this.back = root.querySelector('#catalog-back')!;
    this.filters = new OperatorFilterView(
      () => this.render(),
      () =>
        this.groups
          .filter((group) => group.category === 'memory' && this.matching(group).length)
          .flatMap((group) => (group.operator ? [group.operator] : [])),
    );
    this.search.closest('.catalog-search')!.before(this.filters.button);
    this.retry.onclick = reload;
    this.search.oninput = () => {
      clearTimeout(this.searchTimer);
      this.searchTimer = setTimeout(() => {
        this.opened = undefined;
        this.render();
      }, 120);
    };
    this.back.onclick = () => {
      const group = this.opened?.id;
      this.opened = undefined;
      this.render();
      this.scrollPane.scrollTop = this.directoryScroll;
      const card = [...this.content.querySelectorAll<HTMLButtonElement>('[data-group]')].find(
        (node) => node.dataset.group === group,
      );
      card?.scrollIntoView({ block: 'nearest' });
      card?.focus({ preventScroll: true });
    };
    try {
      this.saved = JSON.parse(localStorage.getItem('arkreader.catalogView') ?? '{}') ?? {};
    } catch {}
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries)
          if (entry.isIntersecting) {
            this.observer.unobserve(entry.target);
            this.covers.push(entry.target as HTMLImageElement);
          }
        this.pumpCovers();
      },
      { rootMargin: '180px' },
    );
    document.addEventListener('arkreader-resource-idle', () => this.pumpCovers());
    document.addEventListener('keydown', (event) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === 'k' &&
        !this.filters.dialog.open &&
        !document.body.classList.contains('playing') &&
        !document.body.classList.contains('resource-loading')
      ) {
        event.preventDefault();
        document.dispatchEvent(new Event('arkreader-show-library'));
        document.dispatchEvent(new Event('arkreader-show-catalog'));
        this.search.focus();
        this.search.select();
      }
    });
    this.busy();
  }
  get selectedId(): string {
    return this.selected;
  }
  private get scrollPane(): HTMLElement {
    return document.body.classList.contains('mobile-app')
      ? (this.root.closest<HTMLElement>('#intro') ?? this.content)
      : this.content;
  }
  get cacheScope() {
    return { category: this.category, group: this.opened?.id ?? '' };
  }
  setCachedStories(ids: Set<string>) {
    this.cached = ids;
    for (const badge of this.root.querySelectorAll<HTMLElement>('[data-cached-story]'))
      badge.hidden = !ids.has(badge.dataset.cachedStory!);
  }
  setReadingProgress(ledger: ProgressLedger): void {
    this.reading = ledger;
    if (document.body.classList.contains('playing')) return;
    for (const node of this.root.querySelectorAll<HTMLElement>('[data-progress-story]'))
      node.replaceWith(
        storyProgressView(node.dataset.progressStory!, ledger[node.dataset.progressStory!]),
      );
    for (const node of this.root.querySelectorAll<HTMLElement>('[data-progress-group]')) {
      const group = this.groups.find((row) => row.id === node.dataset.progressGroup);
      if (group)
        node.replaceWith(
          chapterProgressView(
            group.id,
            group.stories.map((row) => row.id),
            ledger,
          ),
        );
    }
  }
  busy(): void {
    this.ready = false;
    this.start.disabled = true;
    this.status.textContent = '正在读取剧情目录…';
    this.retry.hidden = true;
    if (!this.content.childElementCount)
      this.content.innerHTML =
        '<div class="catalog-skeleton" aria-hidden="true">' +
        Array(6).fill('<span></span>').join('') +
        '</div>';
  }
  fail(error: unknown): void {
    this.ready = false;
    this.start.disabled = true;
    this.content.querySelector('.catalog-skeleton')?.remove();
    this.status.textContent = `暂时无法读取剧情目录：${String(error).replace(/^Error: /, '')}`;
    this.retry.hidden = false;
  }
  load(data: CatalogData, requested?: string | null): void {
    if (!Array.isArray(data.stories)) throw new Error('目录格式不正确');
    this.data = data;
    this.groups = data.groups ?? [];
    this.filters.configure(data.operatorFilters ?? undefined);
    if (!this.groups.length && data.stories.length)
      this.groups = [
        { id: 'offline', name: '本地剧情', category: 'offline', stories: data.stories },
      ];
    const category = this.category || this.saved.category;
    this.category = this.groups.some((g) => g.category === category)
      ? category!
      : this.groups.some((g) => g.category === 'side')
        ? 'side'
        : (this.groups[0]?.category ?? '');
    const wanted = data.stories.find(
      (s) => s.id === (requested ?? (this.selected || this.saved.selected)),
    );
    this.selected = wanted?.id ?? '';
    this.opened =
      requested && wanted
        ? this.groups.find((g) => g.stories.some((s) => s.id === wanted.id))
        : this.groups.find((g) => g.id === (this.opened?.id ?? this.saved.group));
    if (requested) this.search.value = '';
    else if (!this.search.value) this.search.value = this.saved.query ?? '';
    if (this.opened) this.category = this.opened.category;
    this.ready = true;
    this.render();
    if (requested) document.dispatchEvent(new Event('arkreader-show-catalog'));
    if (requested && !wanted)
      this.details.textContent =
        '此链接不在当前剧情目录中，或此导出包未包含该剧情。请选择其他剧情。';
  }
  label(id: string): string | undefined {
    return this.data.stories.find((s) => s.id === id)?.label;
  }
  select(id: string): boolean {
    const group = this.groups.find((g) => g.stories.some((row) => row.id === id));
    if (!group) return false;
    clearTimeout(this.searchTimer);
    this.search.value = '';
    this.selected = id;
    this.opened = group;
    this.category = group.category;
    this.render();
    return true;
  }
  private pumpCovers(): void {
    if (document.body.matches('.playing,.resource-loading')) return;
    while (this.coverRequests < 2 && this.covers.length) {
      const img = this.covers.shift()!;
      if (!img.isConnected || !img.dataset.source) continue;
      this.coverRequests++;
      const frame = img.parentElement!;
      frame.classList.add('loading-cover');
      const done = () => {
        this.coverRequests--;
        frame.classList.remove('loading-cover');
        this.pumpCovers();
      };
      img.onload = () => {
        frame.classList.add('has-art');
        done();
      };
      img.onerror = () => {
        img.remove();
        done();
      };
      img.src = img.dataset.source;
      delete img.dataset.source;
    }
  }
  private matching(group: CatalogGroup): CatalogStory[] {
    const q = this.search.value.trim().toLocaleLowerCase();
    return group.stories.filter((s) =>
      `${s.label} ${s.id} ${s.subtitle ?? ''} ${s.operator?.name ?? ''} ${s.operator?.appellation ?? ''}`
        .toLocaleLowerCase()
        .includes(q),
    );
  }
  private cover(group: CatalogGroup): HTMLElement {
    const frame = el(
      'div',
      'archive-cover ' +
        group.category +
        '-art' +
        (group.category === 'memory'
          ? ' operator-portrait'
          : group.category === 'main'
            ? ' episode-art'
            : ''),
    );
    const mainNumber = group.id.match(/^main_(\d+)$/)?.[1];
    frame.append(
      el(
        'span',
        'cover-mark',
        mainNumber
          ? mainNumber.padStart(2, '0')
          : group.category === 'memory'
            ? 'RECORD'
            : 'ARCHIVE',
      ),
    );
    frame.append(el('span', 'cover-lines'));
    frame.append(el('strong', 'cover-fallback-title', group.name));
    const url = group.cover ?? group.stories[0]?.cover;
    if (url) {
      const img = el('img');
      img.dataset.source = url;
      img.alt = '';
      img.decoding = 'async';
      frame.append(img);
      this.observer.observe(img);
    }
    return frame;
  }
  private render(): void {
    this.observer.disconnect();
    this.covers = [];
    const searching = !!this.search.value.trim();
    const memoryScope = this.category === 'memory';
    this.filters.setVisible(memoryScope && !this.opened);
    this.search.placeholder = memoryScope ? '搜索干员 / 密录标题' : '搜索干员 / 章节 / 剧情';
    this.search.setAttribute('aria-label', memoryScope ? '搜索干员密录' : '搜索全部剧情');
    const categories = this.data.categories?.length
      ? this.data.categories
      : [{ id: 'offline', name: '本地剧情' }];
    this.nav.replaceChildren();
    for (const [index, c] of categories.entries()) {
      const button = el('button', 'archive-tab');
      button.type = 'button';
      button.dataset.category = c.id;
      button.setAttribute(
        'aria-pressed',
        String((!searching || memoryScope) && c.id === this.category),
      );
      button.append(
        el('span', 'tab-index', String(index + 1).padStart(2, '0')),
        el('span', 'tab-name', c.name),
        el('small', 'tab-en', ENGLISH[c.id] ?? 'ARCHIVE'),
      );
      button.onclick = () => {
        this.category = c.id;
        this.search.value = '';
        this.opened = undefined;
        this.render();
      };
      this.nav.append(button);
    }
    this.root.classList.toggle('showing-chapter', !!this.opened);
    this.root.dataset.category = this.opened?.category ?? (searching ? 'search' : this.category);
    this.back.hidden = !this.opened;
    this.heading.textContent =
      this.opened?.name ??
      (searching
        ? '搜索结果'
        : (categories.find((c) => c.id === this.category)?.name ?? '剧情回顾'));
    this.heading.title = this.heading.textContent;
    this.content.replaceChildren();
    this.scrollPane.scrollTop = 0;
    if (this.opened) this.renderChapter(this.opened);
    else {
      const groups = this.groups.filter(
        (g) =>
          (memoryScope
            ? g.category === 'memory' && this.filters.matches(g.operator)
            : searching || g.category === this.category) && this.matching(g).length,
      );
      this.status.textContent = `${ENGLISH[searching ? '' : this.category] ?? 'SEARCH RESULTS'}  /  ${groups.length} 个档案 · ${groups.reduce((n, g) => n + this.matching(g).length, 0)} 段剧情`;
      if (memoryScope) {
        this.status.textContent = `OPERATOR RECORDS / ${groups.length} / ${this.groups.filter((g) => g.category === 'memory').length} 名干员 · ${groups.reduce((n, g) => n + this.matching(g).length, 0)} 段剧情`;
        if (this.filters.activeCount) {
          const reset = el('button', '', '清空筛选');
          reset.id = 'operator-filter-reset';
          reset.type = 'button';
          reset.onclick = () => this.filters.clear();
          this.status.append(reset);
        }
      }
      const grid = el(
        'div',
        'archive-grid ' +
          (!searching ? this.category + '-grid' : '') +
          (memoryScope
            ? ' operator-grid'
            : !searching && this.category === 'main'
              ? ' episode-grid'
              : ''),
      );
      if (!searching && ['roguelike', 'sandbox'].includes(this.category))
        grid.classList.add('topic-grid');
      for (const group of groups) {
        const button = el(
          'button',
          'archive-card ' +
            group.category +
            '-card ' +
            (group.category === 'memory'
              ? 'operator-card'
              : group.category === 'main'
                ? 'episode-card'
                : ''),
        );
        button.type = 'button';
        button.dataset.group = group.id;
        button.setAttribute('aria-label', `${group.name}，${this.matching(group).length} 段剧情`);
        button.append(this.cover(group));
        const topic = group.category === 'roguelike' || group.category === 'sandbox';
        if (topic) {
          button.classList.add('topic-card');
          const number = group.id.match(/\d+$/)?.[0]?.padStart(2, '0') ?? '';
          const heading = el('div', 'topic-heading');
          heading.append(
            el('span', 'topic-index', number),
            el(
              'span',
              'topic-kind',
              group.category === 'roguelike' ? '集成战略 / 主题档案' : '生息演算 / 生存档案',
            ),
          );
          const info = el('div', 'topic-info');
          info.append(el('strong', 'card-title', group.name));
          const bottom = el('div', 'topic-bottom');
          bottom.append(
            el('span', '', `${this.matching(group).length} 段剧情`),
            el('span', 'topic-enter', '查看档案 →'),
          );
          info.append(bottom);
          button.append(heading, info);
        } else {
          if (group.category === 'main')
            button.append(
              el(
                'span',
                'episode-number',
                'EPISODE ' + group.id.replace('main_', '').padStart(2, '0'),
              ),
            );
          const operator = group.operator ?? group.stories[0]?.operator;
          const info = el('div', 'card-info');
          info.append(
            el(
              'small',
              'card-type',
              operator?.appellation || (ENGLISH[group.category] ?? 'ARCHIVE'),
            ),
            el('strong', 'card-title', group.name),
          );
          if (operator?.rarity) {
            const summary = this.operatorSummary(operator);
            info.append(
              el('span', 'operator-attributes', summary.attributes),
              el('span', 'operator-faction', summary.faction),
            );
            button.title = [group.name, summary.attributes, summary.faction].join(' · ');
          }
          const subtitle = group.subtitle ?? group.stories[0]?.subtitle;
          if (subtitle) info.append(el('span', 'card-subtitle', subtitle));
          const bottom = el('div', 'card-bottom');
          bottom.append(
            el(
              'span',
              '',
              group.category === 'memory'
                ? `${new Set(this.matching(group).map((s) => s.recordId ?? s.id)).size} 篇密录 · ${this.matching(group).length} 段剧情`
                : `${this.matching(group).length} RECORDS`,
            ),
            el('span', '', '↗'),
          );
          info.append(bottom);
          button.append(info);
        }
        button.querySelector('.card-info,.topic-info')!.append(
          chapterProgressView(
            group.id,
            group.stories.map((row) => row.id),
            this.reading,
          ),
        );
        button.onclick = () => {
          this.directoryScroll = this.scrollPane.scrollTop;
          this.opened = group;
          const rows = this.matching(group);
          if (!rows.some((s) => s.id === this.selected)) this.selected = rows[0]?.id ?? '';
          this.render();
          this.back.focus();
        };
        grid.append(button);
      }
      this.content.append(grid);
      if (!groups.length)
        this.content.append(
          el(
            'div',
            'archive-empty',
            memoryScope
              ? '没有符合当前筛选和搜索条件的干员。可清空筛选或修改关键词。'
              : '没有匹配的档案，试试其他关键词。',
          ),
        );
    }
    this.updateSelection();
  }
  private operatorSummary(operator: OperatorMetadata) {
    const options = this.data.operatorFilters;
    return {
      attributes: [
        `${operator.rarity}★`,
        options?.professions.find((row) => row.id === operator.profession)?.name,
        options?.positions
          .filter((row) => row.id & (operator.position ?? 0))
          .map((row) => row.name)
          .join(' / '),
      ]
        .filter(Boolean)
        .join(' · '),
      faction: options?.factions.find((row) => row.id === operator.displayFactionId)?.name ?? '',
    };
  }
  private renderChapter(group: CatalogGroup): void {
    const rows = this.matching(group);
    this.status.textContent = `${ENGLISH[group.category] ?? 'ARCHIVE'}  /  ${rows.length} RECORDS`;
    const chapter = el(
      'div',
      'chapter-layout ' +
        group.category +
        '-detail ' +
        (group.category === 'memory'
          ? 'operator-detail'
          : group.category === 'main'
            ? 'episode-detail'
            : ''),
    );
    const poster = el('aside', 'chapter-poster');
    poster.append(
      this.cover(group),
      el('h2', '', group.name),
      el(
        'p',
        '',
        group.subtitle ?? group.stories[0]?.subtitle ?? `${rows.length} 段剧情 / 剧情回顾`,
      ),
    );
    if (['roguelike', 'sandbox'].includes(group.category)) chapter.classList.add('topic-detail');
    if (group.operator?.rarity) {
      const summary = this.operatorSummary(group.operator);
      poster.append(
        el(
          'span',
          'operator-attributes',
          [summary.attributes, summary.faction].filter(Boolean).join(' · '),
        ),
      );
    }
    poster.append(
      chapterProgressView(
        group.id,
        group.stories.map((row) => row.id),
        this.reading,
      ),
    );
    const list = el('div', 'chapter-tracks');
    list.setAttribute('aria-label', '章节剧情');
    let record = '';
    for (const [index, row] of rows.entries()) {
      if (group.category === 'sandbox' || group.category === 'roguelike') {
        const section = row.tag?.split(' · ')[0] || (index === 0 ? '序幕' : '剧情');
        if (section !== record) {
          record = section;
          list.append(el('h3', 'record-heading', section));
        }
      }
      if (group.category === 'memory' && row.recordId && row.recordId !== record) {
        record = row.recordId;
        list.append(
          el(
            'h3',
            'record-heading',
            `干员密录 ${row.recordOrder ?? ''} / ${row.recordName ?? row.title ?? ''}`,
          ),
        );
      }
      const button = el('button', 'story-track');
      button.type = 'button';
      button.dataset.story = row.id;
      button.setAttribute('aria-pressed', String(row.id === this.selected));
      const title = el('span', 'track-title');
      title.append(el('strong', '', row.title ?? row.label));
      if (row.variant) title.append(el('small', '', row.variant));
      const cacheMark = el('span', 'story-cache-mark', '已缓存');
      cacheMark.dataset.cachedStory = row.id;
      cacheMark.hidden = !this.cached.has(row.id);
      title.querySelector('strong')!.append(cacheMark);
      title.append(storyProgressView(row.id, this.reading[row.id]));
      button.append(
        el(
          'span',
          'track-number',
          row.code ||
            (group.category === 'memory'
              ? 'RECORD ' + String(row.recordOrder ?? 1).padStart(2, '0')
              : String(index + 1).padStart(2, '0')),
        ),
        title,
        el('span', 'track-tag', row.tag ?? ''),
        el('span', 'track-play', '▷'),
      );
      button.onclick = () => {
        this.selected = row.id;
        this.updateSelection();
      };
      button.ondblclick = () => {
        this.selected = row.id;
        this.updateSelection();
        this.play?.();
      };
      button.title = '选择剧情；双击直接播放';
      list.append(button);
    }
    chapter.append(poster, list);
    this.content.append(chapter);
  }
  private updateSelection(): void {
    const row = this.data.stories.find((s) => s.id === this.selected);
    this.start.disabled = !this.ready || !row || !this.opened;
    this.details.textContent = this.opened
      ? (row?.label ?? '请选择一段剧情')
      : '选择档案，查看章节剧情';
    for (const button of this.content.querySelectorAll<HTMLButtonElement>('[data-story]'))
      button.setAttribute('aria-pressed', String(button.dataset.story === this.selected));
    this.root.closest('#intro')?.classList.toggle('chapter-open', !!this.opened);
    try {
      localStorage.setItem(
        'arkreader.catalogView',
        JSON.stringify({
          category: this.category,
          group: this.opened?.id,
          selected: this.selected,
          query: this.search.value,
        }),
      );
    } catch {}
    document.dispatchEvent(
      new CustomEvent('catalog-selection', {
        detail: { id: this.opened ? row?.id : null, label: this.opened ? row?.label : null },
      }),
    );
  }
}
