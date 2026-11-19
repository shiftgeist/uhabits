import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { LoopDatabase, openDatabase, ServerSQLite } from './android-backup.ts'
import { completed, deleteHabit, saveHabit, setEntry } from './model.ts'
import type { AndroidFields } from './model.ts'

async function fixture(version = 27) {
  const native = new Database(':memory:')
  for (let n = 9; n <= version; n++) {
    native.exec(await readFile(new URL(`../uhabits-core/assets/main/migrations/${String(n).padStart(2, '0')}.sql`, import.meta.url), 'utf8'))
  }
  native.exec(`PRAGMA user_version=${version}`)
  const adapter = new ServerSQLite(native)
  return { native, adapter }
}

const draft = (id: string, type: 'boolean' | 'number' | 'group' = 'boolean') => ({
  id, name: id, type, parentId: null, target: 10, unit: '', color: '#d32f2f'
})
const day = '2026-11-18'

test('edits SQLite rows directly and preserves unrelated metadata, IDs, notes and tables', async () => {
  const { native, adapter } = await fixture()
  try {
    const database = new LoopDatabase(adapter)
    database.write(saveHabit(database.read(), draft('walk', 'number')))
    native.exec("UPDATE Habits SET id=42, description='keep', freq_num=3, reminder_hour=8; CREATE TABLE Extra (value TEXT); INSERT INTO Extra VALUES ('keep')")
    native.prepare('INSERT INTO Repetitions (habit,timestamp,value,notes) VALUES (?,?,?,?)').run(42, Date.parse(day), 3000, 'note')
    const state = database.read()
    database.write(saveHabit(setEntry(state, 'walk', day, 2.5), { ...state.habits[0], name: 'Walk edited' }))
    const row = native.prepare<[], AndroidFields>('SELECT * FROM Habits').get()
    assert.equal(row?.id, 42)
    assert.equal(row?.description, 'keep')
    assert.equal(row?.freq_num, 3)
    assert.equal(row?.reminder_hour, 8)
    assert.equal(native.prepare<[], AndroidFields>('SELECT value FROM Extra').get()?.value, 'keep')
    assert.equal(native.prepare<[], AndroidFields>('SELECT value FROM Repetitions').get()?.value, 2500)
    assert.equal(native.prepare<[], AndroidFields>('SELECT notes FROM Repetitions').get()?.notes, 'note')
  } finally { adapter.close(); }
})

test('group activity uses child values without group records; deletion keeps children', async () => {
  const { native, adapter } = await fixture()
  try {
    const database = new LoopDatabase(adapter)
    let state = saveHabit(database.read(), draft('group', 'group'))
    state = saveHabit(state, { ...draft('child', 'number'), parentId: 'group' })
    database.write(setEntry(state, 'child', day, 0.5))
    assert.equal(completed(database.read(), 'group', day), true)
    assert.equal(native.prepare<[], AndroidFields>('SELECT count(*) AS n FROM Repetitions').get()?.n, 1)
    database.write(deleteHabit(database.read(), 'group'))
    assert.equal(database.read().habits[0].parentId, null)
    assert.equal(database.read().habits[0].entries[day], 0.5)
  } finally { adapter.close(); }
})

test('rejects unsupported schemas and rolls back invalid entry precision', async () => {
  const { native, adapter } = await fixture()
  try {
    const database = new LoopDatabase(adapter)
    database.write(saveHabit(database.read(), draft('walk', 'number')))
    const state = database.read()
    const invalid = saveHabit(setEntry(state, 'walk', day, 0.0001), { ...state.habits[0], name: 'Must roll back' })
    assert.throws(() => database.write(invalid), /decimal/)
    assert.equal(database.read().habits[0].name, 'walk')
    native.exec('PRAGMA user_version=999')
    assert.throws(() => new LoopDatabase(adapter), /version/)
  } finally { adapter.close(); }
})

test('preserves skipped and automatic entries when another field changes', async () => {
  const { native, adapter } = await fixture(25)
  try {
    const database = new LoopDatabase(adapter)
    database.write(saveHabit(database.read(), draft('check')))
    native.prepare('INSERT INTO Repetitions (habit,timestamp,value,notes) VALUES (1,?,?,?)').run(Date.parse(day), 3, 'skip')
    const state = database.read()
    database.write(saveHabit(state, { ...state.habits[0], name: 'Renamed' }))
    assert.equal(native.prepare<[], AndroidFields>('SELECT value FROM Repetitions').get()?.value, 3)
    assert.equal(native.prepare<[], AndroidFields>('PRAGMA user_version').get()?.user_version, 25)
  } finally { adapter.close(); }
})

test('opens and exports SQLite bytes directly, then reopens the exported database', async () => {
  const native = new ServerSQLite()
  try {
    for (let n = 9; n <= 27; n++) {
      native.executeScript(await readFile(new URL(`../uhabits-core/assets/main/migrations/${String(n).padStart(2, '0')}.sql`, import.meta.url), 'utf8'))
    }
    native.run('PRAGMA user_version=27')
    assert.throws(() => openDatabase(new TextEncoder().encode('not a database')), /SQLite/)
    const database = openDatabase(native.export())
    try {
      database.write(setEntry(saveHabit(database.read(), draft('walk', 'number')), 'walk', day, 2.5))
      const exported = database.export()
      assert.equal(new TextDecoder().decode(exported.subarray(0, 16)), 'SQLite format 3\0')
      const reopened = openDatabase(exported)
      try { assert.equal(reopened.read().habits[0].entries[day], 2.5); }
      finally { reopened.close(); }
    } finally { database.close(); }
  } finally {
    native.close()
  }
})
