import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

test('service worker exposes Boolean actions and sends authenticated entry requests', async () => {
  const handlers: Record<string, (event: unknown) => void> = {}
  const notifications: { title: string; options: { actions: { action: string }[] } }[] = []
  const requests: { url: string; options: RequestInit }[] = []
  const self = {
    addEventListener: (name: string, handler: (event: unknown) => void) => { handlers[name] = handler },
    registration: { scope: 'http://localhost:5173/', showNotification: async (title: string, options: { actions: { action: string }[] }) => {
      notifications.push({ title, options })
    } },
    clients: { matchAll: async () => [] }
  }
  runInNewContext(await readFile(new URL('../public/sw.js', import.meta.url), 'utf8'), {
    self, URL, URLSearchParams, fetch: async (url: string, options: RequestInit) => {
      requests.push({ url, options })
      return { ok: true }
    }
  })
  let pending: Promise<unknown> = Promise.resolve()
  const waitUntil = (promise: Promise<unknown>) => { pending = promise }
  handlers.push({ data: { json: () => ({ title: 'Walk', type: 'boolean', token: 'credential' }) }, waitUntil })
  await pending
  assert.equal(notifications[0]!.options.actions[0].action, 'yes')
  assert.equal(notifications[0]!.options.actions[1].action, 'no')
  for (const [action, value] of [['yes', 1], ['no', 0]] as const) {
    handlers.notificationclick({ action, notification: { close() {}, data: { token: 'credential' } }, waitUntil })
    await pending
    assert.equal(requests.at(-1)!.url, '/api/notification')
    assert.equal((requests.at(-1)!.options.headers as Record<string, string>).Authorization, 'Bearer credential')
    assert.deepEqual(JSON.parse(requests.at(-1)!.options.body as string), { value })
  }
})
