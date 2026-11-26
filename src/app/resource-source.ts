import { appInvoke, isWeb } from './platform';
import { resourceRequest } from './resource-api';
import { syncApplicationControl } from './native-controls';
import './resource-source.css';

export function mountResourceSource(parent: Element): void {
  if (isWeb) return;
  const form = document.createElement('form');
  form.className = 'resource-source';
  form.innerHTML = `<label>资源来源 <select aria-label="资源来源"><option value="official">官方</option><option value="prts">PRTS</option></select></label><button type="submit" disabled>切换并重新加载</button><span role="status"></span>`;
  const select = form.querySelector('select')!;
  const button = form.querySelector('button')!;
  const message = form.querySelector('span')!;
  let current = '',
    running = false;
  parent.append(form);
  const sync = () => {
    button.disabled = running || !current || select.value === current;
    select.disabled = running;
    syncApplicationControl(select);
  };
  select.onchange = sync;
  void resourceRequest<{ resourceSource: string }>('/api/status')
    .then((status) => {
      current = select.value = status.resourceSource;
      syncApplicationControl(select);
      sync();
    })
    .catch((error) => {
      message.textContent = String(error);
    });
  form.onsubmit = (event) => {
    event.preventDefault();
    if (button.disabled) return;
    running = true;
    const chosen = select.value;
    sync();
    message.textContent = '';
    void resourceRequest('/api/resource-source', { source: chosen })
      .then(async () => {
        current = chosen;
        if (document.getElementById('startup-root'))
          document.dispatchEvent(new Event('arkreader-resource-source-changed'));
        else await appInvoke('app_retry');
      })
      .catch((error) => {
        message.textContent = String(error).replace(/^Error: /, '');
      })
      .finally(() => {
        running = false;
        sync();
      });
  };
}
