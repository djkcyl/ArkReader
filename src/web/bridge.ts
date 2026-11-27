interface RequestData {
  path: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}
interface Reply {
  status: number;
  headers: Record<string, string>;
  body: Uint8Array;
}
interface Status {
  job: { id: string; running: boolean; error?: string; state?: string; [key: string]: unknown };
  baseResources: { ready: boolean };
  startupSkinReady: boolean;
  cursorReady: boolean;
  resourceUpdate?: { warning?: string };
}

export async function prepareWebApplication(report: (message: string) => void): Promise<boolean> {
  if (!('serviceWorker' in navigator)) throw Error('请通过 HTTPS 或 localhost 打开网页版。');
  const base = new URL('./', location.href);
  report('正在检查网页更新…');
  const registration = await navigator.serviceWorker.register(new URL('sw.js', base), {
    scope: base.pathname,
    updateViaCache: 'none',
  });
  await registration.update().catch(() => {});
  const candidate = registration.installing ?? registration.waiting ?? registration.active;
  if (candidate && !['activated', 'redundant'].includes(candidate.state)) {
    report('正在更新网页版…');
    await new Promise<void>((resolve) => {
      const settled = () => {
        if (!['activated', 'redundant'].includes(candidate.state)) return;
        candidate.removeEventListener('statechange', settled);
        resolve();
      };
      candidate.addEventListener('statechange', settled);
      settled();
    });
  }
  if (candidate?.state === 'redundant') throw Error('网页更新未完成，请稍后重试。');
  const active = registration.active;
  if (!active) throw Error('网页程序未能准备完成，请重试。');
  if (navigator.serviceWorker.controller !== active)
    await new Promise<void>((resolve) => {
      const controlled = () => {
        if (navigator.serviceWorker.controller !== active) return;
        navigator.serviceWorker.removeEventListener('controllerchange', controlled);
        resolve();
      };
      navigator.serviceWorker.addEventListener('controllerchange', controlled);
      controlled();
    });
  const response = await fetch(new URL('build.json', base));
  if (!response.ok) throw Error('无法读取网页版本，请重试。');
  const { build } = await response.json();
  const current = document.querySelector<HTMLMetaElement>('meta[name="arkreader-build"]')?.content;
  if (build !== current) {
    report('正在切换到新版…');
    location.reload();
    return false;
  }
  return true;
}

export async function installWebBridge(): Promise<void> {
  const base = new URL('./', location.href);
  document.getElementById('status')!.textContent = '正在加载资源引擎…';
  if (history.state?.arkreader !== 'inside') {
    history.replaceState({ arkreader: 'entry' }, '', location.href);
    history.pushState({ arkreader: 'inside' }, '', location.href);
  }
  window.addEventListener('popstate', (event) => {
    if (event.state?.arkreader !== 'entry') return;
    if (!window.dispatchEvent(new Event('arkreader-back', { cancelable: true })))
      history.pushState({ arkreader: 'inside' }, '', location.href);
    else history.back();
  });
  const worker = new Worker(new URL('./worker.js', import.meta.url), {
    type: 'module',
    name: 'ArkReader resources',
  });
  let sequence = 0;
  let fatal: Error | undefined;
  const pending = new Map<number, { resolve(value: Reply): void; reject(error: Error): void }>();
  let readyResolve!: () => void, readyReject!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  const fail = (error: Error) => {
    fatal = error;
    readyReject(error);
    for (const request of pending.values()) request.reject(error);
    pending.clear();
    window.startupError?.(error);
  };
  worker.onmessage = ({ data }) => {
    if (data.type === 'ready') readyResolve();
    if (data.type === 'response') {
      pending.get(data.id)?.resolve(data);
      pending.delete(data.id);
    }
    if (data.type === 'fatal') {
      fail(Error(data.message));
    }
    if (data.type === 'storage-error')
      document.dispatchEvent(new CustomEvent('arkreader-storage-error', { detail: data.message }));
  };
  worker.onerror = (event) => fail(Error(event.message));
  async function request(value: RequestData): Promise<Reply> {
    if (fatal) throw fatal;
    await ready;
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      worker.postMessage({ type: 'request', id, request: value });
    });
  }
  async function json<T>(path: string, body?: unknown): Promise<T> {
    const reply = await request({
      path,
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? '' : JSON.stringify(body),
    });
    const data = JSON.parse(new TextDecoder().decode(reply.body));
    if (reply.status >= 400) throw Error(data.detail ?? '资源操作失败。');
    return data as T;
  }
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type !== 'arkreader-resource-request' || !event.ports[0]) return;
    const port = event.ports[0];
    void request(event.data.request)
      .then((value) => port.postMessage(value, [value.body.buffer as ArrayBuffer]))
      .catch((error) =>
        port.postMessage({
          status: 503,
          headers: { 'content-type': 'application/json' },
          body: new TextEncoder().encode(JSON.stringify({ detail: String(error) })),
        }),
      );
  });
  window.__ARKREADER_WEB__ = {
    async invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
      let result: unknown;
      switch (command) {
        case 'app_startup_progress': {
          const status = await json<Status>('/api/status');
          result = {
            ...status.job,
            resourcesReady: status.baseResources.ready,
            skinReady: status.startupSkinReady,
            cursorReady: status.cursorReady,
            versionNotice: status.resourceUpdate?.warning,
          };
          break;
        }
        case 'app_startup_ready':
          window.dispatchEvent(
            new CustomEvent('arkreader-open-main', {
              detail: { epoch: 1, version: __APP_VERSION__ },
            }),
          );
          break;
        case 'app_cancel_startup': {
          const status = await json<Status>('/api/status');
          if (status.job.running) await json(`/api/operations/${status.job.id}/cancel`, {});
          break;
        }
        case 'app_retry': {
          if (fatal) {
            location.reload();
            break;
          }
          const status = await json<Status>('/api/status');
          if (!status.baseResources.ready && !status.job.running) await json('/api/import', {});
          break;
        }
        case 'app_info':
          result = { version: __APP_VERSION__, platform: 'web', library: '浏览器本地存储' };
          break;
        case 'app_playing':
          worker.postMessage({ type: 'playing', playing: !!args?.playing });
          break;
        case 'app_ui_ready':
          break;
        case 'app_ui_failed':
          throw Error(String(args?.message));
        default:
          throw Error(`网页版不支持此操作：${command}`);
      }
      return result as T;
    },
  };
  worker.postMessage({ type: 'start', base: new URL(import.meta.env.VITE_ENGINE_PATH, base).href });
  window.addEventListener('pagehide', () => {
    document.dispatchEvent(new Event('arkreader-before-close'));
    worker.terminate();
  });
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) location.reload();
  });
  await ready;
}
