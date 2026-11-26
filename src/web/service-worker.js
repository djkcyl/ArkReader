/* PRECACHE and BUILD are supplied by the static build. */
const cacheName = `arkreader-app-${BUILD}`;
self.addEventListener('install', (event) =>
  event.waitUntil(
    (async () => {
      const cache = await caches.open(cacheName);
      await cache.addAll(
        PRECACHE.map(
          (path) => new Request(new URL(path, self.registration.scope).href, { cache: 'reload' }),
        ),
      );
      await self.skipWaiting();
    })(),
  ),
);
self.addEventListener('activate', (event) =>
  event.waitUntil(
    (async () => {
      const previous = (await caches.keys())
        .filter((name) => name.startsWith('arkreader-app-') && name !== cacheName)
        .sort()
        .reverse();
      for (const name of previous.slice(1)) await caches.delete(name);
      await self.clients.claim();
    })(),
  ),
);
async function resource(event) {
  const client = await self.clients.get(event.clientId);
  if (!client)
    return new Response(JSON.stringify({ detail: '请重新打开 ArkReader 页面。' }), {
      status: 503,
      headers: { 'content-type': 'application/json' },
    });
  const url = new URL(event.request.url);
  const body =
    event.request.method === 'GET' || event.request.method === 'HEAD'
      ? ''
      : await event.request.text();
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => {
      channel.port1.close();
      resolve(
        new Response(JSON.stringify({ detail: '资源处理超时，请重试。' }), {
          status: 504,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }, 300000);
    channel.port1.onmessage = ({ data }) => {
      clearTimeout(timer);
      channel.port1.close();
      resolve(
        new Response([204, 205, 304].includes(data.status) ? null : data.body, {
          status: data.status,
          headers: data.headers,
        }),
      );
    };
    client.postMessage(
      {
        type: 'arkreader-resource-request',
        request: {
          path: url.pathname + url.search,
          method: event.request.method,
          headers: Object.fromEntries(event.request.headers),
          body,
        },
      },
      [channel.port2],
    );
  });
}
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/media/')) {
    event.respondWith(resource(event));
    return;
  }
  if (event.request.method !== 'GET' || !url.href.startsWith(self.registration.scope)) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(cacheName);
      const path = url.pathname.slice(new URL(self.registration.scope).pathname.length);
      const key =
        event.request.mode === 'navigate'
          ? new URL(PRECACHE.includes(path) ? path : 'index.html', self.registration.scope).href
          : event.request;
      const saved = await cache.match(key);
      if (saved) return saved;
      for (const name of (await caches.keys()).filter(
        (name) => name.startsWith('arkreader-app-') && name !== cacheName,
      )) {
        const previous = await (await caches.open(name)).match(key);
        if (previous) return previous;
      }
      const response = await fetch(event.request);
      if (response.ok && response.type === 'basic') await cache.put(key, response.clone());
      return response;
    })(),
  );
});
