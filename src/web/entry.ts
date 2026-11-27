import { installWebBridge, prepareWebApplication } from './bridge';
import { EntryShell } from './entry-shell';
import { hasCachedLibrary } from './resource-db';

document.body.classList.add('web-app');
document.getElementById('quit')!.hidden = true;
async function boot() {
  let shell: EntryShell | undefined;
  let softwareReady = false;
  const downloads = new URLSearchParams(location.search).get('page') === 'downloads';
  const warm = downloads ? false : await hasCachedLibrary().catch(() => false);
  if (downloads || warm) shell = new EntryShell(downloads ? 'downloads' : 'library', warm);
  const entry = document.querySelector<HTMLAnchorElement>('.startup-download')!;
  entry.onclick = (event) => {
    event.preventDefault();
    shell ??= new EntryShell('downloads', false);
    if (softwareReady) shell.ready();
    shell.show('downloads');
  };
  const status = (message: string) => {
    document.getElementById('status')!.textContent = message;
    shell?.update(message);
  };
  try {
    if (!(await prepareWebApplication(status))) return;
    softwareReady = true;
    shell?.ready();
    if (downloads) await shell!.resourcesRequested;
    if (typeof AudioContext === 'undefined')
      throw Error('当前浏览器无法播放声音，请更新或更换浏览器。');
    status('正在打开资料库…');
    await installWebBridge();
    await import('../app/startup');
  } catch (error) {
    const message = String(error).replace(/^Error: /, '');
    document.body.dataset.state = 'error';
    document.getElementById('startup-heading')!.textContent = '暂时无法启动';
    status(message);
    shell?.fail(message);
    const retry = document.getElementById('retry')!;
    retry.hidden = false;
    retry.onclick = () => location.reload();
  }
}
void boot();
