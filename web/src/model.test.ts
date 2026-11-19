import assert from 'node:assert/strict'
import test from 'node:test'
import { activity, completed, deleteHabit, emptyState, validateState, saveHabit,
  setEntry, setRecord, settingsOf, toggleGroup, visibleHabits, filterHabits, moveHabit } from './model.ts'
import type { Habit, HabitType, State } from './model.ts'

const day = '2026-11-18'
const habit = (id: string, type: HabitType = 'boolean', extra: Partial<Habit> = {}): Habit => ({
  id,
  name: id,
  type,
  parentId: null,
  target: 1,
  unit: '',
  color: '#6750a4',
  entries: {},
  ...extra
})
const fixture = () => ({ ...emptyState(), habits: [
  habit('group', 'group'),
  habit('zebra', 'boolean', { parentId: 'group' }),
  habit('Alpha', 'number', { parentId: 'group', target: 10, unit: 'km' }),
  habit('other')
] })

test('group completion derives from any child activity, not its target', () => {
  const state = fixture()
  assert.equal(completed(state, 'group', day), false)
  const next = setEntry(state, 'Alpha', day, 0.5)
  assert.equal(completed(next, 'Alpha', day), false)
  assert.equal(completed(next, 'group', day), true)
  assert.equal(activity(next, 'group', day), 1)
  assert.deepEqual(next.habits[0].entries, {})
  assert.equal(completed(setEntry(next, 'Alpha', day, 0), 'group', day), false)
  assert.equal(completed(setEntry(state, 'zebra', day, 1), 'group', day), true)
})

test('children stay alphabetical and collapse hides only their group', () => {
  const state = fixture()
  assert.deepEqual(visibleHabits(state).map(h => h.id), ['group', 'Alpha', 'zebra', 'other'])
  const next = toggleGroup(state, 'group')
  assert.deepEqual(visibleHabits(next).map(h => h.id), ['group', 'other'])
  assert.deepEqual(visibleHabits(toggleGroup(next, 'group')), visibleHabits(state))
})

test('deleting a group preserves children and their records', () => {
  const state = setEntry(fixture(), 'Alpha', day, 5)
  const next = deleteHabit(toggleGroup(state, 'group'), 'group')
  assert.equal(next.habits.find(h => h.id === 'Alpha')?.parentId, null)
  assert.equal(activity(next, 'Alpha', day), 5)
  assert.deepEqual(next.collapsedIds, [])
  assert.equal(state.habits.length, 4)
})

test('save creates and edits habits without losing entries', () => {
  const state = setEntry(fixture(), 'Alpha', day, 5)
  const next = saveHabit(state, { ...state.habits[2], name: 'Walk' })
  assert.equal(next.habits[2].name, 'Walk')
  assert.equal(activity(next, 'Alpha', day), 5)
  assert.equal(saveHabit(next, habit('new')).habits.length, 5)
})

test('validation preserves records, hierarchy, and collapse state', () => {
  const state = toggleGroup(setEntry(fixture(), 'Alpha', day, 2.5), 'group')
  assert.deepEqual(validateState(state), state)
})

test('rejects invalid state and unsafe hierarchy', () => {
  assert.throws(() => validateState(null))
  assert.throws(() => validateState({ habits: [] }))
  for (const habits of [
    [habit('a'), habit('a')],
    [{ ...habit('a'), type: 'unknown' }],
    [habit('a', 'boolean', { parentId: 'missing' })],
    [habit('a', 'group', { parentId: 'b' }), habit('b', 'group')],
    [habit('a', 'number', { target: 0 })],
    [habit('a', 'number', { entries: { '2026-02-30': 1 } })],
    [habit('a', 'boolean', { entries: { [day]: 2 } })],
    [habit('a', 'group', { entries: { [day]: 1 } })],
    [habit('a', 'number', { entries: { [day]: -1 } })],
    [habit('a', 'boolean', { color: 'url(https://example.com)' })]
  ]) assert.throws(() => validateState({ ...emptyState(), habits }))
})

test('rejects direct group entries, invalid dates, and invalid numbers', () => {
  const state = fixture()
  assert.throws(() => setEntry(state, 'group', day, 1))
  assert.throws(() => setEntry(state, 'Alpha', day, Infinity))
  assert.throws(() => setEntry(state, 'Alpha', '2026-02-30', 1))
  assert.throws(() => setEntry(state, 'zebra', day, 0.5))
  assert.throws(() => saveHabit(state, habit('group', 'boolean')))
})

test('moving or deleting a child recalculates both groups without stored group records', () => {
  let state = saveHabit(fixture(), habit('second', 'group'))
  state = setEntry(state, 'zebra', day, 1)
  state = saveHabit(state, { ...state.habits[1], parentId: 'second' })
  assert.equal(completed(state, 'group', day), false)
  assert.equal(completed(state, 'second', day), true)
  state = deleteHabit(state, 'zebra')
  assert.equal(completed(state, 'second', day), false)
})

