import './version-notice.css';

export interface ResourceUpdate {
  state: string;
  currentVersion?: string;
  clientVersion?: string;
  officialVersion?: string;
  officialClientVersion?: string;
  message?: string;
  error?: string;
  warning?: string;
  checkedAt?: number;
  baseline: { platform: string; resourceVersion: string; clientVersion: string };
}
const el = (tag: string, text = '', cls = '') => {
  const node = document.createElement(tag);
  node.textContent = text;
  node.className = cls;
  return node;
};
export class VersionNotice {
  private banner = document.createElement('aside');
  private content = document.createElement('div');
  private dismissed = false;
  constructor(
    private resources: HTMLElement,
    show: () => void,
  ) {
    this.banner.id = 'version-notice';
    this.banner.className = 'version-notice';
    this.banner.hidden = true;
    this.banner.setAttribute('role', 'status');
    const detail = document.createElement('button');
    detail.textContent = '查看版本';
    detail.onclick = show;
    const close = document.createElement('button');
    close.textContent = '知道了';
    close.onclick = () => {
      this.dismissed = true;
      this.banner.hidden = true;
    };
    this.banner.append(this.content, detail, close);
    document.querySelector('.library-tabs')!.after(this.banner);
    const card = el('article', '', 'desktop-card');
    card.id = 'resource-version-card';
    resources.querySelector('.desktop-storage-grid')!.after(card);
  }
  update(update: ResourceUpdate | undefined) {
    if (!update) return;
    const b = update.baseline,
      current = update.currentVersion ?? '尚未初始化',
      official = update.officialVersion ?? '本次未取得';
    const card = document.getElementById('resource-version-card')!;
    card.replaceChildren(el('h2', '资源版本'));
    const list = el('dl', '', 'resource-version-list');
    for (const [label, value] of [
      ['当前资源', current],
      ['当前客户端', update.clientVersion ?? '—'],
      ['来源最新资源', official],
      ['来源最新客户端', update.officialClientVersion ?? '本次未取得'],
      [`已适配资源（${b.platform}）`, b.resourceVersion],
      ['已适配客户端', b.clientVersion],
    ]) {
      const row = el('div');
      row.append(el('dt', label), el('dd', value));
      list.append(row);
    }
    card.append(list, el('p', update.message ?? '每次启动自动检查官方最新资源。'));
    if (update.checkedAt)
      card.append(
        el('small', '本次检查：' + new Date(update.checkedAt * 1000).toLocaleString('zh-CN')),
      );
    if (update.warning) card.append(el('p', update.warning, 'version-warning-text'));
    if (update.error) {
      const details = document.createElement('details');
      details.append(el('summary', '查看更新详情'), el('p', update.error));
      card.append(details);
    }
    const message = update.warning || (update.state === 'offline' ? update.message : '');
    this.content.replaceChildren(
      el('strong', update.warning ? '资源版本适配提醒' : '本次使用缓存资源'),
      el('p', message ?? ''),
    );
    if (update.warning)
      this.content.append(el('small', `资源平台 ${b.platform} · 适配基线 ${b.resourceVersion}`));
    this.banner.hidden = !message || this.dismissed;
  }
}
