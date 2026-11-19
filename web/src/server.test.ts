import assert from 'node:assert/strict'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stripTypeScriptTypes } from 'node:module'
import test from 'node:test'
import { createApp } from './server.ts'
import { hc } from 'hono/client'
import type { AppType } from './server.ts'

test('push endpoints require a database session and reject arbitrary destinations', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'loop-push-test-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const app = createApp({ dataDirectory: directory })
  assert.equal((await app.request('http://localhost:5173/api/push/key')).status, 404)
  const { id } = await (await app.request('http://localhost:5173/api/sessions', { method: 'POST' })).json()
  const headers = { 'X-Loop-Session': id, 'Content-Type': 'application/json' }
  const response = await app.request('http://localhost:5173/api/push/key', { headers })
  assert.equal(response.status, 200)
  assert.equal(typeof (await response.json()).publicKey, 'string')
  assert.equal((await app.request('http://localhost:5173/api/push/subscription', { method: 'POST', headers,
    body: JSON.stringify({ subscription: { endpoint: 'https://localhost/push' }, timeZone: 'UTC' }) })).status, 400)
})

test('durable sessions recover records after a server restart and delete their snapshot explicitly', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'loop-web-test-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const first = createApp({ dataDirectory: directory })
  const { id, state } = await (await first.request('http://localhost:5173/api/sessions', { method: 'POST' })).json()
  const headers = { 'X-Loop-Session': id, 'Content-Type': 'application/json' }
  state.habits.push({ id: 'walk', name: 'Walk', type: 'boolean', parentId: null, target: 1, unit: '', color: '#d32f2f', entries: {} })
  assert.equal((await first.request('http://localhost:5173/api/state', { method: 'PUT', headers, body: JSON.stringify(state) })).status, 200)
  const restarted = createApp({ dataDirectory: directory })
  const recovered = await restarted.request('http://localhost:5173/api/state', { headers })
  assert.equal(recovered.status, 200)
  assert.equal((await recovered.json()).habits[0].name, 'Walk')
  assert.equal((await restarted.request('http://localhost:5173/api/session', { method: 'DELETE', headers })).status, 204)
  const third = createApp({ dataDirectory: directory })
  assert.equal((await third.request('http://localhost:5173/api/state', { headers })).status, 404)
  assert.equal((await third.request('http://localhost:5173/api/state', { headers: { 'X-Loop-Session': '../secret' } })).status, 404)
})

test('serves browser modules without a WASM dependency', async () => {
  const app = createApp()
  for (const name of ['app.ts', 'client.ts', 'model.ts']) {
    const response = await app.request(`http://localhost:5173/${name}`)
    assert.equal(response.status, 200)
    assert.match(response.headers.get('Content-Type') ?? '', /javascript/)
    assert.doesNotMatch(response.headers.get('Content-Security-Policy') ?? '', /wasm-unsafe-eval/)
    assert.equal(await response.text(), stripTypeScriptTypes(await readFile(new URL(name, import.meta.url), 'utf8')).replaceAll("from 'hono/client'", "from '/vendor/hono/client/index.js'"))
  }
})

test('serves the shared Kotlin module graph without exposing build metadata', async () => {
  const app = createApp()
  const pending = ['http://localhost:5173/core/uhabits-uhabits-core.mjs']
  const visited = new Set<string>()
  while (pending.length) {
    const url = pending.pop()!
    if (visited.has(url)) continue
    visited.add(url)
    const response = await app.request(url)
    assert.equal(response.status, 200, url)
    assert.match(response.headers.get('Content-Type') ?? '', /javascript/)
    const source = await response.text()
    for (const match of source.matchAll(/from\s+["']([^"']+)["']/g)) {
      assert.match(match[1], /^\.\/[\w-]+\.mjs$/)
      pending.push(new URL(match[1], url).href)
    }
  }
  assert.ok(visited.size > 1)
  assert.equal((await app.request('http://localhost:5173/core/package.json')).status, 404)
})

