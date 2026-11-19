import assert from 'node:assert/strict'
import test from 'node:test'
import { createApp } from './server.ts'
import { createDatabaseClient } from './client.ts'

const storage = () => {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); }
  }
}

test('reconnects to imported database after reload without affecting other tabs', async () => {
  const app = createApp()
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => app.request(input, init)
  const tab = storage()
  const first = createDatabaseClient('http://localhost:5173', tab, fetcher)
  const state = await first.connect()
  state.habits.push({ id: 'walk', name: 'Walk', type: 'boolean', parentId: null, target: 1, unit: '', color: '#d32f2f', entries: {} })
  assert.equal((await first.client.api.state.$put({ json: state })).status, 200)
  const backup = await (await first.client.api.export.$get()).arrayBuffer()
  assert.equal((await first.client.api.import.$post({}, { init: { body: backup } })).status, 200)
  const reloaded = createDatabaseClient('http://localhost:5173', tab, fetcher)
  assert.equal((await reloaded.connect()).habits[0].name, 'Walk')
  const other = createDatabaseClient('http://localhost:5173', storage(), fetcher)
  assert.deepEqual((await other.connect()).habits, [])
  await first.client.api.session.$delete()
  await other.client.api.session.$delete()
})

test('reports expired sessions instead of silently replacing the database', async () => {
  const app = createApp()
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => app.request(input, init)
  const tab = storage()
  const first = createDatabaseClient('http://localhost:5173', tab, fetcher)
  await first.connect()
  await first.client.api.session.$delete()
  const reloaded = createDatabaseClient('http://localhost:5173', tab, fetcher)
  await assert.rejects(() => reloaded.connect(), /expired/)
  const state = await reloaded.connect()
  assert.deepEqual(state.habits, [])
  assert.deepEqual(state.collapsedIds, [])
  assert.equal(typeof state.revision, 'string')
  await reloaded.client.api.session.$delete()
})
