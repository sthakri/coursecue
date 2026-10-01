self.addEventListener('push', function(event) {
  let data = {}
  try {
    data = event.data?.json() ?? {}
  } catch {
    // Non-JSON or empty payload — fall back to default text instead of crashing
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'DuePulse', {
      body: data.body || 'You have an assignment due soon',
      icon: '/icons/icon-192.png',
    })
  )
})

// Older releases cached the authenticated start page through next-pwa's
// default runtime route. New releases cache static assets only.
self.addEventListener('activate', function(event) {
  event.waitUntil(caches.delete('start-url'))
})

// Always use our own planner URL; never navigate to a payload-supplied URL.
// https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/notificationclick_event
self.addEventListener('notificationclick', function(event) {
  event.notification.close()
  const dashboard = new URL('/dashboard', self.location.origin).href
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of windows) {
      const url = new URL(client.url)
      if (url.origin !== self.location.origin) continue
      if (url.pathname !== '/dashboard' && !url.pathname.startsWith('/dashboard/')) {
        const navigated = await client.navigate(dashboard)
        if (navigated) return navigated.focus()
        continue
      }
      return client.focus()
    }
    return self.clients.openWindow(dashboard)
  })())
})
