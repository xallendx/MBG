// MBG Airdrop Task Manager — Service Worker
// Handles push notifications even when the app is closed or in background

const CACHE_NAME = 'mbg-v1'

// Install — cache essential assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll([
        '/',
        '/favicon.ico'
      ])
    })
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
  let data = { title: 'MBG Task Manager', body: 'Task update', icon: '/favicon.ico', tag: 'mbg-general', url: '/' }

  try {
    data = { ...data, ...event.data.json() }
  } catch {
    // fallback to default
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: data.icon || '/favicon.ico',
      badge: '/favicon.ico',
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

// Fetch — network first, fallback to cache
self.addEventListener('fetch', (event) => {
  // Only handle GET requests
  if (event.request.method !== 'GET') return

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Cache successful responses
        if (response.status === 200) {
          const clone = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone))
        }
        return response
      })
      .catch(() => caches.match(event.request))
  )
})
