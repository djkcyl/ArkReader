import type { TransferSummary } from './resource-api';
import { loadingProgress, type LoadingState } from './loading-progress';
import './qol.css';
import { resourceLabel, transferSpeed, renderTransfers } from './transfer-labels';
import type { ScriptCompatibility } from '../core/script-compatibility';

export class LoadingView {
  readonly root = document.createElement('section');
  private started = 0;
  private timer?: ReturnType<typeof setInterval>;
  private cancel = () => {};
  private progress = 0;
  private step = 0;
  private transfers?: TransferSummary;
  constructor() {
    this.root.id = 'app-loading';
    this.root.className = 'app-loading';
    this.root.hidden = true;
    this.root.setAttribute('aria-label', '准备剧情');
    this.root.innerHTML = /* HTML */ `<div class="loading-card">
      <div class="loading-content">
        <div class="loading-heading">
          <span class="loading-kicker">PREPARING STORY</span>
          <h2 id="load-story-title"></h2>
          <ol class="load-steps">
            <li>播放界面</li>
            <li>剧情资源</li>
            <li>画面与声音</li>
            <li>开始阅读</li>
          </ol>
        </div>
        <div class="loading-status">
          <div class="load-status-row">
            <p id="load-message" role="status">正在准备…</p>
            <span id="load-elapsed"></span>
          </div>
          <div class="load-total-heading">
            <span>总准备进度</span><strong id="load-percent">0%</strong>
          </div>
          <progress id="load-progress" max="1" value="0" aria-label="总准备进度"></progress>
          <p id="load-detail"></p>
          <p id="load-transfer-summary"></p>
          <div id="load-transfers" aria-label="当前并发下载" hidden></div>
          <p id="load-hint" hidden></p>
          <details id="load-error-details" hidden>
            <summary>查看错误详情</summary>
            <pre id="load-error"></pre>
          </details>
        </div>
      </div>
      <div class="load-actions">
        <button id="load-retry" hidden>重新尝试</button><button id="load-cancel">取消加载</button>
      </div>
    </div>`;
    document.getElementById('app')!.append(this.root);
    const current = document.createElement('p');
    current.id = 'load-resource';
    this.el('load-message').parentElement!.after(current);
    this.button('load-cancel').onclick = () => this.cancel();
    document.addEventListener(
      'keydown',
      (event) => {
        if (event.code === 'Escape' && !this.root.hidden) {
          event.preventDefault();
          event.stopImmediatePropagation();
          this.cancel();
        }
      },
      true,
    );
  }
  private el(id: string) {
    return this.root.querySelector<HTMLElement>('#' + id)!;
  }
  private button(id: string) {
    return this.el(id) as HTMLButtonElement;
  }
  show(title: string, cancel: () => void, aboveFullscreen = false) {
    this.cancel = cancel;
    this.started = performance.now();
    this.root.hidden = false;
    this.root.classList.remove('load-failed');
    this.progress = 0;
    this.step = 0;
    this.transfers = undefined;
    if (aboveFullscreen && typeof this.root.showPopover === 'function') {
      this.root.setAttribute('popover', 'manual');
      this.root.classList.add('loading-fullscreen');
      this.root.showPopover();
    }
    document.body.classList.add('resource-loading');
    document.querySelector('main')!.inert = true;
    this.el('load-story-title').textContent = title;
    this.el('load-error-details').hidden = true;
    this.button('load-retry').hidden = true;
    this.button('load-cancel').textContent = '取消加载';
    this.el('load-hint').hidden = true;
    this.el('load-hint').textContent = '';
    (this.el('load-error-details') as HTMLDetailsElement).open = false;
    this.update({ phase: 'queue', message: '正在准备播放…', done: 0, total: 0 });
    this.root.querySelector('.loading-content')!.scrollTop = 0;
    clearInterval(this.timer);
    this.timer = setInterval(() => {
      this.el('load-elapsed').textContent =
        `${((performance.now() - this.started) / 1000).toFixed(1)} 秒`;
    }, 100);
    this.button('load-cancel').focus();
  }
  update(state: LoadingState) {
    if (this.root.hidden) return;
    const index = ['started', 'seek'].includes(state.phase)
      ? 3
      : ['decode', 'ready'].includes(state.phase)
        ? 2
        : ['resources', 'download', 'convert', 'verify'].includes(state.phase)
          ? 1
          : 0;
    this.step = Math.max(this.step, index);
    this.root.querySelectorAll('.load-steps li').forEach((el, i) => {
      el.classList.toggle('current', i === this.step);
      el.classList.toggle('done', i < this.step);
    });
    this.el('load-message').textContent = state.message;
    this.el('load-resource').textContent = state.resource ? resourceLabel(state.resource) : '';
    this.el('load-resource').title = state.resource ?? '';
    const progress = this.el('load-progress') as HTMLProgressElement;
    this.progress = loadingProgress(this.progress, state);
    progress.value = this.progress;
    this.el('load-percent').textContent = `${Math.floor(this.progress * 100)}%`;
    if (state.transfers) this.transfers = state.transfers;
    const transfers = this.transfers;
    this.el('load-detail').textContent =
      state.phase === 'seek'
        ? `跳转进度 ${state.done}% · 正在恢复画面与分支`
        : state.phase === 'decode'
          ? `画面与声音：${state.done} / ${state.total} 项`
          : transfers?.totalFiles
            ? `资源已就绪 ${transfers.readyFiles} / ${transfers.totalFiles} · 已缓存 ${transfers.cachedFiles} 个`
            : state.total
              ? `已完成 ${state.done} / ${state.total} 项`
              : '正在统计所需资源…';
    this.el('load-transfer-summary').textContent = transfers?.totalFiles
      ? `${transferSpeed(transfers.bytesPerSecond)} · 累计下载 ${(transfers.downloadedBytes / 1048576).toFixed(1)} MB · 并发 ${transfers.activeDownloads} / 4`
      : '';
    renderTransfers(this.el('load-transfers'), transfers);
    if (state.phase === 'seek') {
      this.el('load-transfer-summary').textContent = '';
      this.el('load-transfers').hidden = true;
    }
  }
  fail(error: unknown, retry: () => void) {
    clearInterval(this.timer);
    this.root.classList.add('load-failed');
    this.el('load-message').textContent = '这段剧情暂时未能打开';
    this.el('load-transfers').hidden = true;
    this.el('load-detail').textContent = '已下载的资源会保留，可以重试。';
    this.el('load-hint').hidden = true;
    this.el('load-error-details').hidden = false;
    this.el('load-error').textContent = String(error).replace(/^Error: /, '');
    this.button('load-cancel').textContent = '返回剧情库';
    this.button('load-retry').hidden = false;
    this.button('load-retry').onclick = retry;
  }
  incompatible(report: ScriptCompatibility) {
    this.fail(
      new Error(
        report.issues
          .map(
            (issue) =>
              `${issue.line ? `第 ${issue.line} 行 · ` : ''}${issue.feature}\n${issue.reason}`,
          )
          .join('\n\n'),
      ),
      () => {},
    );
    this.el('load-message').textContent = '这段剧情包含尚未适配的功能';
    this.el('load-detail').textContent = `发现 ${report.issues.length} 项不兼容内容。`;
    this.el('load-resource').textContent = report.resourceVersion
      ? `资源版本 ${report.resourceVersion}`
      : '';
    this.el('load-hint').hidden = false;
    this.el('load-hint').textContent =
      '请更新到最新版 ArkReader 后再试。已支持的其他剧情仍可播放。';
    (this.el('load-error-details') as HTMLDetailsElement).open = false;
    this.button('load-retry').hidden = true;
  }
  close() {
    clearInterval(this.timer);
    if (this.root.hasAttribute('popover') && this.root.matches(':popover-open'))
      this.root.hidePopover();
    this.root.removeAttribute('popover');
    this.root.classList.remove('loading-fullscreen');
    this.root.hidden = true;
    document.body.classList.remove('resource-loading');
    document.querySelector('main')!.inert = false;
    document.dispatchEvent(new Event('arkreader-resource-idle'));
  }
}
