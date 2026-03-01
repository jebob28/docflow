const CACHE_NAME = 'docflow-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/vite.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // NUNCA interceptar requisições para a API ou que não sejam GET
  if (event.request.method !== 'GET' || url.pathname.startsWith('/api/')) {
    // console.log('SW: Ignorando API ou não-GET:', event.request.method, url.pathname);
    return;
  }

  // Se for uma requisição para a mesma origem (assets do frontend)
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }

        return fetch(event.request).then((response) => {
          // Não cachear se não for 200 OK
          if (!response || response.status !== 200 || response.type !== 'basic') {
            return response;
          }

          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });

          return response;
        }).catch((error) => {
          // Se for navegação, retorna o index.html (SPA)
          if (event.request.mode === 'navigate') {
            return caches.match('/');
          }
          throw error;
        });
      })
    );
  }
});
