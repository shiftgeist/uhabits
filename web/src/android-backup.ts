import { emptyState, validateState, settingsOf } from './model.ts'
import type { AndroidFields, State } from './model.ts'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { sql } from 'drizzle-orm'

export type SqlValue = string | number | null | Uint8Array
export class ServerSQLite {
  private native: Database.Database
  private orm: ReturnType<typeof drizzle>

  constructor(source?: Uint8Array | Database.Database) {
    this.native = source instanceof Database ? source : new Database(source ? Buffer.from(source) : ':memory:')
    this.orm = drizzle(this.native)
  }

  private query(text: string, values: SqlValue[]) {
    const parts = text.split('?')
    if (parts.length !== values.length + 1) throw new Error('Invalid SQL parameters.')
    return sql.join(parts.flatMap((part, index) => index < values.length
      ? [sql.raw(part), sql`${values[index]}`] : [sql.raw(part)]), sql.raw(''))
  }

  run(text: string, values: SqlValue[] = []) { return this.orm.run(this.query(text, values)); }

  all(text: string, values: SqlValue[] = []): Record<string, SqlValue>[] { return this.orm.all(this.query(text, values)); }

  executeScript(text: string) { this.native.exec(text); }
  export() { return new Uint8Array(this.native.serialize()); }
  close() { this.native.close(); }
}

const palette = [
  '#d32f2f', '#e64a19', '#f57c00', '#ff8f00', '#f9a825', '#afb42b', '#7cb342',
  '#388e3c', '#00897b', '#00acc1', '#039be5', '#1976d2', '#303f9f', '#5e35b1',
  '#8e24aa', '#d81b60', '#5d4037', '#424242', '#757575', '#9e9e9e'
]
const types = ['boolean', 'number', 'group'] as const
const millisecondsPerDay = 86_400_000

function nearestColor(color: string): number {
  const rgb = (value: string) => [1, 3, 5].map(start => parseInt(value.slice(start, start + 2), 16))
  const actual = rgb(color)
  const distance = (value: string) => rgb(value).reduce((sum, channel, index) => sum + (channel - actual[index]) ** 2, 0)
  return palette.reduce((best, value, index) => distance(value) < distance(palette[best]) ? index : best, 0)
}

export class LoopDatabase {
  private db: ServerSQLite
  private revision = crypto.randomUUID()

  constructor(db: ServerSQLite) {
    this.db = db
    db.run('PRAGMA trusted_schema=OFF')
    const version = Number(this.rows('PRAGMA user_version')[0]?.user_version)
    if (!Number.isInteger(version) || version < 21 || version > 27) {
      throw new Error(`Unsupported Android database version ${version}.`)
    }
    for (const name of ['Habits', 'Repetitions']) {
      const schema = this.rows("SELECT sql FROM sqlite_master WHERE type='table' AND name=? COLLATE NOCASE", [name])[0]
      if (!schema || typeof schema.sql !== 'string' || !/^CREATE TABLE\s/i.test(schema.sql)) {
        throw new Error('Choose an Android Loop SQLite database (.db).')
      }
    }
    this.read()
  }

  private rows(sql: string, values: SqlValue[] = []): AndroidFields[] {
    const rows: AndroidFields[] = []
    for (const record of this.db.all(sql, values)) {
      const row: AndroidFields = {}
      for (const [key, value] of Object.entries(record)) {
        if (value instanceof Uint8Array) throw new Error('Unexpected binary habit field.')
        row[key.toLowerCase()] = value
      }
      rows.push(row)
    }
    return rows
  }

