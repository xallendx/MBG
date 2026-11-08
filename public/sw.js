// MBG Airdrop Task Manager — Service Worker
// Handles push notifications even when the app is closed or in background

const CACHE_NAME = 'mbg-v4'

// Install — cache essential static assets only (NO API routes)
//
// PENTING: `cache.addAll()` bersifat atomik. Satu URL gagal (mis. aset yang
// tidak ada) membuat seluruh install gagal, service worker dibuang, dan
// `navigator.serviceWorker.ready` tidak pernah selesai — akibatnya Web Push
// mati total. Karena itu tiap aset di-cache terpisah dan kegagalannya
// ditelan: push harus tetap hidup walau satu ikon tidak tersedia.
const PRECACHE_URLS = ['/', '/logo.svg']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(
        PRECACHE_URLS.map((url) =>
          cache.add(new Request(url, { cache: 'reload' })).catch(() => {
            // Aset optional gagal diambil — jangan batalkan install.
          })
        )
      )
    )
  )
  self.skipWaiting()
})

// Activate — clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  )
  self.clients.claim()
})

// Push event — show notification like Discord
self.addEventListener('push', (event) => {
  let data = { title: 'MBG Task Manager', body: 'Task update', icon: '/logo.svg', tag: 'mbg-general', url: '/' }

  try {
    data = { ...data, ...event.data.json() }
  } catch {
    // fallback to default
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: data.icon || '/logo.svg',
      badge: '/logo.svg',
      tag: data.tag || 'mbg-general',
      data: { url: data.url || '/' },
      requireInteraction: false,
      vibrate: [200, 100, 200],
      actions: data.actions || []
    })
  )
})

// Notification click — open/focus the app
self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const url = event.notification.data?.url || '/'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Focus existing window if available
      for (const client of clients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus()
        }
      }
      // Open new window
      return self.clients.openWindow(url)
    })
  )
})

// Fetch — network first, ONLY cache static assets (NOT /api/* routes)
self.addEventListener('fetch', (event) => {
  // Only handle GET requests
  if (event.request.method !== 'GET') return

  // NEVER cache API routes — always fetch fresh data
  const url = new URL(event.request.url)
  if (url.pathname.startsWith('/api/')) return

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Cache successful responses for static assets only
        if (response.status === 200) {
          const clone = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone))
        }
        return response
      })
      .catch(() => caches.match(event.request))
  )
})
