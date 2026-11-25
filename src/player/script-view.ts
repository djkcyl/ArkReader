import type { StoryPlayer } from './runtime';
import { scriptRows, type ScriptRow } from './script-document';
import './script-view.css';
import { quickSpeeds } from '../core/quick-play';
import { readableTokens, type ScriptToken } from './script-tokens';

export class ScriptView {
  private panel = document.createElement('aside');
  private list = document.createElement('div');
  private status = document.createElement('span');
  private follow = document.createElement('button');
  private readableButton = document.createElement('button');
  private sourceButton = document.createElement('button');
  private player?: StoryPlayer;
  private document?: ReturnType<typeof scriptRows>;
  private nodes = new Map<number, HTMLElement[]>();
  private counts = new Map<number, number>();
  private opened = false;
  private following = true;
  private source = false;
  private step = -1;
  private index = -1;
  private state = '';
  constructor(
    private surface: HTMLElement,
    private toggle: HTMLButtonElement,
  ) {
    this.panel.id = 'script-panel';
    this.panel.className = 'script-panel';
    this.panel.hidden = true;
    this.panel.setAttribute('aria-label', '剧情脚本');
    const header = document.createElement('header'),
      heading = document.createElement('strong'),
      close = document.createElement('button');
    heading.textContent = '脚本';
    close.textContent = '×';
    close.id = 'script-close';
    close.setAttribute('aria-label', '收起剧情脚本');
    close.onclick = () => this.setOpen(false);
    this.readableButton.textContent = '可读';
    this.sourceButton.textContent = '原文';
    this.readableButton.className = this.sourceButton.className = 'script-mode';
    this.readableButton.onclick = () => this.setSource(false);
    this.sourceButton.onclick = () => this.setSource(true);
    this.follow.textContent = '跟随';
    this.follow.className = 'script-follow';
    this.follow.setAttribute('aria-label', '跟随播放');
    this.follow.onclick = () => {
      this.following = !this.following;
      this.follow.setAttribute('aria-pressed', String(this.following));
      if (this.following) this.scrollCurrent();
    };
    this.status.className = 'script-status';
    header.append(heading, this.readableButton, this.sourceButton, this.status, this.follow, close);
    this.list.className = 'script-list';
    this.list.tabIndex = 0;
    this.list.setAttribute('role', 'list');
    this.list.setAttribute('aria-label', '剧情脚本行');
    const stopFollow = () => {
      this.following = false;
      this.follow.setAttribute('aria-pressed', 'false');
    };
    this.list.addEventListener('wheel', stopFollow, { passive: true });
    this.list.addEventListener('pointerdown', stopFollow, { passive: true });
    this.list.addEventListener('keydown', (event) => {
      if (
        [
          'ArrowUp',
          'ArrowDown',
          'ArrowLeft',
          'ArrowRight',
          'PageUp',
          'PageDown',
          'Home',
          'End',
          ' ',
        ].includes(event.key)
      ) {
        stopFollow();
        event.stopPropagation();
      }
    });
    this.panel.append(header, this.list);
    surface.append(this.panel);
    new ResizeObserver(() => {
      if (this.opened && this.following) this.scrollCurrent();
    }).observe(this.list);
    toggle.setAttribute('aria-controls', this.panel.id);
    toggle.setAttribute('aria-expanded', 'false');
    toggle.title = '显示剧情脚本（F9）';
    toggle.disabled = true;
    toggle.onclick = () => this.setOpen(!this.opened);
    document.addEventListener('keydown', (event) => {
      if (
        event.key !== 'F9' ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        event.isComposing ||
        (document.body.dataset.desktopPage !== undefined &&
          document.body.dataset.desktopPage !== 'library') ||
        !this.player ||
        document.querySelector('dialog[open]')
      )
        return;
      event.preventDefault();
      if (!event.repeat) this.setOpen(!this.opened);
    });
  }
  clear(): void {
    this.player = undefined;
    this.document = undefined;
    this.nodes.clear();
    this.counts.clear();
    this.list.replaceChildren();
    this.status.textContent = '';
    this.toggle.disabled = true;
  }
  close(): void {
    this.setOpen(false);
  }
  private setOpen(open: boolean): void {
    if (open && !this.player) return;
    this.opened = open;
    this.panel.hidden = !open;
    this.toggle.setAttribute('aria-expanded', String(open));
    this.surface.classList.toggle('script-open', open);
    this.surface.closest('#player-panel')?.classList.toggle('script-visible', open);
    this.surface.dispatchEvent(new Event('playback-screen-mode'));
    if (open) {
      this.following = true;
      this.render();
      this.refresh(true);
    } else this.toggle.focus({ preventScroll: true });
  }
  private setSource(source: boolean): void {
    if (this.source === source) return;
    this.source = source;
    this.render();
    this.refresh(true);
  }
  update(player: StoryPlayer): void {
    if (this.player !== player) {
      this.player = player;
      this.document = undefined;
      this.toggle.disabled = false;
      this.step = -1;
      this.index = -1;
      this.state = '';
      if (this.opened) this.render();
    }
    if (this.opened) this.refresh();
  }
  private render(): void {
    const player = this.player;
    if (!player) return;
    this.document ??= scriptRows(
      player.pack.script,
      player.scheduler.commands,
      player.pack.variables,
      player.nickname,
    );
    this.nodes.clear();
    this.counts.clear();
    const fragment = document.createDocumentFragment();
    for (const row of this.source ? this.document.source : this.document.readable) {
      const node = this.row(row);
      fragment.append(node);
      if (row.commandIndex !== undefined) {
        const nodes = this.nodes.get(row.commandIndex) ?? [];
        nodes.push(node);
        this.nodes.set(row.commandIndex, nodes);
      }
    }
    this.list.replaceChildren(fragment);
    this.list.classList.toggle('script-source', this.source);
    this.readableButton.setAttribute('aria-pressed', String(!this.source));
    this.sourceButton.setAttribute('aria-pressed', String(this.source));
    this.follow.setAttribute('aria-pressed', String(this.following));
  }
  private tokens(parent: HTMLElement, tokens: readonly ScriptToken[]): void {
    for (const token of tokens) {
      const span = document.createElement('span');
      span.className = 'script-syntax-' + token.kind;
      span.textContent = token.text;
      parent.append(span);
    }
  }
  private row(row: ScriptRow): HTMLElement {
    const node = document.createElement('div');
    node.className = 'script-row';
    node.setAttribute('role', 'listitem');
    node.dataset.line = String(row.line);
    node.dataset.kind = row.kind ?? 'text';
    if (row.commandIndex !== undefined) node.dataset.commandIndex = String(row.commandIndex);
    const number = document.createElement('span');
    number.className = 'script-line-number';
    number.textContent = row.line
      ? row.endLine > row.line
        ? row.line + '–' + row.endLine
        : String(row.line)
      : '—';
    const content = document.createElement('div');
    content.className = 'script-line-content';
    if (this.source) {
      const code = document.createElement('code');
      this.tokens(code, row.tokens ?? [{ kind: 'text', text: row.raw }]);
      content.append(code);
    } else {
      const title = document.createElement('strong'),
        detail = document.createElement('span');
      title.className = 'script-kind';
      title.textContent = row.title;
      detail.className = 'script-preview';
      const text = row.detail.replace(/\s+/g, ' ');
      this.tokens(
        detail,
        row.kind === 'speaker' || row.kind === 'text'
          ? [{ kind: 'text', text }]
          : readableTokens(text),
      );
      content.append(title, detail);
      for (const origin of ['脚本', '默认', '原版忽略', '此模式不使用'] as const) {
        const parameters = row.parameters?.filter((p) => p.origin === origin);
        if (!parameters?.length) continue;
        const group = document.createElement('span');
        group.className = 'script-inline-parameters';
        if (origin === '原版忽略' || origin === '此模式不使用')
          group.classList.add('script-parameter-unused');
        const prefix = document.createElement('span');
        prefix.className = 'script-parameter-origin';
        prefix.textContent = '  [' + (origin === '脚本' ? '参数' : origin) + ': ';
        group.append(prefix);
        parameters.forEach((parameter, index) => {
          if (index) group.append(document.createTextNode('  '));
          const key = document.createElement('span');
          key.className = 'script-syntax-parameter';
          key.textContent = parameter.label;
          key.title = parameter.key;
          group.append(key, document.createTextNode('='));
          const kind = /^(是|否|true|false)$/.test(parameter.value)
            ? 'boolean'
            : /^-?\d+(?:\.\d+)?$/.test(parameter.value)
              ? 'number'
              : 'string';
          this.tokens(group, [{ kind, text: parameter.value }]);
        });
        group.append(document.createTextNode(']'));
        content.append(group);
      }
    }
    const state = document.createElement('span');
    state.className = 'script-row-state';
    node.append(number, state, content);
    return node;
  }
  private refresh(force = false): void {
    const player = this.player;
    if (!player) return;
    const index = player.scheduler.current ? player.scheduler.index : -1;
    const state = player.error
      ? '播放出错'
      : player.finished
        ? '播放结束'
        : player.paused
          ? '已暂停'
          : player.choices.length
            ? '等待选择'
            : player.quickPlay
              ? `${quickSpeeds[player.quickSpeedIndex].label} 快进`
              : player.auto || player.readerPlayback.auto
                ? '自动播放'
                : player.canBookmark
                  ? '等待推进'
                  : '正在执行';
    if (!force && this.step === player.playbackStep && this.index === index && this.state === state)
      return;
    const moved = this.index !== index;
    this.step = player.playbackStep;
    this.index = index;
    this.state = state;
    for (const [command, count] of player.executedCommands) {
      if (!force && this.counts.get(command) === count) continue;
      this.counts.set(command, count);
      for (const node of this.nodes.get(command) ?? []) {
        node.dataset.visited = 'true';
        node.querySelector('.script-row-state')!.textContent = count > 1 ? String(count) : '·';
      }
    }
    for (const node of this.list.querySelectorAll<HTMLElement>('[aria-current]')) {
      node.removeAttribute('aria-current');
      const count = this.counts.get(Number(node.dataset.commandIndex)) ?? 0;
      node.querySelector('.script-row-state')!.textContent =
        count > 1 ? String(count) : count ? '·' : '';
    }
    for (const node of this.nodes.get(index) ?? []) {
      node.setAttribute('aria-current', 'step');
      node.querySelector('.script-row-state')!.textContent = '›';
    }
    const command = player.scheduler.current;
    this.status.textContent = `${state}${command ? ` · ${command.line ? `第 ${command.line} 行` : '结束标记'}` : ''} · ${player.scheduler.commands.length} 条指令`;
    this.status.title = this.status.textContent;
    if (this.following && (moved || force)) this.scrollCurrent();
  }
  private scrollCurrent(): void {
    const row = this.nodes.get(this.index)?.[0];
    if (!row) return;
    this.list.scrollLeft = 0;
    this.list.scrollTop = Math.max(0, row.offsetTop - this.list.clientHeight * 0.35);
  }
}
