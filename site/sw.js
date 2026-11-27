const PRECACHE={".nojekyll":"sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=","README.txt":"sha256-43ydqnRvRvE5E87LTqLqlOFRrBWHQ/iEjV0Xw9/ILzQ=","assets/main--IT_sJ-G.js":"sha256-egpt9G/k6NqRaF0GX+ZLwy0skkra2oMNEdiuB065cNg=","assets/main-D0uKewBu.css":"sha256-0mD6sDkiPv5oR+dW8fX/kLXZylFCZMxh33BsTRhNMD4=","assets/startup-B5vAhINP.css":"sha256-IwEapN7BXRSTJQPrQRR/pg9ngLzXJaN0FM2oFw1D3hE=","assets/startup-JWfQvRXv.js":"sha256-DPqK+hEphUFGbDT/bQCDfl9Ta4eFiYaFpbJb2gkEALY=","assets/web-Bc2EH7G2.js":"sha256-SF2RwMQkAJIhj+PTybjNSPUslfVaKcjvPOIYkfniSvw=","assets/web-C4KhudmJ.css":"sha256-vbYjHTDzvQEDekzSSzm+bH4GfVNW50DKPJYuwD0o54Q=","assets/worker-H9k677Vh.js":"sha256-Dh5lPToYvM1rrwW4RGvcxbm7xIH+iUjKL7NlJQlEAsE=","brand-icon.png":"sha256-Ty/0iIAY4pFhNNWQvouyf+8/bhP1UMURnZyUn21f5jE=","build.json":"sha256-fv1vuY0yCoWVxgfj0014DGlyk88HFDsn/0oA42g8EQQ=","download.html":"sha256-jfQo7cVTCDqhw/iZ/48WL+oXfElvBnP5vjxuNbOjMvY=","engine/d8c70ce9a75f1f62d06050d0b1a093d533c981ae021a9699143182b1a7fcc21a/arkreader-web.js":"sha256-4EwxX3BL8zGV8hY27V2Y5Z/2cut6T/gQ2kI3+2/0LRQ=","engine/d8c70ce9a75f1f62d06050d0b1a093d533c981ae021a9699143182b1a7fcc21a/arkreader_web.wasm":"sha256-ah4CryToK5xOMYf2Rz7UEU3trej4Alt6IzU/c+BcadI=","index.html":"sha256-u2GyIP2n63IbmTHp4R+Rs8WqTphWY3Aew2P+SCpine4=","robots.txt":"sha256-YqAdLM1G28YXTK/rWLJ2dZFrtinhmmvE2H0zkhsYm88=","sitemap.xml":"sha256-pHx65dEaqbVX2unwOFYexURLtVFUgMkS9TU1Al38Vk8=","social-preview.png":"sha256-4utaomJ6oaJDmU2a1TkJHNNVhZwhKF+75d+Yp69HlHU=","startup.css":"sha256-9ETjJD8x3TzD9sH5y10qDR7xhdq8xb4aXluTz9/F5Rk=","ui-watchdog.js":"sha256-qQuv9QnZECLRVHKBXja7HdHEdktjAWGIWWCxYS11a8M="};
const BUILD="4b52cddf4497e1f749f3358e";
/* PRECACHE and BUILD are supplied by the static build. */
const cacheName = `arkreader-app-${BUILD}`;
self.addEventListener('install', (event) =>
  event.waitUntil(
    (async () => {
      const cache = await caches.open(cacheName);
      try {
        await cache.addAll(
          Object.entries(PRECACHE)
            .filter(([path]) => !path.startsWith('engine/'))
            .map(
              ([path, integrity]) =>
                new Request(new URL(path, self.registration.scope).href, {
                  cache: 'reload',
                  integrity,
                }),
            ),
        );
      } catch (error) {
        await caches.delete(cacheName);
        throw error;
      }
      await self.skipWaiting();
    })(),
  ),
);
self.addEventListener('activate', (event) =>
  event.waitUntil(
    (async () => {
      const previous = (await caches.keys())
        .filter((name) => name.startsWith('arkreader-app-') && name !== cacheName)
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
  // Client packages are downloaded explicitly, never stored in the application cache.
  if (url.pathname.startsWith(new URL('downloads/', self.registration.scope).pathname)) return;
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
          ? new URL(Object.hasOwn(PRECACHE, path) ? path : 'index.html', self.registration.scope)
              .href
          : event.request;
      const saved = await cache.match(key);
      if (saved) return saved;
      for (const name of (await caches.keys()).filter(
        (name) => name.startsWith('arkreader-app-') && name !== cacheName,
      )) {
        const previous = await (await caches.open(name)).match(key);
        if (previous) return previous;
      }
      const response = await fetch(
        PRECACHE[path] ? new Request(event.request, { integrity: PRECACHE[path] }) : event.request,
      );
      if (response.ok && response.type === 'basic') await cache.put(key, response.clone());
      return response;
    })(),
  );
});
