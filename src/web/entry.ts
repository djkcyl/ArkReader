import { installWebBridge } from './bridge';
import { mountStartupDownloads } from '../app/download-page';

document.body.classList.add('web-app');
mountStartupDownloads();
document.getElementById('quit')!.hidden = true;
try {
  if (typeof AudioContext === 'undefined')
    throw Error('当前浏览器无法播放声音，请更新或更换浏览器。');
  if (await installWebBridge()) await import('../app/startup');
} catch (error) {
  document.body.dataset.state = 'error';
  document.getElementById('startup-heading')!.textContent = '暂时无法启动';
  document.getElementById('status')!.textContent = String(error).replace(/^Error: /, '');
  const retry = document.getElementById('retry')!;
  retry.hidden = false;
  retry.onclick = () => location.reload();
}
