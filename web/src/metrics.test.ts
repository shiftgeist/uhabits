import assert from 'node:assert/strict'
import test from 'node:test'
import { calculateMetrics } from './metrics.ts'
import { emptyState, saveHabit, setRecord, settingsOf } from './model.ts'

const day = '2026-11-19'
const draft = (id: string, type: 'boolean' | 'number' | 'group' = 'boolean') => ({
  id, name: id, type, parentId: null, target: 10, unit: '', color: '#d32f2f'
})

test('shared Android core supplies Boolean strength, streaks, totals, and skipped completion', () => {
  let state = saveHabit(emptyState(), draft('walk'))
  state = setRecord(state, 'walk', '2026-11-17', 1)
  state = setRecord(state, 'walk', '2026-11-18', 'skip')
  state = setRecord(state, 'walk', day, 1)
  const metrics = calculateMetrics(state, day).walk!
  assert.equal(metrics.entries[day]?.completed, true)
  assert.equal(metrics.entries['2026-11-18']?.completed, true)
  assert.equal(metrics.overview.total, 2)
  assert.ok(metrics.overview.strength > 0)
  assert.equal(metrics.streaks[0]?.length, 3)
  assert.ok(metrics.scores.length > 0)
  assert.ok(metrics.frequency.length > 0)
})

test('shared Android core evaluates weekly numeric targets across their full period', () => {
  let state = saveHabit(emptyState(), { ...draft('distance', 'number'), settings: {
    ...settingsOf(), frequencyDenominator: 7
  } })
  state = setRecord(state, 'distance', '2026-11-16', 6)
  state = setRecord(state, 'distance', day, 4)
  const metrics = calculateMetrics(state, day, 2).distance!
  assert.equal(metrics.entries['2026-11-16']?.completed, true)
  assert.equal(metrics.entries[day]?.completed, true)
  assert.equal(metrics.targets?.values[0], 10)
  assert.equal(metrics.targets?.targets[0], 10)
})

test('shared Android core treats an empty at-most zero habit as complete today', () => {
  const state = saveHabit(emptyState(), { ...draft('limit', 'number'), target: 0,
    settings: { ...settingsOf(), targetType: 1 } })
  assert.equal(calculateMetrics(state, day).limit?.entries[day]?.completed, true)
})

test('shared Android core derives groups from activity rather than numeric target completion', () => {
  let state = saveHabit(emptyState(), draft('sport', 'group'))
  state = saveHabit(state, { ...draft('run', 'number'), parentId: 'sport' })
  state = setRecord(state, 'run', day, 0.5)
  const metrics = calculateMetrics(state, day)
  assert.equal(metrics.run?.entries[day]?.completed, false)
  assert.equal(metrics.sport?.entries[day]?.completed, true)
})
