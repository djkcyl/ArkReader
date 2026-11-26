import { browserNetwork } from './network';
import { mountStorage } from './storage';
import '../../tools/desktop-parser';

let module, storage;
let scheduled = false,
  stopped = false;
const pending = [];
// Emscripten's window postMessage scheduler is not valid in a dedicated worker.
const immediate = new MessageChannel(),
  callbacks = new Map();
let immediateId = 0;
immediate.port1.onmessage = ({ data }) => {
  const callback = callbacks.get(data);
  callbacks.delete(data);
  callback?.();
};
self.setImmediate = (callback) => {
  const id = ++immediateId;
  callbacks.set(id, callback);
  immediate.port2.postMessage(id);
  return id;
};
self.clearImmediate = (id) => callbacks.delete(id);
self.onmessage = async ({ data }) => {
  if (data.type === 'start') {
    try {
      const create = (await import(/* @vite-ignore */ new URL('arkreader-web.js', data.base).href))
        .default;
      module = await create({
        locateFile: (name) => new URL(name, data.base).href,
        printErr: (message) => console.warn(message),
      });
      storage = await mountStorage(module.FS);
      module.arkNet = browserNetwork(module);
      let parsed;
      module.arkAnalyze = (mode, payload, output, length) => {
        if (!output) {
          let result;
          try {
            result = { value: self.arkreaderAnalyze(mode, payload) };
          } catch (error) {
            result = { error: String(error) };
          }
          parsed = new TextEncoder().encode(JSON.stringify(result));
        } else if (length >= parsed.length) module.HEAPU8.set(parsed, output);
        return parsed.length;
      };
      module.arkFatal = (message) => {
        stopped = true;
        self.postMessage({ type: 'fatal', message: String(message) });
      };
      module.arkReply = async (id, status, headers, body) => {
        try {
          await storage.flush();
          self.postMessage({ type: 'response', id, status, headers, body }, [body.buffer]);
        } catch (error) {
          self.postMessage({
            type: 'response',
            id,
            status: 507,
            headers: { 'content-type': 'application/json' },
            body: new TextEncoder().encode(
              JSON.stringify({ detail: `浏览器缓存保存失败：${error}` }),
            ),
          });
        }
      };
      module.arkReady = () => {
        self.postMessage({ type: 'ready' });
        for (const message of pending.splice(0)) send(message);
      };
      module._ark_init();
      pump();
    } catch (error) {
      self.postMessage({ type: 'fatal', message: String(error) });
    }
    return;
  }
  if (!module) {
    pending.push(data);
    return;
  }
  send(data);
};
function send(data) {
  if (data.type === 'playing') {
    module._ark_playing(data.playing ? 1 : 0);
    return;
  }
  if (data.type !== 'request') return;
  const bytes = new TextEncoder().encode(JSON.stringify(data.request));
  const pointer = module._malloc(bytes.length) >>> 0;
  try {
    module.HEAPU8.set(bytes, pointer);
    module._ark_request(data.id, pointer, bytes.length);
  } finally {
    module._free(pointer);
  }
  pump();
}
function pump() {
  if (scheduled || stopped) return;
  scheduled = true;
  setTimeout(() => {
    scheduled = false;
    try {
      if (module._ark_poll()) pump();
    } catch (error) {
      module.arkFatal(error);
    }
  }, 4);
}
