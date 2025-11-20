// Service Worker for RMQ 2.0 PWA
// Static cache for assets that don't change often
const STATIC_CACHE_NAME = 'rmq-2.0-static-v1';
const OFFLINE_PAGE = '/offline.html';

// Files that should always be fetched from network (never cached)
// This ensures HTML, JS bundles, and API calls always get fresh content
const NETWORK_ONLY_PATTERNS = [
  /\/api\//,
  /\.html$/,
  /\/index\.html$/,
  /\/manifest\.json$/,
  // JS bundles (Vite creates hash-based filenames, but we still want network-first)
  /\/assets\/.*\.js$/,
  // CSS files (also hash-based, but network-first to ensure updates)
  /\/assets\/.*\.css$/,
];

// Static assets that can be cached (images, fonts, etc.)
const STATIC_ASSET_PATTERNS = [
  /\.(?:png|jpg|jpeg|svg|gif|webp|ico)$/,
  /\.(?:woff|woff2|ttf|eot)$/,
];

// Install event - skip waiting to activate immediately
self.addEventListener('install', (event) => {
  console.log('Service Worker: Installing new version');
  // Force the waiting service worker to become the active service worker immediately
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          // Delete all old caches (keep only current static cache)
          if (cacheName !== STATIC_CACHE_NAME && cacheName.startsWith('rmq-2.0-')) {
            console.log('Service Worker: Deleting old cache', cacheName);
            return caches.delete(cacheName);
          }
          return Promise.resolve();
        })
      );
    }).then(() => {
      // Take control of all pages immediately
      return self.clients.claim();
    })
  );
});

// Listen for messages from the client
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Fetch event - network-first strategy for HTML/JS, cache-first for static assets
self.addEventListener('fetch', (event) => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  // Skip cross-origin requests
  if (!event.request.url.startsWith(self.location.origin)) {
    return;
  }

  const url = new URL(event.request.url);
  const isNetworkOnly = NETWORK_ONLY_PATTERNS.some(pattern => pattern.test(url.pathname));
  const isStaticAsset = STATIC_ASSET_PATTERNS.some(pattern => pattern.test(url.pathname));

  // Network-first strategy for HTML, API, and manifest (always get fresh content)
  if (isNetworkOnly) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // Don't cache network-only resources
          return response;
        })
        .catch(() => {
          // If fetch fails and it's a navigation request, show offline page
          if (event.request.mode === 'navigate') {
            return caches.match(OFFLINE_PAGE) || new Response('Offline', { status: 503 });
          }
          return new Response('Offline', { status: 503 });
        })
    );
    return;
  }

  // Cache-first strategy for static assets (images, fonts, CSS, JS bundles)
  if (isStaticAsset) {
    event.respondWith(
      caches.match(event.request)
        .then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          // Fetch from network and cache for future use
          return fetch(event.request)
            .then((response) => {
              // Only cache valid responses
              if (response && response.status === 200 && response.type === 'basic') {
                const responseToCache = response.clone();
                caches.open(STATIC_CACHE_NAME)
                  .then((cache) => {
                    cache.put(event.request, responseToCache);
                  });
              }
              return response;
            });
        })
        .catch(() => {
          return new Response('Offline', { status: 503 });
        })
    );
    return;
  }

  // Default: network-first for everything else
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        return response;
      })
      .catch(() => {
        // Fallback to cache if network fails
        return caches.match(event.request)
          .then((cachedResponse) => {
            if (cachedResponse) {
              return cachedResponse;
            }
            // If it's a navigation request and no cache, show offline page
            if (event.request.mode === 'navigate') {
              return caches.match(OFFLINE_PAGE) || new Response('Offline', { status: 503 });
            }
            return new Response('Offline', { status: 503 });
          });
      })
  );
});

// Handle push notifications (optional, for future use)
self.addEventListener('push', (event) => {
  if (event.data) {
    const data = event.data.json();
    const title = data.title || 'RMQ 2.0';
    const options = {
      body: data.body || 'You have a new notification',
      icon: '/icon-192x192.png',
      badge: '/icon-72x72.png',
      vibrate: [200, 100, 200],
      tag: 'rmq-notification',
      requireInteraction: false
    };

    event.waitUntil(
      self.registration.showNotification(title, options)
    );
  }
});

// Handle notification clicks with deep linking
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  const urlToOpen = event.notification.data?.url || '/';
  
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Check if there's already a window open
        for (const client of clientList) {
          if (client.url === urlToOpen && 'focus' in client) {
            return client.focus();
          }
        }
        // Open new window if none exists
        if (clients.openWindow) {
          return clients.openWindow(urlToOpen);
        }
      })
  );
});

