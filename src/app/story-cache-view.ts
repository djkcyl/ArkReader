import type { CatalogData, CatalogStory } from '../player/catalog-view';
import { resourceRequest, type OperationStatus } from './resource-api';
import { renderTransfers, transferSpeed } from './transfer-labels';
import { libraryHeading } from './library-heading';
import { confirmAction } from './action-confirm';
import './story-cache.css';

interface CacheItem {
  id: string;
  label: string;
  state: 'pending' | 'planning' | 'downloading' | 'completed' | 'failed';
  error?: string | null;
}
interface CacheJob extends Omit<OperationStatus, 'state'> {
  state: OperationStatus['state'] | 'paused' | 'outdated';
  completed: number;
  failed: number;
  current: string;
  items: CacheItem[];
}
interface CacheStatus {
  cached: string[];
  stale: string[];
  job: CacheJob | null;
}
const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', cls = '') => {
  const el = document.createElement(tag);
  el.textContent = text;
  el.className = cls;
  return el;
};
const bytes = (n = 0) =>
  n >= 1073741824 ? `${(n / 1073741824).toFixed(2)} GB` : `${(n / 1048576).toFixed(1)} MB`;

export class StoryCacheView {
  private catalog: CatalogData = { stories: [] };
  private selected = new Set<string>();
  private cached = new Set<string>();
  private known = new Set<string>();
  private current = '';
  private data: CacheStatus = { cached: [], stale: [], job: null };
  private busy = false;
  private refreshing?: Promise<void>;
  private scopeInitialized = false;
  private timer?: ReturnType<typeof setTimeout>;
  private root = document.createElement('div');
  private single = document.createElement('button');
  constructor(
    private changed: (ids: Set<string>) => void,
    private scope: () => { category: string; group: string },
  ) {
    this.single.id = 'cache-story';
    this.single.type = 'button';
    this.single.textContent = '缓存本段';
    this.single.disabled = true;
    document.getElementById('favorite-story')!.after(this.single);
    this.single.onclick = () => {
      if (this.current) void this.start([this.current]);
    };
    this.root.id = 'story-cache-view';
    this.root.className = 'story-cache-panel';
    this.root.innerHTML = /* HTML */ `<nav class="cache-tabs" aria-label="缓存管理">
        <button id="cache-select-tab" aria-pressed="true">选择剧情</button
        ><button id="cache-queue-tab" aria-pressed="false">任务与结果</button>
      </nav>
      <section id="cache-select-panel">
        <div class="cache-filters">
          <label>分类<select id="cache-category"></select></label
          ><label>章节<select id="cache-group"></select></label
          ><input
            id="cache-search"
            type="search"
            placeholder="搜索章节或剧情"
            aria-label="搜索待缓存剧情"
          />
        </div>
        <div class="cache-selection-tools">
          <button id="cache-select-all">全选筛选结果</button
          ><button id="cache-clear-selection">清空选择</button><span id="cache-filter-count"></span>
        </div>
        <div
          id="cache-story-list"
          class="cache-story-list"
          tabindex="0"
          aria-label="待缓存剧情列表"
        ></div>
      </section>
      <section id="cache-queue-panel" hidden>
        <div id="cache-task-detail"></div>
        <div id="cache-task-transfers"></div>
        <div id="cache-task-items" tabindex="0" aria-label="缓存任务结果"></div>
      </section>
      <p id="cache-error" role="alert" hidden></p>
      <footer>
        <span id="cache-selection-count">已选 0 段</span
        ><button id="cache-cancel" hidden>取消缓存</button
        ><button id="cache-resume" hidden>继续未完成</button
        ><button id="cache-start">缓存所选剧情</button>
      </footer>`;
    const heading = libraryHeading('DOWNLOADS / LOCAL CACHE', '剧情缓存');
    heading.root.classList.add('cache-page-heading');
    const count = document.createElement('span');
    count.id = 'cache-overview-count';
    count.className = 'library-heading-count';
    heading.actions.append(count);
    this.root.prepend(heading.root);
    this.el('library-cache').append(this.root);
    this.el('cache-cancel').onclick = () => void this.cancel();
    this.el('cache-resume').onclick = () => void this.resume();
    this.el('cache-select-tab').onclick = () => this.tab(false);
    this.el('cache-queue-tab').onclick = () => this.tab(true);
    this.el('cache-start').onclick = () => void this.start([...this.selected]);
    this.el<HTMLSelectElement>('cache-category').onchange = () => {
      this.groups();
      this.renderChoices();
    };
    this.el<HTMLSelectElement>('cache-group').onchange = () => this.renderChoices();
    this.el<HTMLInputElement>('cache-search').oninput = () => this.renderChoices();
    this.el('cache-select-all').onclick = () => {
      for (const row of this.filtered()) this.selected.add(row.id);
      this.renderChoices();
    };
    this.el('cache-clear-selection').onclick = () => {
      this.selected.clear();
      this.renderChoices();
    };
    document.addEventListener('catalog-selection', (event) => {
      this.current = (event as CustomEvent).detail.id ?? '';
      this.controls();
    });
    document.addEventListener('arkreader-resource-idle', () => void this.refresh());
    document.addEventListener('library-tab-changed', (event) => {
      if ((event as CustomEvent).detail.tab === 'cache') this.activate();
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) void this.refresh();
    });
    window.addEventListener('pagehide', () => clearTimeout(this.timer));
    let queue = false;
    try {
      queue = localStorage.getItem('arkreader.cacheView') === 'queue';
    } catch {}
    this.tab(queue);
  }
  private el<T extends HTMLElement = HTMLElement>(id: string) {
    return document.getElementById(id) as T;
  }
  setCatalog(catalog: CatalogData) {
    const groups = new Map(
      (catalog.groups ?? []).flatMap((g) => g.stories.map((row) => [row.id, g] as const)),
    );
    this.catalog = {
      ...catalog,
      stories: catalog.stories.map((row) => {
        const group = groups.get(row.id);
        return {
          ...row,
          category: row.category ?? group?.category,
          groupId: row.groupId ?? group?.id,
          groupName: row.groupName ?? group?.name,
        };
      }),
    };
    this.known = new Set(catalog.stories.map((row) => row.id));
    this.selected = new Set([...this.selected].filter((id) => this.known.has(id)));
    const category = this.el<HTMLSelectElement>('cache-category'),
      selected = category.value;
    category.replaceChildren(
      new Option('全部分类', ''),
      ...(catalog.categories ?? []).map((c) => new Option(c.name, c.id)),
    );
    category.value = selected;
    this.groups();
    this.renderChoices();
    const resources = document.getElementById('desktop-resources');
    if (resources && !document.getElementById('resource-story-cache')) {
      const button = node('button', '管理剧情缓存');
      button.id = 'resource-story-cache';
      button.onclick = () => this.open();
      resources.querySelector('.desktop-heading-actions')!.append(button);
    }
    if (this.visible) this.activate();
    else void this.refresh();
  }
  private groups() {
    const category = this.el<HTMLSelectElement>('cache-category').value,
      group = this.el<HTMLSelectElement>('cache-group'),
      selected = group.value;
    group.replaceChildren(
      new Option('全部章节', ''),
      ...(this.catalog.groups ?? [])
        .filter((g) => !category || g.category === category)
        .map((g) => new Option(g.name, g.id)),
    );
    group.value = selected;
    if (group.selectedIndex < 0) group.selectedIndex = 0;
  }
  private filtered(): CatalogStory[] {
    const category = this.el<HTMLSelectElement>('cache-category').value,
      group = this.el<HTMLSelectElement>('cache-group').value,
      query = this.el<HTMLInputElement>('cache-search').value.trim().toLocaleLowerCase();
    return this.catalog.stories.filter(
      (row) =>
        (!category || row.category === category) &&
        (!group || row.groupId === group) &&
        (!query ||
          [row.label, row.groupName, row.title, row.code, row.tag]
            .join(' ')
            .toLocaleLowerCase()
            .includes(query)),
    );
  }
  private renderChoices() {
    const rows = this.filtered(),
      list = this.el('cache-story-list'),
      scroll = list.scrollTop;
    list.replaceChildren();
    for (const story of rows) {
      const label = node('label', '', 'cache-choice'),
        check = node('input');
      check.type = 'checkbox';
      check.checked = this.selected.has(story.id);
      check.dataset.cacheStory = story.id;
      check.setAttribute('aria-label', story.label);
      const text = node('span', story.label),
        badge = node('small', this.cached.has(story.id) ? '已缓存' : '按需加载');
      badge.dataset.cacheBadge = story.id;
      text.title = story.label;
      check.onchange = () => {
        if (check.checked) this.selected.add(story.id);
        else this.selected.delete(story.id);
        this.controls();
      };
      label.append(check, text, badge);
      list.append(label);
    }
    if (!rows.length) list.append(node('p', '没有匹配的剧情', 'cache-empty'));
    list.scrollTop = scroll;
    this.el('cache-filter-count').textContent = `当前筛选 ${rows.length} 段`;
    this.controls();
  }
  private controls() {
    const running = !!this.data.job?.running;
    const badge = this.el('library-tab-cache').querySelector<HTMLElement>('.library-tab-count')!;
    badge.textContent = running ? '进行中' : String(this.cached.size);
    badge.classList.toggle('is-working', running);
    this.el('library-tab-cache').title = running
      ? `已缓存 ${this.data.job!.completed} / ${this.data.job!.total} 段`
      : '管理剧情缓存';
    this.el('cache-overview-count').textContent = `已缓存 ${this.cached.size} 段剧情`;
    this.single.disabled = this.busy || running || !this.current;
    this.single.textContent = this.cached.has(this.current) ? '已缓存 · 检查' : '缓存本段';
    this.el<HTMLButtonElement>('cache-start').disabled =
      this.busy || running || !this.selected.size;
    this.el('cache-selection-count').textContent = this.el('cache-queue-panel').hidden
      ? `已选 ${this.selected.size} 段`
      : `${this.data.job ? `任务共 ${this.data.job.total} 段 · ` : ''}切换页签后仍会继续缓存`;
    const retry =
      !!this.data.job &&
      !running &&
      this.data.job.items.some(
        (row) => this.known.has(row.id) && (row.state !== 'completed' || !this.cached.has(row.id)),
      );
    this.el('cache-resume').hidden = !retry;
    this.el<HTMLButtonElement>('cache-resume').disabled = this.busy;
    this.el('cache-cancel').hidden = !running;
    this.el<HTMLButtonElement>('cache-cancel').disabled =
      this.busy || this.data.job?.state === 'cancelling';
  }
  private tab(queue: boolean) {
    this.el('cache-select-panel').hidden = queue;
    this.el('cache-queue-panel').hidden = !queue;
    this.el('cache-select-tab').setAttribute('aria-pressed', String(!queue));
    this.el('cache-queue-tab').setAttribute('aria-pressed', String(queue));
    this.el('cache-start').hidden = queue;
    this.controls();
    if (queue) this.renderTask();
    try {
      localStorage.setItem('arkreader.cacheView', queue ? 'queue' : 'select');
    } catch {}
  }
  private get visible() {
    return !this.el('library-cache').hidden && !this.el('intro').hidden;
  }
  private activate() {
    if (!this.scopeInitialized && this.catalog.stories.length) {
      const current = this.scope();
      this.el<HTMLSelectElement>('cache-category').value = current.category;
      this.groups();
      this.el<HTMLSelectElement>('cache-group').value = current.group;
      this.renderChoices();
      this.scopeInitialized = true;
    }
    this.renderTask();
    void this.refresh();
  }
  private open() {
    document.dispatchEvent(new Event('arkreader-show-library'));
    document.dispatchEvent(new Event('arkreader-show-cache'));
  }
  private error(error: unknown) {
    const message = String(error).replace(/^Error: /, '');
    this.el('cache-error').textContent = message;
    this.el('cache-error').hidden = false;
  }
  private async start(ids: string[]) {
    if (!ids.length || this.busy || this.data.job?.running) return;
    this.busy = true;
    this.el('cache-error').hidden = true;
    this.controls();
    try {
      const label =
        ids.length === 1
          ? (this.catalog.stories.find((row) => row.id === ids[0])?.label ?? ids[0])
          : `已选择 ${ids.length} 段剧情。`;
      if (
        !(await confirmAction(
          '缓存所选剧情？',
          `${label}\n将下载所需资源，已缓存的资源会复用。`,
          '开始缓存',
        ))
      )
        return;
      this.open();
      this.tab(true);
      await resourceRequest('/api/story-cache', { stories: ids });
      await this.refresh();
    } catch (error) {
      this.error(error);
    } finally {
      this.busy = false;
      this.controls();
    }
  }
  private async cancel() {
    const job = this.data.job;
    if (!job?.running || this.busy) return;
    this.busy = true;
    this.controls();
    try {
      if (!(await confirmAction('取消缓存任务？', '已下载的资源会保留，可稍后继续。', '取消缓存')))
        return;
      if (!this.data.job?.running || this.data.job.id !== job.id) return;
      await resourceRequest(`/api/operations/${job.id}/cancel`, {});
      await this.refresh();
    } catch (error) {
      this.error(error);
    } finally {
      this.busy = false;
      this.controls();
    }
  }
  private resume() {
    const ids =
      this.data.job?.items
        .filter(
          (row) =>
            this.known.has(row.id) && (row.state !== 'completed' || !this.cached.has(row.id)),
        )
        .map((row) => row.id) ?? [];
    return this.start(ids);
  }
  private async refresh() {
    while (this.refreshing) await this.refreshing;
    let settled!: () => void;
    this.refreshing = new Promise<void>((resolve) => {
      settled = resolve;
    });
    clearTimeout(this.timer);
    try {
      const wasRunning = this.data.job?.running;
      this.data = await resourceRequest<CacheStatus>('/api/story-cache');
      const next = new Set(this.data.cached);
      if (wasRunning && !this.data.job?.running)
        document.dispatchEvent(new Event('arkreader-cache-finished'));
      if (next.size !== this.cached.size || [...next].some((id) => !this.cached.has(id))) {
        this.cached = next;
        this.changed(next);
        for (const badge of this.root.querySelectorAll<HTMLElement>('[data-cache-badge]'))
          badge.textContent = next.has(badge.dataset.cacheBadge!) ? '已缓存' : '按需加载';
      }
      this.renderTask();
      this.controls();
    } catch (error) {
      if (this.visible) this.error(error);
    } finally {
      this.refreshing = undefined;
      settled();
      if (this.data.job?.running) this.timer = setTimeout(() => void this.refresh(), 500);
    }
  }
  private renderTask() {
    const job = this.data.job;
    if (!job) {
      this.el('cache-task-detail').textContent = this.busy
        ? '正在提交缓存任务…'
        : '尚无缓存任务。选择需要的剧情后开始缓存。';
      return;
    }
    const cancelled = ['paused', 'cancelled'].includes(job.state),
      title = job.running
        ? job.state === 'cancelling'
          ? '正在取消缓存'
          : '正在缓存剧情'
        : job.state === 'outdated'
          ? '缓存待校验'
          : cancelled
            ? '缓存已暂停'
            : job.failed
              ? '部分剧情未缓存'
              : job.state === 'failed'
                ? '缓存未完成'
                : '剧情缓存完成';
    const detail = `已缓存 ${job.completed} / ${job.total} 段${job.failed ? ` · 失败 ${job.failed} 段` : ''}`;
    const transfers = job.transfers,
      rate = transferSpeed(transfers?.bytesPerSecond),
      progress = job.overallProgress ?? (job.state === 'completed' ? 1 : 0);
    if (!this.visible || this.el('cache-queue-panel').hidden) return;
    const root = this.el('cache-task-detail');
    root.replaceChildren(
      node('h3', title),
      node('p', `${detail} · 总进度 ${Math.floor(progress * 100)}%`),
    );
    const bar = node('progress');
    bar.max = 1;
    bar.value = progress;
    bar.setAttribute('aria-label', '缓存总进度');
    root.append(bar, node('p', job.current || job.message || ''));
    if (transfers)
      root.append(
        node(
          'small',
          `${rate} · 已下载 ${bytes(transfers.downloadedBytes)} · 资源就绪 ${transfers.readyFiles} / ${transfers.totalFiles} · 已缓存 ${transfers.cachedFiles} · 并发 ${transfers.activeDownloads} / 4`,
        ),
      );
    root.append(node('p', '取消后会保留已下载的资源。', 'cache-note'));
    renderTransfers(this.el('cache-task-transfers'), transfers);
    const list = this.el('cache-task-items'),
      scroll = list.scrollTop;
    list.replaceChildren();
    const names: Record<string, string> = {
      pending: '待缓存',
      planning: '分析资源',
      downloading: '等待资源就绪',
      completed: '已缓存',
      failed: '失败',
    };
    for (const item of job.items) {
      const row = node('div', '', 'cache-result');
      row.dataset.cacheResult = item.id;
      row.dataset.state = item.state;
      row.append(node('span', item.label), node('strong', names[item.state] ?? item.state));
      if (item.error) row.append(node('small', item.error));
      list.append(row);
    }
    list.scrollTop = scroll;
  }
}
