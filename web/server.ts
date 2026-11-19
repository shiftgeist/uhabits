import { readFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createAdaptorServer } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { secureHeaders } from 'hono/secure-headers'
import { bodyLimit } from 'hono/body-limit'
import { LoopDatabase, openDatabase, ServerSQLite } from './android-backup.ts'
import { validateState } from './model.ts'
import { validator } from 'hono/validator'

const assets = {
  '/': 'index.html',
  '/index.html': 'index.html',
  '/app.ts': 'app.ts',
  '/client.ts': 'client.ts',
  '/model.ts': 'model.ts',
  '/style.css': 'style.css'
}

export function createApp() {
  const app = new Hono()
  const sessions = new Map<string, { database: LoopDatabase; touched: number }>()
  app.use(secureHeaders({
    strictTransportSecurity: false,
    contentSecurityPolicy: {
      defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"],
      connectSrc: ["'self'"], objectSrc: ["'none'"], baseUri: ["'none'"], frameAncestors: ["'none'"]
    }
  }))
  app.use(async (c, next) => {
    c.header('Cache-Control', 'no-store')
    const host = c.req.header('Host') ?? new URL(c.req.url).host
    const origin = c.req.header('Origin')
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host)
      || (origin && origin !== `http://${host}`)) return c.text('Forbidden origin', 403)
    await next()
  })
  app.use('/api/*', bodyLimit({
    maxSize: 10 * 1024 * 1024,
    onError: c => c.json({ error: 'Choose a backup smaller than 10 MB.' }, 413)
  }))
  app.use('/api/*', async (c, next) => {
    for (const [id, session] of sessions) {
      if (Date.now() - session.touched > 24 * 60 * 60 * 1000) {
        session.database.close()
        sessions.delete(id)
      }
    }
    await next()
  })
  const routes = app.post('/api/sessions', async c => {
    if (sessions.size >= 32) return c.json({ error: 'Too many open database sessions.' }, 503)
    const migrations = await Promise.all(Array.from({ length: 19 }, (_, index) => {
      const name = String(index + 9).padStart(2, '0')
      return readFile(new URL(`../uhabits-core/assets/main/migrations/${name}.sql`, import.meta.url), 'utf8')
    }))
    const native = new ServerSQLite()
    try {
      native.executeScript(`${migrations.join('\n;\n')}\n;\nPRAGMA user_version=27;`)
      const database = new LoopDatabase(native)
      const id = crypto.randomUUID()
      sessions.set(id, { database, touched: Date.now() })
      return c.json({ id, state: database.read() }, 201)
    } catch (error) { native.close(); throw error; }
  })
  .use('/api/*', async (c, next) => {
    const session = sessions.get(c.req.header('X-Loop-Session') ?? '')
    if (!session) return c.json({ error: 'Database session expired. Reload the page.' }, 404)
    session.touched = Date.now()
    await next()
  })
  .get('/api/state', c => c.json(sessions.get(c.req.header('X-Loop-Session')!)!.database.read()))
  .put('/api/state', validator('json', (value, c) => {
    try { return validateState(value); }
    catch (error) { return c.json({ error: error instanceof Error ? error.message : 'Invalid state.' }, 400); }
  }), async c => {
    try {
      const input = c.req.valid('json')
      return c.json(sessions.get(c.req.header('X-Loop-Session')!)!.database.write(input))
    } catch (error) { return c.json({ error: error instanceof Error ? error.message : 'Invalid state.' }, 400); }
  })
  .post('/api/import', async c => {
    try {
      const database = openDatabase(new Uint8Array(await c.req.arrayBuffer()))
      const session = sessions.get(c.req.header('X-Loop-Session')!)!
      session.database.close()
      session.database = database
      return c.json(database.read())
    } catch (error) { return c.json({ error: error instanceof Error ? error.message : 'Invalid database.' }, 400); }
  })
  .get('/api/export', c => {
    c.header('Content-Type', 'application/vnd.sqlite3')
    c.header('Content-Disposition', 'attachment; filename="loop-web.db"')
    return c.body(new Uint8Array(sessions.get(c.req.header('X-Loop-Session')!)!.database.export()))
  })
  .delete('/api/session', c => {
    const id = c.req.header('X-Loop-Session')!
    sessions.get(id)!.database.close()
    sessions.delete(id)
    return c.body(null, 204)
  })
  app.get('/vendor/hono/*', async c => {
    const path = c.req.path.slice('/vendor/hono/'.length)
    if (!/^(client|utils)\/[a-z-]+\.js$/.test(path)) return c.notFound()
    const url = new URL(`../${path}`, import.meta.resolve('hono/client'))
    return c.body(await readFile(url, 'utf8'), 200, { 'Content-Type': 'text/javascript; charset=utf-8' })
  })
  for (const [route, file] of Object.entries(assets)) {
    const url = new URL(file, import.meta.url)
    if (file.endsWith('.ts')) {
      app.get(route, async c => c.body(stripTypeScriptTypes(await readFile(url, 'utf8')).replaceAll("from 'hono/client'", "from '/vendor/hono/client/index.js'"), 200, {
        'Content-Type': 'text/javascript; charset=utf-8'
      }))
    } else {
      app.get(route, serveStatic({ path: fileURLToPath(url) }))
    }
  }
  app.onError((_error, c) => c.text('Could not load a local asset. Check the server dependencies.', 500))
  return routes
}

export type AppType = ReturnType<typeof createApp>

export function createAppServer() {
  return createAdaptorServer({ fetch: createApp().fetch })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createAppServer().listen(5173, '127.0.0.1', () => console.log('Loop Web: http://127.0.0.1:5173'))
}
