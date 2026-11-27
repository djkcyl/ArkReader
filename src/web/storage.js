import { openResourceDatabase, idbResult as request } from './resource-db';
const transaction = (value) =>
  new Promise((resolve, reject) => {
    value.oncomplete = resolve;
    value.onabort = value.onerror = () => reject(value.error);
  });

/** Keep persistent bytes as lazy Blobs; only files being written occupy MEMFS. */
export async function mountStorage(FS) {
  const database = await openResourceDatabase();
  const dirty = new Map(),
    lazy = new Map();
  const reader = new FileReaderSync();
  const blocks = new Map();
  const blockSize = 1024 * 1024;
  const blobIds = new WeakMap();
  const digests = new WeakMap();
  const checks = new Map();
  let checkId = 0;
  let blobId = 0;
  let revision = 0,
    active = false,
    flushing;
  const persistent = (path) =>
    path.startsWith('/library/') && !path.split('/').some((part) => part.startsWith('.'));
  const mark = (path) => {
    if (active && persistent(path)) dirty.set(path, ++revision);
  };
  const parent = (path) => path.slice(0, path.lastIndexOf('/'));
  function useBlob(node, blob) {
    let owner = blobIds.get(blob);
    if (!owner) {
      owner = ++blobId;
      blobIds.set(blob, owner);
    }
    const original = node.stream_ops;
    node.contents = null;
    node.usedBytes = blob.size;
    node.webBlob = blob;
    function hydrate() {
      if (node.webBlob) {
        node.contents = new Uint8Array(reader.readAsArrayBuffer(node.webBlob));
        node.webBlob = null;
      }
    }
    node.stream_ops = {
      ...original,
      read(stream, bytes, offset, length, position) {
        if (!node.webBlob) return original.read(stream, bytes, offset, length, position);
        const count = Math.min(length, Math.max(0, node.webBlob.size - position));
        let copied = 0;
        while (copied < count) {
          const start = Math.floor((position + copied) / blockSize) * blockSize;
          const key = `${owner}:${start}`;
          let block = blocks.get(key);
          if (block) blocks.delete(key);
          else
            block = new Uint8Array(
              reader.readAsArrayBuffer(node.webBlob.slice(start, start + blockSize)),
            );
          blocks.set(key, block);
          while (blocks.size > 16) blocks.delete(blocks.keys().next().value);
          const begin = position + copied - start,
            size = Math.min(count - copied, block.length - begin);
          bytes.set(block.subarray(begin, begin + size), offset + copied);
          copied += size;
        }
        return copied;
      },
      write(...args) {
        hydrate();
        return original.write(...args);
      },
      allocate(...args) {
        hydrate();
        return original.allocate(...args);
      },
      mmap(...args) {
        hydrate();
        return original.mmap(...args);
      },
    };
    const operations = node.node_ops;
    node.node_ops = {
      ...operations,
      setattr(node, attributes) {
        if (attributes.size !== undefined) hydrate();
        return operations.setattr(node, attributes);
      },
    };
  }
  FS.mkdirTree('/library');
  for (const row of await request(database.transaction('files').objectStore('files').getAll())) {
    if (!persistent(row.path)) continue;
    FS.mkdirTree(parent(row.path));
    FS.writeFile(row.path, new Uint8Array());
    const node = FS.lookupPath(row.path).node;
    useBlob(node, row.bytes);
    FS.utime(row.path, row.modified, row.modified);
  }
  function markTree(path) {
    const node = FS.lookupPath(path).node;
    if (FS.isFile(node.mode)) mark(path);
    else if (FS.isDir(node.mode))
      for (const name of FS.readdir(path).filter((n) => n !== '.' && n !== '..'))
        markTree(`${path}/${name}`);
  }
  for (const method of ['write', 'close']) {
    const original = FS[method];
    FS[method] = function (stream, ...args) {
      const path = stream?.node && FS.getPath(stream.node);
      const writable = stream && (stream.flags & 3) !== 0;
      const result = original.call(this, stream, ...args);
      if (writable && path) mark(path);
      return result;
    };
  }
  const rename = FS.rename;
  FS.rename = (from, to) => {
    const result = rename(from, to);
    mark(from);
    if (to.startsWith('/library/')) markTree(to);
    return result;
  };
  const unlink = FS.unlink;
  FS.unlink = (path) => {
    const result = unlink(path);
    mark(path);
    lazy.delete(path);
    return result;
  };
  active = true;
  function evict() {
    for (const [path, item] of lazy) {
      if (dirty.has(path)) continue;
      const node = FS.analyzePath(path).object;
      if (node !== item.node) {
        lazy.delete(path);
        continue;
      }
      if (FS.streams.some((stream) => stream?.node === node)) continue;
      if (!node.webBlob) useBlob(node, item.bytes);
      lazy.delete(path);
    }
  }
  async function flush() {
    if (flushing) {
      await flushing;
      if (!dirty.size) return;
    }
    const pending = [...dirty];
    if (!pending.length) {
      evict();
      return;
    }
    const tx = database.transaction('files', 'readwrite'),
      store = tx.objectStore('files');
    const written = [];
    for (const [path, version] of pending) {
      const node = FS.analyzePath(path).object;
      if (!node || !FS.isFile(node.mode)) store.delete(path);
      else {
        const bytes =
          node.webBlob ??
          new Blob([node.contents?.subarray(0, node.usedBytes) ?? new Uint8Array()]);
        const modified = FS.stat(path).mtime.getTime();
        store.put({ path, bytes, modified });
        written.push([path, { node, bytes }]);
      }
    }
    flushing = transaction(tx);
    try {
      await flushing;
      for (const [path, version] of pending) if (dirty.get(path) === version) dirty.delete(path);
      for (const [path, item] of written) if (!dirty.has(path)) lazy.set(path, item);
      evict();
    } finally {
      flushing = undefined;
    }
  }
  setInterval(
    () =>
      void flush().catch((error) =>
        self.postMessage({ type: 'storage-error', message: `浏览器缓存保存失败：${error}` }),
      ),
    500,
  );
  function clone(from, to) {
    const source = FS.lookupPath(from).node;
    if (!FS.isFile(source.mode)) throw Error('Cached resource is not a file');
    const bytes = source.webBlob ?? new Blob([source.contents.subarray(0, source.usedBytes)]);
    FS.writeFile(to, new Uint8Array());
    useBlob(FS.lookupPath(to).node, bytes);
    const modified = FS.stat(from).mtime.getTime();
    FS.utime(to, modified, modified);
  }
  const cachedBlob = (path) => FS.analyzePath(path).object?.webBlob;
  function prepare(directory) {
    const id = ++checkId,
      check = { pending: true, cancelled: false };
    checks.set(id, check);
    void (async () => {
      const receipt = cachedBlob(directory + '/receipt.json');
      if (!receipt) return;
      const snapshot = JSON.parse(await receipt.text());
      const names = Object.keys(snapshot.files);
      let next = 0;
      await Promise.all(
        Array.from({ length: Math.min(3, names.length) }, async () => {
          while (!check.cancelled && next < names.length) {
            const name = names[next++];
            if (
              name.startsWith('/') ||
              name.includes('\\') ||
              name.split('/').some((part) => !part || part === '.' || part === '..')
            )
              return;
            const blob = cachedBlob(directory + '/files/' + name);
            if (blob && !digests.has(blob))
              digests.set(
                blob,
                new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())),
              );
          }
        }),
      );
    })()
      .catch(() => {
        // Unavailable bytes still go through the engine's normal cache validation.
      })
      .finally(() => {
        check.pending = false;
      });
    return id;
  }
  return {
    flush,
    clone,
    prepare,
    pending: (id) => (checks.get(id)?.pending ? 1 : 0),
    close: (id) => {
      const check = checks.get(id);
      if (check) check.cancelled = true;
      checks.delete(id);
    },
    digest: (path) => {
      const blob = cachedBlob(path);
      return blob && digests.get(blob);
    },
  };
}