test('one collapsed group leaves another group and its children visible', () => {
  let state = saveHabit(fixture(), habit('second', 'group'))
  state = saveHabit(state, habit('child', 'boolean', { parentId: 'second' }))
  state = toggleGroup(state, 'group')
  assert.deepEqual(visibleHabits(state).map(h => h.id), ['group', 'other', 'second', 'child'])
  assert.deepEqual(validateState(emptyState()), emptyState())
})

test('records distinguish skipped, unknown, and explicit no while preserving notes', () => {
  let state = setRecord(fixture(), 'zebra', day, 1, 'After lunch')
  assert.equal(state.habits[1].notes?.[day], 'After lunch')
  state = setRecord(state, 'zebra', day, 'skip', 'Rest day')
  assert.deepEqual(state.habits[1].skippedDays, [day])
  assert.equal(completed(state, 'group', day), false)
  state = setEntry(state, 'zebra', day, 0)
  assert.deepEqual(state.habits[1].skippedDays, [])
  assert.equal(state.habits[1].notes?.[day], 'Rest day')
  state = setRecord(state, 'zebra', day, null)
  assert.equal(Object.hasOwn(state.habits[1].entries, day), false)
  assert.equal(Object.hasOwn(state.habits[1].notes ?? {}, day), false)
})

test('settings validate frequency, reminders, archive, and at-most zero targets', () => {
  const h = habit('limit', 'number', { target: 0, settings: {
    ...settingsOf(habit('limit')), targetType: 1, frequencyNumerator: 1,
    frequencyDenominator: 7, archived: true, category: 'Health',
    reminder: { hour: 8, minute: 30, days: 127 }
  } })
  const state = saveHabit(emptyState(), h)
  assert.equal(settingsOf(state.habits[0]).category, 'Health')
  for (const settings of [
    { ...h.settings!, frequencyNumerator: 0 },
    { ...h.settings!, frequencyDenominator: 0 },
    { ...h.settings!, frequencyNumerator: 8 },
    { ...h.settings!, reminder: { hour: 24, minute: 0, days: 127 } }
  ]) assert.throws(() => saveHabit(state, { ...h, settings }))
})

test('filters support archive, completion, search, categories, and order', () => {
  let state = fixture()
  state = saveHabit(state, { ...state.habits[3], settings: { ...settingsOf(state.habits[3]), archived: true } })
  assert.equal(filterHabits(state, { day }).some(h => h.id === 'other'), false)
  assert.deepEqual(filterHabits(state, { day, search: 'alpha' }).map(h => h.id), ['Alpha'])
  assert.equal(filterHabits(state, { day, showArchived: true }).length, 4)
  state = moveHabit(state, 'other', -1)
  assert.deepEqual(visibleHabits(state).map(h => h.id), ['other', 'group', 'Alpha', 'zebra'])
})

test('completion helpers use core rules for skipped days and weekly targets', () => {
  let state = saveHabit(emptyState(), habit('walk'))
  state = setRecord(state, 'walk', day, 'skip')
  assert.equal(completed(state, 'walk', day), true)
  state = saveHabit(state, habit('distance', 'number', { target: 10,
    settings: { ...settingsOf(), frequencyDenominator: 7 } }))
  state = setRecord(state, 'distance', '2026-11-16', 6)
  state = setRecord(state, 'distance', day, 4)
  assert.equal(completed(state, 'distance', day), true)
  assert.equal(filterHabits(state, { day, hideCompleted: true }).length, 0)
})

test('completion helpers use the core at-most zero rule without an original entry', () => {
  const state = saveHabit(emptyState(), habit('limit', 'number', { target: 0,
    settings: { ...settingsOf(), targetType: 1 } }))
  assert.equal(completed(state, 'limit', day), true)
  assert.equal(completed(state, 'missing', day), false)
})

test('shared commands preserve web metadata and input state', () => {
  const state: State = setRecord(fixture(), 'zebra', day, 1, 'Original note')
  state.revision = 'revision'
  state.habits[1].android = { habit: { id: 17, custom: 'retained' }, entries: [] }
  const snapshot = structuredClone(state)
  const edited = saveHabit(state, { ...state.habits[1], name: ' New name ' })
  assert.equal(edited.habits[1].name, 'New name')
  assert.deepEqual(edited.habits[1].android, state.habits[1].android)
  const next = setRecord(edited, 'zebra', day, 'skip')
  assert.equal(next.habits[1].notes?.[day], 'Original note')
  assert.equal(next.revision, 'revision')
  assert.deepEqual(state, snapshot)
})

test('habit search includes descriptions through the core matcher', () => {
  const state = saveHabit(emptyState(), habit('walk', 'boolean', { settings: {
    ...settingsOf(), description: 'Outside after lunch'
  } }))
  assert.deepEqual(filterHabits(state, { day, search: 'outside' }).map(h => h.id), ['walk'])
})

test('activity follows core group rules for archived children and skipped records', () => {
  let state = fixture()
  state = saveHabit(state, { ...state.habits[1], settings: { ...settingsOf(), archived: true } })
  state = setRecord(state, 'zebra', day, 1)
  assert.equal(activity(state, 'group', day), 1)
  state = setRecord(state, 'zebra', day, 'skip')
  assert.equal(activity(state, 'group', day), 0)
  assert.equal(activity(state, 'zebra', day), 0)
})