  read(collapsedIds: string[] = []): State {
    const state = emptyState()
    state.revision = this.revision
    const records = this.rows('SELECT * FROM Repetitions ORDER BY timestamp')
    for (const row of this.rows('SELECT * FROM Habits ORDER BY position')) {
      const type = types[Number(row.type ?? 0)]
      if (!type) throw new Error('Unsupported Android habit type.')
      const entries: Record<string, number> = {}
      const notes: Record<string, string> = {}
      const skippedDays: string[] = []
      const unknownDays: string[] = []
      for (const entry of records.filter(entry => entry.habit === row.id)) {
        const timestamp = Number(entry.timestamp)
        const value = Number(entry.value)
        if (!Number.isSafeInteger(timestamp) || timestamp % millisecondsPerDay !== 0 || !Number.isSafeInteger(value)) {
          throw new Error('Invalid Android daily entry.')
        }
        if (type !== 'group') {
          const day = new Date(timestamp).toISOString().slice(0, 10)
          entries[day] = type === 'number' && value !== 3 ? Math.max(0, value / 1000) : Number((value === 2 || value === 1) && type === 'boolean')
          notes[day] = String(entry.notes ?? '')
          if (value === 3) skippedDays.push(day)
          if (value === -1) unknownDays.push(day)
        }
      }
      state.habits.push({
        id: String(row.uuid || `legacy-${row.id}`), name: String(row.name), type,
        parentId: row.parent_uuid ? String(row.parent_uuid) : null,
        target: type === 'number' ? Number(row.target_value) : 1,
        unit: String(row.unit ?? ''), color: palette[Number(row.color)] ?? palette[0], entries, notes, skippedDays, unknownDays,
        android: { habit: row, entries: records.filter(entry => entry.habit === row.id).map(entry => ({
          timestamp: Number(entry.timestamp), value: Number(entry.value), notes: String(entry.notes ?? '')
        })) }
      })
    }
    state.collapsedIds = collapsedIds.filter(id => state.habits.some(h => h.id === id && h.type === 'group'))
    return validateState(state)
  }

