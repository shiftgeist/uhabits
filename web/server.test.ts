import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'
import test from 'node:test'
import { createApp } from './server.ts'
import { hc } from 'hono/client'
import type { AppType } from './server.ts'

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
