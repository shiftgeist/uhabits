self.addEventListener('push', event => {
  const data = event.data?.json()
  if (!data || typeof data.title !== 'string') return
  event.waitUntil(self.registration.showNotification(data.title, {
    body: typeof data.body === 'string' ? data.body : '', tag: data.tag,
    actions: data.type === 'boolean' ? [{ action: 'yes', title: 'Yes' }, { action: 'no', title: 'No' }]
      : [{ action: 'enter', title: 'Enter' }],
    data: { token: data.token, habit: data.habit, day: data.day, database: data.database }
  }))
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  event.waitUntil((async () => {
    if (['yes', 'no'].includes(event.action) && event.notification.data?.token) {
      try {
        const response = await fetch('/api/notification', { method: 'POST', headers: {
          'Content-Type': 'application/json', Authorization: `Bearer ${event.notification.data.token}`
        }, body: JSON.stringify({ value: event.action === 'yes' ? 1 : 0 }) })
        if (!response.ok) throw new Error('Could not save entry.')
        const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
        for (const client of windows) client.postMessage({ type: 'entry-saved' })
        return
      } catch {
        await self.registration.showNotification('Entry not saved', {
          body: 'Open Loop to enter your result.', tag: 'entry-failed'
        })
      }
    }
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const target = new URL(self.registration.scope)
    if (event.notification.data?.habit && event.notification.data?.day) {
      target.hash = new URLSearchParams({ habit: event.notification.data.habit, day: event.notification.data.day,
        database: event.notification.data.database ?? '' }).toString()
    }
    const client = windows.find(client => client.url.startsWith(self.registration.scope))
    if (client && !target.hash) return client.focus()
    return self.clients.openWindow(target.href)
  })())
})
