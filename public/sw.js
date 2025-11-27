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

// Handle push notifications
self.addEventListener('push', (event) => {
  console.log('Push notification received:', event);
  
  let notificationData = {
    title: 'RMQ 2.0',
    body: 'You have a new notification',
    icon: '/icon-192x192.png',
    badge: '/icon-72x72.png',
    tag: 'rmq-notification',
    data: { url: '/' },
    vibrate: [200, 100, 200],
    requireInteraction: false,
    silent: false
  };

  if (event.data) {
    try {
      const data = event.data.json();
      notificationData = {
        title: data.title || notificationData.title,
        body: data.body || notificationData.body,
        icon: data.icon || notificationData.icon,
        badge: data.badge || notificationData.badge,
        tag: data.tag || notificationData.tag,
        data: {
          url: data.url || notificationData.data.url,
          type: data.type || 'notification',
          id: data.id || null,
        },
        vibrate: data.vibrate || notificationData.vibrate,
        requireInteraction: data.requireInteraction !== undefined ? data.requireInteraction : notificationData.requireInteraction,
        silent: data.silent !== undefined ? data.silent : notificationData.silent,
        // For iOS, add sound
        sound: data.sound || '/notification.mp3',
      };
    } catch (e) {
      console.error('Error parsing push notification data:', e);
      // Fallback to text data
      if (event.data.text) {
        notificationData.body = event.data.text();
      }
    }
  }

  event.waitUntil(
    self.registration.showNotification(notificationData.title, notificationData)
  );
});

// Handle notification clicks with deep linking
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  const urlToOpen = event.notification.data?.url || '/';
  const notificationType = event.notification.data?.type || 'notification';
  const notificationId = event.notification.data?.id;
  
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Check if there's already a window/tab open
        for (const client of clientList) {
          if ('focus' in client) {
            // Focus existing window and send navigation message
            client.focus();
            client.postMessage({
              type: 'NOTIFICATION_CLICK',
              url: urlToOpen,
              notificationType: notificationType,
              notificationId: notificationId
            });
            return;
          }
        }
        // If no window is open, open a new one
        // For PWA on mobile, this will open the app
        if (clients.openWindow) {
          return clients.openWindow(urlToOpen);
        }
      })
  );
});

