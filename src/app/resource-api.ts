import { ScriptCompatibilityError, type ScriptCompatibility } from '../core/script-compatibility';
import { invoke } from '@tauri-apps/api/core';
import { isMobile, isNative } from './platform';
export interface OperationStatus<T = unknown> {
  id: string;
  kind: 'import' | 'prepare' | 'cache' | 'home-music';
  state: 'queued' | 'running' | 'cancelling' | 'completed' | 'failed' | 'cancelled';
  running: boolean;
  phase: string;
  message: string;
  done: number;
  total: number;
  elapsed: number;
  error: string | null;
  resource?: string;
  downloaded?: number;
  downloadTotal?: number;
  result?: T;
  automatic?: boolean;
  overallProgress?: number;
  transfers?: TransferSummary;
  compatibility?: ScriptCompatibility;
}
export interface TransferSummary {
  totalFiles: number;
  readyFiles: number;
  cachedFiles: number;
  totalBytes: number;
  readyBytes: number;
  downloadedBytes: number;
  activeDownloads: number;
  bytesPerSecond?: number;
  items: {
    number: number;
    name: string;
    total: number;
    downloaded: number;
    state: string;
    bytesPerSecond?: number;
  }[];
}

export async function resourceRequest<T>(
  url: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  if (isNative && isMobile && body !== undefined) {
    signal?.throwIfAborted();
    // Android WebView's custom protocol cannot forward POST bodies.
    const response = await invoke<{ status: number; body: T & { detail?: string } }>(
      'app_request',
      {
        path: url,
        body,
      },
    );
    if (response.status < 200 || response.status >= 300)
      throw Error(response.body.detail ?? '资源操作失败，请重试。');
    return response.body;
  }
  const response = await fetch(url, {
    signal,
    ...(body === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
  });
  const data = await response.json().catch(() => ({ detail: '暂时无法加载资源，请重试。' }));
  if (!response.ok) throw Error(data.detail ?? '资源操作失败，请重试。');
  return data as T;
}

export function waitForPoll(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}

export async function prepareRemoteStory<T>(
  story: string,
  signal: AbortSignal,
  progress: (state: OperationStatus<T>) => void,
): Promise<T> {
  signal.throwIfAborted();
  // Obtain the ID even if the user leaves during this request, so that the
  // server's download/conversion task can always be cancelled explicitly.
  const operation = await resourceRequest<OperationStatus<T>>('/api/prepare', { story });
  const cancel = () => {
    void resourceRequest(`/api/operations/${operation.id}/cancel`, {}).catch(() => {});
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    if (signal.aborted) {
      cancel();
      signal.throwIfAborted();
    }
    for (;;) {
      const state = await resourceRequest<OperationStatus<T>>(
        `/api/operations/${operation.id}`,
        undefined,
        signal,
      );
      progress(state);
      if (state.state === 'completed') return state.result as T;
      if (state.state === 'failed') {
        if (state.compatibility) throw new ScriptCompatibilityError(state.compatibility);
        throw Error(state.error ?? '剧情准备失败');
      }
      if (state.state === 'cancelled') throw new DOMException('已取消', 'AbortError');
      await waitForPoll(180, signal);
    }
  } finally {
    signal.removeEventListener('abort', cancel);
  }
}
