// Only public application resources go into Cache Storage. Private data is scoped in IndexedDB.
const CACHE = 'acornary-shell-__VERSION__';
const PRECACHE = __PRECACHE__;
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const response = await fetch('/', { cache: 'reload' });
      if (!response.ok) throw new Error('App shell unavailable');
      await cache.put('/items', response);
      await cache.addAll([
        '/manifest.webmanifest',
        '/app-icon.png',
        '/design/search.svg',
        '/design/soft-search.svg',
        '/design/soft-clear.svg',
        '/design/items.svg',
        '/design/places.svg',
        '/design/catalog.svg',
        '/design/settings.svg',
        '/design/workbench/brand.svg',
        '/design/workbench/close.svg',
        '/design/workbench/check.svg',
        '/design/workbench/dots.svg',
        '/design/workbench/settings.svg',
        '/design/workbench/folder.svg',
        '/design/workbench/chevron.svg',
        '/design/workbench/plus.svg',
        '/design/workbench/catalog.svg',
        '/design/workbench/items.svg',
        '/design/workbench/search.svg',
        '/design/workbench/down.svg',
        '/design/workbench/status.svg',
        '/design/workbench/status-muted.svg',

        ...PRECACHE,
      ]);
    })(),
  );
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys())
        if (name.startsWith('acornary-shell-') && name !== CACHE) await caches.delete(name);
      await self.clients.claim();
    })(),
  );
});
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (
    url.origin !== self.location.origin ||
    event.request.method !== 'GET' ||
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/mcp') ||
    url.pathname.startsWith('/inspect') ||
    url.pathname.startsWith('/consent') ||
    url.pathname.startsWith('/login') ||
    ['/register', '/recover', '/join', '/choose-household'].some((p) => url.pathname.startsWith(p))
  )
    return;
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(async () => (await caches.open(CACHE)).match('/items')),
    );
  } else if (
    url.pathname.startsWith('/assets/') ||
    url.pathname.startsWith('/design/') ||
    ['/app-icon.png', '/manifest.webmanifest'].includes(url.pathname)
  ) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        const cached = await cache.match(event.request);
        if (cached) return cached;
        const response = await fetch(event.request);
        if (response.ok) await cache.put(event.request, response.clone());
        return response;
      })(),
    );
  }
});
