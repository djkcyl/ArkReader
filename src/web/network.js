export function browserNetwork(module) {
  const requests = new Map();
  const encode = (value) => new TextEncoder().encode(JSON.stringify(value));
  let sequence = 0;
  return {
    start(url, timeout) {
      const id = ++sequence,
        controller = new AbortController();
      const request = {
        controller,
        chunks: [],
        offset: 0,
        size: 0,
        done: false,
        meta: null,
        error: null,
        resume: null,
      };
      requests.set(id, request);
      const timer = setTimeout(() => controller.abort(Error('资源下载超时。')), timeout);
      void (async () => {
        try {
          const response = await fetch(url, {
            signal: controller.signal,
            credentials: 'omit',
            cache: 'no-store',
          });
          request.meta = encode({ status: response.status });
          const reader = response.body?.getReader();
          if (reader)
            for (;;) {
              if (request.size > 2 * 1024 * 1024)
                await new Promise((resolve) => {
                  request.resume = resolve;
                });
              if (controller.signal.aborted) throw controller.signal.reason;
              const { done, value } = await reader.read();
              if (done) break;
              request.chunks.push(value);
              request.size += value.byteLength;
            }
        } catch (error) {
          request.error = String(error);
          request.meta ??= encode({ error: request.error });
        } finally {
          request.done = true;
          clearTimeout(timer);
        }
      })();
      return id;
    },
    meta(id, data, capacity) {
      const request = requests.get(id);
      if (!request) return -1;
      if (!request.meta) return -2;
      if (data && capacity >= request.meta.length) module.HEAPU8.set(request.meta, data);
      return request.meta.length;
    },
    read(id, data, capacity) {
      const request = requests.get(id);
      if (!request || request.error) return -1;
      const chunk = request.chunks[0];
      if (!chunk) return request.done ? 0 : -2;
      const count = Math.min(capacity, chunk.length - request.offset);
      module.HEAPU8.set(chunk.subarray(request.offset, request.offset + count), data);
      request.offset += count;
      request.size -= count;
      if (request.offset === chunk.length) {
        request.chunks.shift();
        request.offset = 0;
      }
      if (request.size < 1024 * 1024 && request.resume) {
        request.resume();
        request.resume = null;
      }
      return count;
    },
    close(id) {
      const request = requests.get(id);
      if (request) {
        request.controller.abort();
        request.resume?.();
        requests.delete(id);
      }
    },
  };
}
