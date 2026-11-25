import {
  emptyOperatorFilters,
  normalizeOperatorFilters,
  operatorMatches,
  operatorFilterCount,
  type OperatorFilterOptions,
  type OperatorFilters,
  type OperatorMetadata,
} from './operator-filter-model';
import './operator-filter.css';

type Field = 'rarities' | 'professions' | 'positions' | 'factions';
const element = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') => {
  const node = document.createElement(tag);
  node.className = cls;
  node.textContent = text;
  return node;
};
export class OperatorFilterView {
  readonly button = document.createElement('button');
  readonly dialog = document.createElement('dialog');
  private options?: OperatorFilterOptions;
  private current = emptyOperatorFilters();
  private draft = emptyOperatorFilters();
  private candidates: OperatorMetadata[] = [];
  private preview: HTMLElement;
  private factionSearch: HTMLInputElement;
  constructor(
    private onChange: () => void,
    private getCandidates: () => OperatorMetadata[],
  ) {
    this.button.type = 'button';
    this.button.id = 'operator-filter-toggle';
    this.button.textContent = '筛选干员';
    this.button.hidden = true;
    this.button.setAttribute('aria-haspopup', 'dialog');
    this.button.setAttribute('aria-controls', 'operator-filter-dialog');
    this.button.onclick = () => this.open();
    this.dialog.id = 'operator-filter-dialog';
    this.dialog.className = 'operator-filter-dialog';
    this.dialog.setAttribute('aria-labelledby', 'operator-filter-title');
    this.dialog.innerHTML = /* HTML */ `<header>
        <div>
          <h2 id="operator-filter-title">干员筛选</h2>
          <p>可同时选择多个星级、职业和阵营。</p>
        </div>
        <button type="button" data-action="cancel" aria-label="关闭筛选">×</button>
      </header>
      <div class="operator-filter-content">
        <div id="operator-filter-basic"></div>
        <fieldset class="faction-field">
          <legend>阵营</legend>
          <div class="faction-tools">
            <input
              id="faction-search"
              type="search"
              placeholder="查找国家、组织或小队"
              aria-label="查找阵营"
            /><label><input id="include-secondary" type="checkbox" />包括副势力</label
            ><button type="button" data-unlimited="factions">不限</button>
          </div>
          <div id="operator-faction-list"></div>
        </fieldset>
      </div>
      <footer>
        <button type="button" data-action="reset">重置全部</button
        ><span id="operator-filter-preview" role="status"></span
        ><button type="button" data-action="cancel">取消</button
        ><button type="button" data-action="apply">应用筛选</button>
      </footer>`;
    this.preview = this.dialog.querySelector('#operator-filter-preview')!;
    this.factionSearch = this.dialog.querySelector('#faction-search')!;
    document.getElementById('app')!.append(this.dialog);
    for (const button of this.dialog.querySelectorAll<HTMLButtonElement>('[data-action=cancel]'))
      button.onclick = () => this.dialog.close();
    this.dialog.querySelector<HTMLButtonElement>('[data-action=reset]')!.onclick = () => {
      this.draft = emptyOperatorFilters();
      this.factionSearch.value = '';
      this.refresh();
    };
    this.dialog.querySelector<HTMLButtonElement>('[data-action=apply]')!.onclick = () => {
      this.current = normalizeOperatorFilters(this.draft, this.options!);
      this.persist();
      this.dialog.close();
      this.updateButton();
      this.onChange();
    };
    this.dialog.querySelector<HTMLInputElement>('#include-secondary')!.onchange = (event) => {
      this.draft.includeSecondary = (event.target as HTMLInputElement).checked;
      this.refresh();
    };
    this.dialog.querySelector<HTMLButtonElement>('[data-unlimited=factions]')!.onclick = () => {
      this.draft.factions = [];
      this.refresh();
    };
    this.factionSearch.oninput = () => this.refresh();
    this.dialog.addEventListener('click', (event) => {
      if (event.target === this.dialog) {
        const r = this.dialog.getBoundingClientRect();
        if (
          event.clientX < r.left ||
          event.clientX > r.right ||
          event.clientY < r.top ||
          event.clientY > r.bottom
        )
          this.dialog.close();
      }
    });
  }
  configure(options: OperatorFilterOptions | undefined) {
    this.options = options;
    if (!options) return;
    let saved: unknown;
    try {
      saved = JSON.parse(localStorage.getItem('arkreader.operatorFilters') ?? 'null');
    } catch {}
    this.current = normalizeOperatorFilters(saved ?? this.current, options);
    this.persist();
    this.updateButton();
  }
  setVisible(visible: boolean) {
    this.button.hidden = !visible || !this.options;
  }
  get activeCount() {
    return operatorFilterCount(this.current);
  }
  matches(operator?: OperatorMetadata) {
    return operatorMatches(operator, this.current);
  }
  clear() {
    this.current = emptyOperatorFilters();
    this.persist();
    this.updateButton();
    this.onChange();
  }
  private persist() {
    try {
      localStorage.setItem('arkreader.operatorFilters', JSON.stringify(this.current));
    } catch {}
  }
  private updateButton() {
    const count = this.activeCount;
    this.button.textContent = count ? `筛选干员 · ${count}` : '筛选干员';
    this.button.classList.toggle('has-filters', count > 0);
  }
  private open() {
    if (!this.options) return;
    this.draft = normalizeOperatorFilters(this.current, this.options);
    this.candidates = this.getCandidates();
    this.factionSearch.value = '';
    const basic = this.dialog.querySelector('#operator-filter-basic')!;
    basic.replaceChildren();
    for (const [key, title, choices] of [
      ['rarities', '星级', this.options.rarities.map((id) => ({ id, name: `${id}★` }))],
      ['professions', '职业', this.options.professions],
      ['positions', '部署位置', this.options.positions],
    ] as const) {
      const field = element('fieldset'),
        legend = element('legend', '', title),
        all = element('button', 'filter-unlimited', '不限');
      all.type = 'button';
      all.dataset.unlimited = key;
      all.onclick = () => {
        this.draft[key] = [];
        this.refresh();
      };
      legend.append(all);
      field.append(legend);
      const list = element('div', 'filter-choices');
      for (const choice of choices) list.append(this.choice(key, choice.id, choice.name));
      field.append(list);
      basic.append(field);
    }
    const list = this.dialog.querySelector('#operator-faction-list')!;
    list.replaceChildren();
    for (const [level, title] of ['国家与势力', '组织', '小队'].entries()) {
      const group = element('section', 'faction-level');
      group.append(element('h3', '', title));
      const choices = element('div', 'filter-choices');
      for (const faction of this.options.factions.filter((row) => row.level === level))
        choices.append(this.choice('factions', faction.id, faction.name));
      if (choices.childElementCount) {
        group.append(choices);
        list.append(group);
      }
    }
    this.refresh();
    this.dialog.showModal();
  }
  private choice(field: Field, id: number | string, name: string): HTMLElement {
    const label = element('label', 'filter-chip');
    label.dataset.filterField = field;
    label.dataset.filterValue = String(id);
    label.dataset.filterName = name;
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('aria-label', name);
    const text = element('span', '', name),
      count = element('small', 'filter-count');
    input.onchange = () => {
      const values = this.draft[field] as (number | string)[];
      const updated = input.checked ? [...values, id] : values.filter((value) => value !== id);
      if (field === 'factions') this.draft.factions = updated as string[];
      else this.draft[field] = updated as number[];
      this.refresh();
    };
    label.append(input, text, count);
    return label;
  }
  private refresh() {
    const query = this.factionSearch.value.trim().toLocaleLowerCase();
    for (const label of this.dialog.querySelectorAll<HTMLElement>('[data-filter-field]')) {
      const field = label.dataset.filterField as Field,
        id = field === 'factions' ? label.dataset.filterValue! : Number(label.dataset.filterValue);
      label.querySelector<HTMLInputElement>('input')!.checked = (
        this.draft[field] as (number | string)[]
      ).includes(id);
      const probe = { ...this.draft, [field]: [id] };
      const count = this.candidates.filter((operator) => operatorMatches(operator, probe)).length;
      label.querySelector('.filter-count')!.textContent = String(count);
      label.classList.toggle('no-matches', count === 0);
      label.hidden =
        field === 'factions' &&
        !!query &&
        !label.dataset.filterName!.toLocaleLowerCase().includes(query);
    }
    for (const group of this.dialog.querySelectorAll<HTMLElement>('.faction-level'))
      group.hidden = ![...group.querySelectorAll<HTMLElement>('.filter-chip')].some(
        (label) => !label.hidden,
      );
    for (const button of this.dialog.querySelectorAll<HTMLButtonElement>('[data-unlimited]'))
      button.setAttribute(
        'aria-pressed',
        String(!this.draft[button.dataset.unlimited as Field].length),
      );
    this.dialog.querySelector<HTMLInputElement>('#include-secondary')!.checked =
      this.draft.includeSecondary;
    this.preview.textContent = `匹配 ${this.candidates.filter((operator) => operatorMatches(operator, this.draft)).length} / ${this.candidates.length} 名干员`;
  }
}
