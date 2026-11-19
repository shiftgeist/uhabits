self.addEventListener('push', event => {
  const data = event.data?.json()
  if (!data || typeof data.title !== 'string') return
  event.waitUntil(self.registration.showNotification(data.title, {
    body: typeof data.body === 'string' ? data.body : '', tag: data.tag
  }))
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const client = windows.find(client => client.url.startsWith(self.registration.scope))
    if (client) return client.focus()
    return self.clients.openWindow(self.registration.scope)
  })())
})
