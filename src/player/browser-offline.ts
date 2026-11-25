/** Browser delivery for an already exported, self-contained story collection. */
export function mountBrowserOffline(parent: HTMLElement): void {
  const section = document.createElement('div');
  section.className = 'browser-offline';
  section.innerHTML =
    '<button id="offline-save">保存到此设备</button><button id="offline-remove" hidden>删除离线副本</button><p id="offline-status" role="status"></p>';
  parent.append(section);
  const save = section.querySelector<HTMLButtonElement>('#offline-save')!;
  const remove = section.querySelector<HTMLButtonElement>('#offline-remove')!;
  const status = section.querySelector<HTMLElement>('#offline-status')!;
  const base = new URL('./', location.href).href,
    prefix = 'arkreader-offline:' + encodeURIComponent(base) + ':';
  if (!isSecureContext || !('serviceWorker' in navigator) || !('caches' in window)) {
    save.disabled = true;
    status.textContent = '当前地址无法保存离线副本，仍可在线播放。';
    return;
  }
  let busy = false;
  const registration = async () => {
    const result = await navigator.serviceWorker.getRegistration(base);
    return result?.scope === base ? result : undefined;
  };
  const refresh = async () => {
    const reg = await registration();
    const stored = (await caches.keys()).some((name) => name.startsWith(prefix));
    remove.hidden = !stored;
    if (reg?.waiting && stored)
      status.textContent = '新版本已保存。关闭本包的所有页面后重新打开，即可使用新版本。';
    else if (reg?.active && stored)
      status.textContent = '已保存，可断网重新打开此地址。浏览器清理网站数据会删除离线副本。';
    else status.textContent = '保存本包全部剧情后，可断网重新打开此地址播放。';
  };
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (busy && event.data?.type === 'arkreader-save' && event.data.scope === base)
      status.textContent = `正在保存 ${event.data.done} / ${event.data.total}…请保持页面打开。`;
  });
  save.onclick = async () => {
    busy = true;
    save.disabled = remove.disabled = true;
    status.textContent = '正在检查离线副本…';
    try {
      // Request durable storage when available; refusal must not block playback.
      void navigator.storage?.persist?.().catch(() => false);
      const reg = await navigator.serviceWorker.register('./offline-worker.js', {
        scope: './',
        updateViaCache: 'none',
      });
      await reg.update();
      const worker = reg.installing;
      if (worker)
        await new Promise<void>((resolve, reject) => {
          const check = () => {
            if (['installed', 'activating', 'activated'].includes(worker.state)) {
              worker.removeEventListener('statechange', check);
              resolve();
            } else if (worker.state === 'redundant') {
              worker.removeEventListener('statechange', check);
              reject(new Error('download'));
            }
          };
          worker.addEventListener('statechange', check);
          check();
        });
      if (!reg.active && !reg.waiting) await navigator.serviceWorker.ready;
      await refresh();
    } catch {
      status.textContent = '保存失败，请检查网络和存储空间后重试。已保存的副本不受影响。';
      remove.hidden = !(await caches.keys()).some((name) => name.startsWith(prefix));
    } finally {
      busy = false;
      save.disabled = remove.disabled = false;
    }
  };
  remove.onclick = async () => {
    save.disabled = remove.disabled = true;
    try {
      await (await registration())?.unregister();
      for (const name of await caches.keys())
        if (name.startsWith(prefix)) await caches.delete(name);
      remove.hidden = true;
      status.textContent = '离线副本已删除，再次打开时需要联网。';
    } catch {
      status.textContent = '删除失败，请重试。';
    } finally {
      save.disabled = remove.disabled = false;
    }
  };
  void refresh().catch(() => {
    status.textContent = '无法读取离线存储状态，仍可尝试保存。';
  });
}