test('serves the complete browser client module graph and supports typed RPC', async () => {
  const app = createApp()
  const pending = ['http://localhost:5173/vendor/hono/client/index.js']
  const visited = new Set<string>()
  while (pending.length) {
    const url = pending.pop()!
    if (visited.has(url)) continue
    visited.add(url)
    const response = await app.request(url)
    assert.equal(response.status, 200, url)
    assert.match(response.headers.get('Content-Type') ?? '', /javascript/)
    const source = await response.text()
    for (const match of source.matchAll(/from\s+["']([^"']+)["']/g)) {
      assert.match(match[1], /^\./)
      pending.push(new URL(match[1], url).href)
    }
  }
  let id = ''
  const client = hc<AppType>('http://localhost:5173', {
    headers: () => ({ 'X-Loop-Session': id }),
    fetch: (input: RequestInfo | URL, init?: RequestInit) => app.request(input, init)
  })
  const created = await client.api.sessions.$post()
  assert.equal(created.status, 201)
  if (created.status !== 201) return
  id = (await created.json()).id
  const updated = await client.api.state.$put({ json: { habits: [], collapsedIds: [] } })
  assert.equal(updated.status, 200)
  assert.equal((await client.api.session.$delete()).status, 204)
})

test('edits, exports and imports a database through isolated server sessions', async () => {
  const app = createApp()
  const request = (path: string, init?: RequestInit) => app.request(`http://localhost:5173${path}`, init)
  const first = await request('/api/sessions', { method: 'POST' })
  assert.equal(first.status, 201)
  const { id, state } = await first.json()
  const headers = { 'X-Loop-Session': id, 'Content-Type': 'application/json' }
  state.habits.push({ id: 'walk', name: 'Walk', type: 'boolean', parentId: null, target: 1, unit: '', color: '#d32f2f', entries: {} })
  const saved = await request('/api/state', { method: 'PUT', headers, body: JSON.stringify(state) })
  assert.equal(saved.status, 200)
  assert.equal((await saved.json()).habits[0].name, 'Walk')
  const exported = await request('/api/export', { headers })
  assert.equal(exported.status, 200)
  const bytes = await exported.arrayBuffer()
  assert.equal(new TextDecoder().decode(bytes.slice(0, 16)), 'SQLite format 3\0')
  const second = await (await request('/api/sessions', { method: 'POST' })).json()
  assert.deepEqual(second.state.habits, [])
  const imported = await request('/api/import', { method: 'POST', headers: { 'X-Loop-Session': second.id }, body: bytes })
  assert.equal(imported.status, 200)
  assert.equal((await imported.json()).habits[0].name, 'Walk')
  assert.equal((await request('/api/import', { method: 'POST', headers, body: 'invalid' })).status, 400)
  assert.equal((await (await request('/api/state', { headers })).json()).habits[0].name, 'Walk')
  assert.equal((await request('/api/state')).status, 404)
  assert.equal((await request('/api/state', { method: 'PUT', headers, body: '{}' })).status, 400)
  assert.equal((await request('/api/import', { method: 'POST', headers: { ...headers, Origin: 'https://example.com' }, body: bytes })).status, 403)
  assert.equal((await request('/api/import', { method: 'POST', headers, body: new Uint8Array(10 * 1024 * 1024 + 1) })).status, 413)
  for (const session of [id, second.id]) {
    assert.equal((await request('/api/session', { method: 'DELETE', headers: { 'X-Loop-Session': session } })).status, 204)
  }
})

test('rejects foreign origins and hides private files', async () => {
  const app = createApp()
  assert.equal((await app.request('http://example.com:5173/')).status, 403)
  assert.equal((await app.request('http://localhost:5173/', { headers: { Origin: 'null' } })).status, 403)
  for (const path of ['/server.ts', '/android-backup.ts', '/sqlite.js', '/schema.sql', '/database.test.ts', '/package.json', '/node_modules/hono/package.json']) {
    assert.equal((await app.request(`http://localhost:5173${path}`)).status, 404)
  }
  const head = await app.request('http://localhost:5173/app.ts', { method: 'HEAD' })
  assert.equal(head.status, 200)
  assert.equal(await head.text(), '')
})
