import assert from 'node:assert/strict'
import test from 'node:test'
import { createReminders, dueReminders, validateSubscription } from './reminders.ts'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createECDH } from 'node:crypto'
import { createApp } from './server.ts'
import { emptyState, saveHabit, settingsOf } from './model.ts'

test('reminders respect local time, Android weekday bits, archive, and completion', () => {
  const state = saveHabit(emptyState(), { id: 'walk', name: 'Walk', type: 'boolean', parentId: null,
    target: 1, unit: '', color: '#6750a4', settings: { ...settingsOf(),
      reminder: { hour: 9, minute: 30, days: 32 } } })
  const now = new Date('2026-11-19T08:30:00Z')
  assert.deepEqual(dueReminders(state, now, 'Europe/Berlin', () => false).map(h => h.id), ['walk'])
  assert.equal(dueReminders(state, now, 'UTC', () => false).length, 0)
  assert.equal(dueReminders(state, now, 'Europe/Berlin', () => true).length, 0)
  state.habits[0]!.settings!.archived = true
  assert.equal(dueReminders(state, now, 'Europe/Berlin', () => false).length, 0)
})

test('subscriptions reject arbitrary network destinations and malformed keys', () => {
  for (const endpoint of ['http://localhost/push', 'https://127.0.0.1/push', 'https://example.com/push']) {
    assert.throws(() => validateSubscription({ endpoint, keys: { p256dh: 'x', auth: 'y' } }))
  }
  assert.throws(() => validateSubscription({ endpoint: 'https://fcm.googleapis.com/push', keys: { p256dh: 'x', auth: 'y' } }))
})

test('reminders survive restart and avoid duplicate delivery within the same minute', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'loop-reminder-test-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const app = createApp({ dataDirectory: directory })
  const { id, state } = await (await app.request('http://localhost:5173/api/sessions', { method: 'POST' })).json()
  state.habits.push({ id: 'walk', name: 'Walk', type: 'boolean', parentId: null, target: 1, unit: '', color: '#6750a4', entries: {},
    settings: { ...settingsOf(), reminder: { hour: 9, minute: 30, days: 127 } } })
  assert.equal((await app.request('http://localhost:5173/api/state', { method: 'PUT', headers: {
    'X-Loop-Session': id, 'Content-Type': 'application/json' }, body: JSON.stringify(state) })).status, 200)
  let deliveries = 0
  const send = async () => { deliveries++; return { statusCode: 201, body: '', headers: {} }; }
  const manager = createReminders(directory, send)
  const key = createECDH('prime256v1')
  key.generateKeys()
  const subscription = { endpoint: 'https://fcm.googleapis.com/push/test', keys: {
    p256dh: key.getPublicKey().toString('base64url'), auth: Buffer.alloc(16, 1).toString('base64url') } }
  await manager.subscribe(id, subscription, 'UTC')
  const publicKey = await manager.publicKey()
  await manager.tick(new Date('2026-11-19T09:30:00Z'))
  const restarted = createReminders(directory, send)
  assert.equal(await restarted.publicKey(), publicKey)
  await restarted.tick(new Date('2026-11-19T09:30:15Z'))
  assert.equal(deliveries, 1)
  await restarted.unsubscribe(id, subscription.endpoint)
  await restarted.tick(new Date('2026-11-20T09:30:00Z'))
  assert.equal(deliveries, 1)
})
