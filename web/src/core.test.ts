import assert from 'node:assert/strict'
import test from 'node:test'
import { core } from './core.ts'
import { emptyState, settingsOf } from './model.ts'
import type { State } from './model.ts'

const fixture = (): State => ({ ...emptyState(), revision: 'original', habits: [
  { id: 'walk', name: 'Walk', type: 'number', parentId: null, target: 10, unit: 'km',
    color: '#6750a4', entries: {}, settings: settingsOf() }
] })

test('bridge owns record commands without a TypeScript-prepared next state', () => {
  const state = fixture()
  const call = (state: State, value: number | string | null, note?: string): State =>
    JSON.parse(core.mutateWebHabits(JSON.stringify({ operation: 'record', state,
      id: 'walk', day: '2026-11-18', value, note })))
  const recorded = call(state, 1.2346, 'Outside')
  assert.equal(recorded.habits[0].entries['2026-11-18'], 1.2346)
  assert.equal(recorded.habits[0].notes?.['2026-11-18'], 'Outside')
  const skipped = call(recorded, 'skip')
  assert.deepEqual(skipped.habits[0].skippedDays, ['2026-11-18'])
  assert.equal(skipped.habits[0].notes?.['2026-11-18'], 'Outside')
  const unknown = call(skipped, null, 'No measurement')
  assert.deepEqual(unknown.habits[0].unknownDays, ['2026-11-18'])
  assert.deepEqual(unknown.habits[0].skippedDays, [])
  const cleared = call(unknown, null)
  assert.deepEqual(cleared.habits[0].entries, {})
  assert.deepEqual(cleared.habits[0].notes, {})
  assert.deepEqual(cleared.habits[0].editedDays, ['2026-11-18'])
  assert.equal(cleared.revision, 'original')
  assert.deepEqual(state, fixture())
})

test('bridge rejects invalid record values before Kotlin integer conversion', () => {
  for (const value of [-1, 'invalid', 3_000_000]) {
    assert.throws(() => core.mutateWebHabits(JSON.stringify({ operation: 'record', state: fixture(),
      id: 'walk', day: '2026-11-18', value })))
  }
})

test('bridge preserves JavaScript half-up conversion for numeric entries', () => {
  const state = fixture()
  state.habits[0].entries['2026-11-18'] = 1.2345
  assert.equal(JSON.parse(core.queryWebHabits(JSON.stringify({ operation: 'activity', state,
    id: 'walk', today: '2026-11-18' }))), 1.235)
})

test('bridge provides the original core palette for database adapters', () => {
  assert.equal(core.webPaletteColor(0), '#d32f2f')
  assert.equal(core.webPaletteColor(17), '#424242')
  assert.equal(core.webPaletteColor(999), '#d32f2f')
  assert.equal(core.webPaletteColor(1.5), '#d32f2f')
  assert.equal(core.webNearestColorIndex('#1976d2'), 11)
})

test('bridge rejects timestamps outside the JavaScript Date range', () => {
  assert.throws(() => core.calculateWebHabitDate(Number.MAX_VALUE, true))
})
