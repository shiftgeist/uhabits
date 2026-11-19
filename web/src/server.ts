import { readFile, mkdir, writeFile, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { stripTypeScriptTypes } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createAdaptorServer } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { secureHeaders } from 'hono/secure-headers'
import { bodyLimit } from 'hono/body-limit'
import { LoopDatabase, openDatabase, ServerSQLite } from './android-backup.ts'
import { validateState, setRecord } from './model.ts'
import { validator } from 'hono/validator'
import { createReminders } from './reminders.ts'

const assets = {
  '/': 'index.html',
  '/index.html': 'index.html',
  '/app.ts': 'app.ts',
  '/client.ts': 'client.ts',
  '/model.ts': 'model.ts',
  '/csv.ts': 'csv.ts',
  '/metrics.ts': 'metrics.ts',
  '/charts.ts': 'charts.ts',
  '/day.ts': 'day.ts',
  '/core.ts': 'core.ts',
  '/style.css': 'style.css',
  '/sw.js': 'sw.js'
}

export function createApp(options: { dataDirectory?: string; reminders?: ReturnType<typeof createReminders> } = {}) {
  const app = new Hono()
  const reminders = options.reminders ?? (options.dataDirectory ? createReminders(options.dataDirectory) : null)
  const sessions = new Map<string, { database: LoopDatabase; touched: number; pending?: Promise<void> }>()
  async function persist(id: string, database: LoopDatabase) {
    if (!options.dataDirectory) return
    await mkdir(options.dataDirectory, { recursive: true, mode: 0o700 })
    const destination = join(options.dataDirectory, `${id}.db`)
    const temporary = `${destination}.${crypto.randomUUID()}.tmp`
    try {
      await writeFile(temporary, database.export(), { mode: 0o600, flag: 'wx', flush: true })
      await rename(temporary, destination)
    } finally { await unlink(temporary).catch(() => {}); }
  }
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
      return readFile(new URL(`../../uhabits-core/assets/main/migrations/${name}.sql`, import.meta.url), 'utf8')
    }))
    const native = new ServerSQLite()
    try {
      native.executeScript(`${migrations.join('\n;\n')}\n;\nPRAGMA user_version=27;`)
      const database = new LoopDatabase(native)
      const id = crypto.randomUUID()
      await persist(id, database)
      sessions.set(id, { database, touched: Date.now() })
      return c.json({ id, state: database.read() }, 201)
    } catch (error) { native.close(); throw error; }
  })
  .use('/api/*', async (c, next) => {
    if (c.req.path === '/api/notification' && c.req.method === 'POST') {
      try {
        const action = await reminders?.authorize(c.req.header('Authorization')?.replace(/^Bearer /, '') ?? '')
        if (!action) return c.json({ error: 'Invalid notification credential.' }, 401)
        c.req.raw.headers.set('X-Loop-Session', action.session)
      } catch { return c.json({ error: 'Invalid or expired notification credential.' }, 401); }
    }
    const id = c.req.header('X-Loop-Session') ?? ''
    if (!sessions.has(id) && options.dataDirectory && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(id)) {
      try {
        const bytes = await readFile(join(options.dataDirectory, `${id}.db`))
        if (!sessions.has(id)) {
          if (sessions.size >= 32) return c.json({ error: 'Too many open database sessions.' }, 503)
          sessions.set(id, { database: openDatabase(bytes), touched: Date.now() })
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return c.json({ error: 'Could not open the saved database.' }, 500)
      }
    }
    const session = sessions.get(id)
    if (!session) return c.json({ error: 'Database session expired. Reload the page.' }, 404)
    session.touched = Date.now()
    const previous = session.pending
    let release!: () => void
    session.pending = new Promise<void>(resolve => { release = resolve })
    await previous
    try { await next(); } finally { release(); }
  })
  .get('/api/state', c => c.json(sessions.get(c.req.header('X-Loop-Session')!)!.database.read()))
  .post('/api/notification', async c => {
    const action = await reminders!.authorize(c.req.header('Authorization')!.replace(/^Bearer /, ''))
    const session = sessions.get(action.session)!
    const previous = session.database.export()
    try {
      const { value } = await c.req.json()
      const state = session.database.read()
      const habit = state.habits.find(habit => habit.id === action.habit)
      if (!habit || habit.type !== 'boolean' || ![0, 1].includes(value)) throw new Error('Invalid notification action.')
      session.database.write(setRecord(state, habit.id, action.day, value))
      await persist(action.session, session.database)
      return c.json({ saved: true })
    } catch (error) {
      session.database.close()
      session.database = openDatabase(previous)
      return c.json({ error: 'Could not save this notification action.' }, 400)
    }
  })
  .get('/api/push/key', async c => reminders
    ? c.json({ publicKey: await reminders.publicKey() }) : c.json({ error: 'Reminders require persistent storage.' }, 503))
  .post('/api/push/subscription', async c => {
    if (!reminders) return c.json({ error: 'Reminders require persistent storage.' }, 503)
    try {
      const { subscription, timeZone, extended = false } = await c.req.json()
      if (typeof extended !== 'boolean') throw new Error('Invalid extended day preference.')
      if (typeof timeZone !== 'string' || timeZone.length > 100) throw new Error('Invalid time zone.')
      await reminders.subscribe(c.req.header('X-Loop-Session')!, subscription, timeZone, extended)
      return c.json({ enabled: true })
    } catch { return c.json({ error: 'Invalid subscription, time zone, or unsupported push service.' }, 400); }
  })
  .delete('/api/push/subscription', async c => {
    if (!reminders) return c.json({ error: 'Reminders require persistent storage.' }, 503)
    const endpoint = c.req.query('endpoint')
    if (!endpoint) return c.json({ error: 'Specify the device endpoint.' }, 400)
    await reminders.unsubscribe(c.req.header('X-Loop-Session')!, endpoint)
    return c.json({ enabled: false })
  })
  .put('/api/state', validator('json', (value, c) => {
    try { return validateState(value); }
    catch (error) { return c.json({ error: error instanceof Error ? error.message : 'Invalid state.' }, 400); }
  }), async c => {
    try {
      const input = c.req.valid('json')
      const id = c.req.header('X-Loop-Session')!
      const session = sessions.get(id)!
      const previous = session.database.export()
      try {
        const result = session.database.write(input)
        await persist(id, session.database)
        return c.json(result)
      } catch (error) {
        session.database.close()
        session.database = openDatabase(previous)
        throw error
      }
    } catch (error) { return c.json({ error: error instanceof Error ? error.message : 'Invalid state.' }, 400); }
  })
  .post('/api/import', async c => {
    try {
      const database = openDatabase(new Uint8Array(await c.req.arrayBuffer()))
      const id = c.req.header('X-Loop-Session')!
      try { await persist(id, database); } catch (error) { database.close(); throw error; }
      const session = sessions.get(id)!
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
  .delete('/api/session', async c => {
    const id = c.req.header('X-Loop-Session')!
    await reminders?.unsubscribe(id)
    if (options.dataDirectory) await unlink(join(options.dataDirectory, `${id}.db`))
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
  app.get('/core/:file', async c => {
    const file = c.req.param('file')
    if (!/^[\w-]+\.mjs$/.test(file)) return c.notFound()
    try {
      const source = await readFile(new URL(`../../uhabits-core/build/dist/js/productionLibrary/${file}`, import.meta.url), 'utf8')
      return c.body(source, 200, { 'Content-Type': 'text/javascript; charset=utf-8' })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return c.notFound()
      throw error
    }
  })
  for (const [route, file] of Object.entries(assets)) {
    const url = new URL(file.endsWith('.ts') ? file : `../public/${file}`, import.meta.url)
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
  const dataDirectory = process.env.LOOP_DATA_DIR ?? join(homedir(), '.loop-web')
  const reminders = createReminders(dataDirectory)
  const server = createAdaptorServer({ fetch: createApp({ dataDirectory, reminders }).fetch })
  let running = false
  const timer = setInterval(async () => {
    if (running) return
    running = true
    try { await reminders.tick(); } catch { console.error('Could not process habit reminders.'); }
    finally { running = false; }
  }, 15000)
  timer.unref()
  server.on('close', () => clearInterval(timer))
  return server
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createAppServer().listen(5173, '127.0.0.1', () => console.log('Loop Web: http://127.0.0.1:5173'))
}