  write(input: State): State {
    const next = validateState(input)
    if (next.revision !== undefined && next.revision !== this.revision) throw new Error('Another tab changed this database. Reload before you edit again.')
    const previous = this.read()
    this.db.run('BEGIN')
    try {
      const columns = this.rows('PRAGMA table_info(Habits)').map(row => String(row.name))
      if (next.habits.some(h => h.type === 'group' || h.parentId !== null) && !columns.includes('parent_uuid')) {
        throw new Error('This database needs the group migration. Import a backup from the modified Android app.')
      }
      for (const old of previous.habits) {
        if (next.habits.some(h => h.id === old.id)) continue
        this.db.run('DELETE FROM Repetitions WHERE habit=?', [Number(old.android?.habit.id)])
        this.db.run('DELETE FROM Habits WHERE id=?', [Number(old.android?.habit.id)])
      }
      for (const [position, habit] of next.habits.entries()) {
        const old = previous.habits.find(h => h.id === habit.id)
        let id = Number(old?.android?.habit.id)
        if (old) {
          if (old.type !== habit.type) throw new Error('You cannot change an existing habit’s type.')
          const updates: Record<string, SqlValue> = { name: habit.name, unit: habit.unit, position }
          if (columns.includes('parent_uuid')) updates.parent_uuid = habit.parentId
          if (old.color !== habit.color) updates.color = nearestColor(habit.color)
          if (habit.type === 'number') updates.target_value = habit.target
          if (habit.settings) {
            const s = habit.settings
            const before = settingsOf(old)
            const fields: Record<string, [unknown, unknown, SqlValue]> = {
              question: [s.question, before.question, s.question], description: [s.description, before.description, s.description],
              category: [s.category, before.category, s.category], archived: [s.archived, before.archived, Number(s.archived)],
              freq_num: [s.frequencyNumerator, before.frequencyNumerator, s.frequencyNumerator],
              freq_den: [s.frequencyDenominator, before.frequencyDenominator, s.frequencyDenominator],
              target_type: [s.targetType, before.targetType, s.targetType]
            }
            for (const [key, [after, previous, value]] of Object.entries(fields)) {
              if (after !== previous) {
                if (!columns.includes(key)) throw new Error(`This database does not support ${key}. Import a current Android backup.`)
                updates[key] = value
              }
            }
            if (JSON.stringify(s.reminder) !== JSON.stringify(before.reminder)) {
              updates.reminder_hour = s.reminder?.hour ?? null
              updates.reminder_min = s.reminder?.minute ?? null
              updates.reminder_days = s.reminder?.days ?? 0
            }
          }
          this.db.run(`UPDATE Habits SET ${Object.keys(updates).map(key => `${key}=?`).join(',')} WHERE id=?`, [...Object.values(updates), id])
        } else {
          id = Number(this.rows('SELECT COALESCE(MAX(id),0)+1 AS id FROM Habits')[0].id)
          const row: Record<string, SqlValue> = {
            id, position, uuid: habit.id, name: habit.name, type: types.indexOf(habit.type),
            parent_uuid: habit.parentId, unit: habit.unit, archived: 0, color: nearestColor(habit.color),
            description: '', question: '', freq_num: 1, freq_den: 1, reminder_hour: null,
            reminder_min: null, reminder_days: 0, highlight: 0, target_type: 0,
            target_value: habit.type === 'number' ? habit.target : 0, category: ''
          }
          const keys = columns.filter(key => Object.hasOwn(row, key))
          const s = settingsOf(habit)
          Object.assign(row, { description: s.description, question: s.question, category: s.category,
            archived: Number(s.archived), freq_num: s.frequencyNumerator, freq_den: s.frequencyDenominator,
            target_type: s.targetType, reminder_hour: s.reminder?.hour ?? null,
            reminder_min: s.reminder?.minute ?? null, reminder_days: s.reminder?.days ?? 0 })
          if (s.category && !columns.includes('category')) throw new Error('This database does not support categories. Import a current Android backup.')
          this.db.run(`INSERT INTO Habits (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`, keys.map(key => row[key]))
        }
        if (habit.type === 'group') continue
        for (const day of Object.keys(old?.entries ?? {})) {
          if (!Object.hasOwn(habit.entries, day)) this.db.run('DELETE FROM Repetitions WHERE habit=? AND timestamp=?', [id, Date.parse(`${day}T00:00:00Z`)])
        }
        for (const [day, value] of Object.entries(habit.entries)) {
          const skipped = habit.skippedDays?.includes(day) ?? false
          const unknown = habit.unknownDays?.includes(day) ?? false
          const note = habit.notes?.[day] ?? old?.notes?.[day] ?? ''
          const sameValue = old && !habit.editedDays?.includes(day) && Object.hasOwn(old.entries, day) && old.entries[day] === value
            && skipped === (old.skippedDays?.includes(day) ?? false)
            && unknown === (old.unknownDays?.includes(day) ?? false)
          if (sameValue && note === (old.notes?.[day] ?? '')) continue
          if (sameValue) {
            this.db.run('UPDATE Repetitions SET notes=? WHERE habit=? AND timestamp=?', [note, id, Date.parse(`${day}T00:00:00Z`)])
            continue
          }
          const raw = unknown ? -1 : skipped ? 3 : habit.type === 'number' ? Math.round(value * 1000) : value ? 2 : 0
          if (habit.type === 'number' && !skipped && !unknown && Math.abs(value * 1000 - raw) > 0.000001) {
            throw new Error('Android supports at most three decimal places.')
          }
          if (!Number.isSafeInteger(raw) || raw > 2147483647) throw new Error('Value exceeds Android numeric range.')
          const timestamp = Date.parse(`${day}T00:00:00Z`)
          const existing = this.rows('SELECT value FROM Repetitions WHERE habit=? AND timestamp=?', [id, timestamp])
          if (existing.length) this.db.run('UPDATE Repetitions SET value=?,notes=? WHERE habit=? AND timestamp=?', [raw, note, id, timestamp])
          else this.db.run('INSERT INTO Repetitions (habit,timestamp,value,notes) VALUES (?,?,?,?)', [id, timestamp, raw, note])
        }
      }
      const result = this.read(next.collapsedIds)
      this.db.run('COMMIT')
      this.revision = crypto.randomUUID()
      return { ...result, revision: this.revision }
    } catch (error) {
      this.db.run('ROLLBACK')
      throw error
    }
  }

  export(): Uint8Array {
    const bytes = this.db.export()
    this.db.run('PRAGMA trusted_schema=OFF')
    return bytes
  }

  close(): void { this.db.close(); }
}

export function openDatabase(bytes: Uint8Array): LoopDatabase {
  if (new TextDecoder().decode(bytes.subarray(0, 16)) !== 'SQLite format 3\0') {
    throw new Error('Choose an Android Loop SQLite database (.db).')
  }
  const db = new ServerSQLite(bytes)
  try { return new LoopDatabase(db); }
  catch (error) { db.close(); throw error; }
}
