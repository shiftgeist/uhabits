import * as webPush from 'web-push'
import { createHash } from 'node:crypto'
import type { PushSubscription } from 'web-push'
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { settingsOf } from './model.ts'
import type { State } from './model.ts'
import { openDatabase } from './android-backup.ts'
import { calculateMetrics } from './metrics.ts'
import { signAction, verifyAction } from './notification.ts'

export function validateSubscription(value: unknown): PushSubscription {
  const input = value as PushSubscription
  if (!input || typeof input.endpoint !== 'string' || input.endpoint.length > 4096) throw new Error('Invalid push subscription.')
  const url = new URL(input.endpoint)
  const allowed = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com']
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash
    || !allowed.includes(url.hostname)) throw new Error('Unsupported push service.')
  for (const [key, length] of [['p256dh', 65], ['auth', 16]] as const) {
    const text = input.keys?.[key]
    if (typeof text !== 'string' || !/^[\w-]+$/.test(text) || Buffer.from(text, 'base64url').length !== length) throw new Error('Invalid push key.')
  }
  return { endpoint: url.href, keys: { p256dh: input.keys.p256dh, auth: input.keys.auth } }
}

export function reminderClock(now: Date, timeZone: string, extended = false) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now)
  const get = (type: string) => parts.find(part => part.type === type)!.value
  let day = `${get('year')}-${get('month')}-${get('day')}`
  const weekday = (new Date(`${day}T12:00:00Z`).getUTCDay() + 1) % 7
  if (extended && Number(get('hour')) < 3) day = new Date(Date.parse(`${day}T12:00:00Z`) - 86400000).toISOString().slice(0, 10)
  return { day, hour: Number(get('hour')), minute: Number(get('minute')), weekday }
}

export function dueReminders(state: State, now: Date, timeZone: string, complete: (id: string, day: string) => boolean, extended = false) {
  const clock = reminderClock(now, timeZone, extended)
  return state.habits.filter(habit => {
    const settings = settingsOf(habit)
    const reminder = settings.reminder
    return habit.type !== 'group' && !settings.archived && reminder && reminder.hour === clock.hour
      && reminder.minute === clock.minute && Boolean(reminder.days & (1 << clock.weekday))
      && (settings.targetType === 1 || !complete(habit.id, clock.day))
  })
}

interface Registration { subscription: PushSubscription; timeZone: string; extended?: boolean; sent: Record<string, string> }

export function createReminders(directory: string, send = webPush.sendNotification) {
  let pending = Promise.resolve()
  const serial = <T>(action: () => Promise<T>): Promise<T> => {
    const result = pending.then(action)
    pending = result.then(() => {}, () => {})
    return result
  }
  async function save(file: string, value: unknown) {
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const path = join(directory, file)
    await writeFile(`${path}.tmp`, JSON.stringify(value), { mode: 0o600, flush: true })
    await rename(`${path}.tmp`, path)
  }
  async function keys() {
    try { return JSON.parse(await readFile(join(directory, 'push-keys.json'), 'utf8')) as ReturnType<typeof webPush.generateVAPIDKeys>; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      const value = webPush.generateVAPIDKeys()
      await save('push-keys.json', value)
      return value
    }
  }
  async function registrations(id: string): Promise<Registration[]> {
    try { return JSON.parse(await readFile(join(directory, `${id}.push.json`), 'utf8')) as Registration[]; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  }
  return {
    authorize: (token: string) => serial(async () => verifyAction(token, (await keys()).privateKey)),
    publicKey: () => serial(async () => (await keys()).publicKey),
    subscribe: (id: string, value: unknown, timeZone: string, extended = false) => serial(async () => {
      const subscription = validateSubscription(value)
      reminderClock(new Date(), timeZone)
      const items = await registrations(id)
      const previous = items.find(item => item.subscription.endpoint === subscription.endpoint)
      const others = items.filter(item => item !== previous)
      if (others.length >= 8) throw new Error('Too many reminder devices.')
      await save(`${id}.push.json`, [...others, { subscription, timeZone, extended, sent: previous?.sent ?? {} }])
    }),
    unsubscribe: (id: string, endpoint?: string) => serial(async () => {
      await save(`${id}.push.json`, endpoint ? (await registrations(id)).filter(item => item.subscription.endpoint !== endpoint) : [])
    }),
    tick: (now = new Date()) => serial(async () => {
      const files = await readdir(directory).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return []
        throw error
      })
      for (const file of files.filter(file => /^[0-9a-f-]{36}\.push\.json$/.test(file))) {
        const id = file.slice(0, -10)
        const items = await registrations(id)
        if (!items.length) continue
        let database
        try { database = openDatabase(await readFile(join(directory, `${id}.db`))); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
        const state = database.read()
        database.close()
        const remaining: Registration[] = []
        for (const item of items) {
          const clock = reminderClock(now, item.timeZone, item.extended)
          const metrics = calculateMetrics(state, clock.day)
          let expired = false
          const sent: Record<string, string> = {}
          for (const habit of state.habits) if (item.sent[habit.id]?.startsWith(clock.day)) sent[habit.id] = item.sent[habit.id]!
          item.sent = sent
          for (const habit of dueReminders(state, now, item.timeZone, (id, day) => metrics[id]?.entries[day]?.completed ?? false, item.extended)) {
            const stamp = `${clock.day}:${clock.hour}:${clock.minute}`
            if (item.sent[habit.id] === stamp) continue
            try {
              await send(validateSubscription(item.subscription), JSON.stringify({ title: habit.name,
                body: settingsOf(habit).question || 'Time for your habit.', tag: habit.id,
                habit: habit.id, day: clock.day, type: habit.type,
                database: createHash('sha256').update(id).digest('hex'),
                token: habit.type === 'boolean' ? signAction({ session: id, habit: habit.id, day: clock.day,
                  expires: now.getTime() + 24 * 60 * 60 * 1000 }, (await keys()).privateKey) : undefined }), {
                TTL: 300, timeout: 10000, vapidDetails: { ...await keys(), subject: 'https://loophabits.org' }
              })
              item.sent[habit.id] = stamp
            } catch (error) {
              if ([404, 410].includes((error as { statusCode: number }).statusCode)) { expired = true; break; }
              console.error('Reminder delivery failed; the server will retry this minute.')
            }
          }
          if (!expired) remaining.push(item)
        }
        await save(file, remaining)
      }
    })
  }
}
