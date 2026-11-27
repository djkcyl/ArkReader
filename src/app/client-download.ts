interface DownloadPart {
  path: string;
  size: number;
  sha256: string;
}
export interface ClientPackage {
  id: string;
  name: string;
  size: number;
  sha256: string;
  parts: DownloadPart[];
}
interface DownloadManifest {
  schema: number;
  version: string;
  packages: ClientPackage[];
}
export interface ClientDownloadState {
  phase: 'idle' | 'preparing' | 'downloading' | 'ready' | 'cancelled' | 'error';
  id: string;
  name: string;
  version: string;
  received: number;
  total: number;
  speed: number;
  error: string;
  url: string;
}
const hex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, '0')).join('');

/** One transfer survives the startup screen handing over to the main application. */
class ClientDownloads {
  state: ClientDownloadState = {
    phase: 'idle',
    id: '',
    name: '',
    version: '',
    received: 0,
    total: 0,
    speed: 0,
    error: '',
    url: '',
  };
  private controller?: AbortController;
  private listeners = new Set<(state: ClientDownloadState) => void>();
  get busy(): boolean {
    return this.state.phase === 'preparing' || this.state.phase === 'downloading';
  }
  subscribe(listener: (state: ClientDownloadState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }
  private emit(): void {
    for (const listener of this.listeners) listener(this.state);
  }
  cancel(): void {
    this.controller?.abort();
  }
  async start(id: string): Promise<void> {
    if (this.busy) return;
    if (this.state.url) URL.revokeObjectURL(this.state.url);
    const controller = new AbortController(),
      { signal } = controller;
    this.controller = controller;
    this.state = {
      phase: 'preparing',
      id,
      name: '',
      version: '',
      received: 0,
      total: 0,
      speed: 0,
      error: '',
      url: '',
    };
    this.emit();
    let lastBytes = 0,
      lastTime = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      this.state.speed = ((this.state.received - lastBytes) * 1000) / (now - lastTime);
      lastBytes = this.state.received;
      lastTime = now;
      this.emit();
    }, 400);
    try {
      const base = new URL('downloads/', new URL('./', location.href));
      const response = await fetch(new URL('manifest.json', base), { signal, cache: 'no-store' });
      if (!response.ok) throw Error('此站点的客户端下载暂不可用，可使用下方的 GitHub 下载。');
      const manifest: DownloadManifest = await response.json().catch(() => {
        throw Error('此站点的客户端下载暂不可用，可使用下方的 GitHub 下载。');
      });
      const file = Array.isArray(manifest.packages)
        ? manifest.packages.find((item) => item.id === id)
        : undefined;
      if (
        manifest.schema !== 1 ||
        !/^\d+\.\d+\.\d+$/.test(manifest.version) ||
        !file ||
        !/^[A-Za-z0-9._-]+$/.test(file.name) ||
        !Number.isSafeInteger(file.size) ||
        file.size <= 0 ||
        !/^[a-f0-9]{64}$/.test(file.sha256) ||
        !Array.isArray(file.parts) ||
        !file.parts.length ||
        file.parts.some(
          (part) =>
            !/^[a-f0-9]{64}\/\d+\.bin$/.test(part.path) ||
            !Number.isSafeInteger(part.size) ||
            part.size <= 0 ||
            part.size > 20_000_000 ||
            !/^[a-f0-9]{64}$/.test(part.sha256),
        ) ||
        file.parts.reduce((sum, part) => sum + part.size, 0) !== file.size
      )
        throw Error('客户端下载清单不完整，请稍后重试。');
      Object.assign(this.state, {
        phase: 'downloading',
        name: file.name,
        version: manifest.version,
        total: file.size,
      });
      this.emit();
      const pieces: Blob[] = new Array(file.parts.length);
      let next = 0;
      const transfer = async () => {
        while (next < file.parts.length) {
          signal.throwIfAborted();
          const index = next++,
            part = file.parts[index];
          const response = await fetch(new URL(part.path, base), { signal, cache: 'no-store' });
          if (!response.ok || !response.body) throw Error('下载失败，请检查网络后重试。');
          const reader = response.body.getReader(),
            bytes = new Uint8Array(part.size);
          let offset = 0;
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            if (offset + value.length > bytes.length) throw Error('下载文件大小不符，请重试。');
            bytes.set(value, offset);
            offset += value.length;
            this.state.received += value.length;
          }
          if (
            offset !== part.size ||
            hex(await crypto.subtle.digest('SHA-256', bytes)) !== part.sha256
          )
            throw Error('下载文件校验失败，请重试。');
          signal.throwIfAborted();
          pieces[index] = new Blob([bytes]);
        }
      };
      const results = await Promise.allSettled(
        Array.from({ length: Math.min(3, file.parts.length) }, transfer).map((task) =>
          task.catch((error) => {
            controller.abort(error);
            throw error;
          }),
        ),
      );
      const failure = results.find((result) => result.status === 'rejected');
      if (failure?.status === 'rejected') throw signal.reason ?? failure.reason;
      signal.throwIfAborted();
      const type = file.name.endsWith('.apk')
        ? 'application/vnd.android.package-archive'
        : 'application/octet-stream';
      this.state.url = URL.createObjectURL(new Blob(pieces, { type }));
      this.state.phase = 'ready';
    } catch (error) {
      const cancelled =
        signal.aborted &&
        signal.reason instanceof DOMException &&
        signal.reason.name === 'AbortError';
      this.state.phase = cancelled ? 'cancelled' : 'error';
      this.state.error = cancelled ? '' : error instanceof Error ? error.message : String(error);
    } finally {
      clearInterval(timer);
      this.state.speed = 0;
      this.controller = undefined;
      this.emit();
    }
  }
}
export const clientDownloads = new ClientDownloads();
