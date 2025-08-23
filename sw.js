// Minimal COOP/COEP service worker to enable cross-origin isolation for FFmpeg.wasm
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // Only operate on same-origin requests
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      const res = await fetch(req);
      // Clone headers and add COOP/COEP
      const headers = new Headers(res.headers);
      headers.set('Cross-Origin-Opener-Policy', 'same-origin');
      headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
      // Encourage same-origin resource policy
      headers.set('Cross-Origin-Resource-Policy', 'same-origin');

      // Fix wasm MIME if needed
      if (url.pathname.endsWith('.wasm')) {
        headers.set('Content-Type', 'application/wasm');
      }

      const body = await res.arrayBuffer();
      return new Response(body, { status: res.status, statusText: res.statusText, headers });
    })()
  );
});

