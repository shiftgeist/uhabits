export type HabitType = 'boolean' | 'number' | 'group'
export type AndroidFields = Record<string, string | number | null | undefined> & {
  target_type?: number
  category?: string
  color?: number
}
export interface AndroidEntry {
  timestamp: number
  value: number
  notes: string
}
export interface Habit {
  id: string
  name: string
  type: HabitType
  parentId: string | null
  target: number
  unit: string
  color: string
  entries: Record<string, number>
  android?: { habit: AndroidFields; entries: AndroidEntry[] }
}
export type HabitDraft = Omit<Habit, 'entries'> & { entries?: Habit['entries'] }
export interface State {
  habits: Habit[]
  collapsedIds: string[]
}

export const emptyState = (): State => ({ habits: [], collapsedIds: [] })

function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}
const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const validDate = (day: unknown): day is string =>
  typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day)
  && Number.isFinite(Date.parse(day)) && new Date(day).toISOString().slice(0, 10) === day

function assertState(state: unknown): asserts state is State {
  requireValue(isObject(state), 'Invalid habit state.')
  requireValue(Array.isArray(state.habits) && Array.isArray(state.collapsedIds),
    'Invalid backup contents.')
  const ids = new Set<string>()
  for (const h of state.habits as unknown[]) {
    requireValue(isObject(h) && typeof h.id === 'string' && h.id.length > 0 && !ids.has(h.id),
      'Invalid or duplicate habit ID.')
    ids.add(h.id)
    requireValue(typeof h.name === 'string' && h.name.trim().length > 0 && h.name.length <= 120,
      'Use a habit name of 1–120 characters.')
    requireValue(typeof h.type === 'string' && ['boolean', 'number', 'group'].includes(h.type), 'Invalid habit type.')
    requireValue(h.parentId === null || typeof h.parentId === 'string', 'Invalid parent group.')
    requireValue(typeof h.unit === 'string' && h.unit.length <= 40,
      'Use a unit of at most 40 characters.')
    const targetType = isObject(h.android) && isObject(h.android.habit) ? h.android.habit.target_type : undefined
    requireValue(typeof h.target === 'number' && Number.isFinite(h.target)
      && (h.target > 0 || (h.target === 0 && targetType === 1)),
    'Target must be positive, or zero for an Android at-most habit.')
    requireValue(typeof h.color === 'string' && /^#[0-9a-f]{6}$/i.test(h.color),
      'Invalid habit color.')
    requireValue(isObject(h.entries), 'Invalid daily entries.')
    if (h.android !== undefined) {
      requireValue(isObject(h.android) && isObject(h.android.habit)
        && Array.isArray(h.android.entries), 'Invalid Android metadata.')
      requireValue(Object.values(h.android.habit).every(value => value === null
        || typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))),
      'Invalid Android habit fields.')
      requireValue(h.android.entries.every((entry: unknown) => isObject(entry)
        && Number.isSafeInteger(entry.timestamp) && Number.isSafeInteger(entry.value)
        && typeof entry.notes === 'string'), 'Invalid Android entry metadata.')
    }
    for (const [day, value] of Object.entries(h.entries)) {
      requireValue(validDate(day), 'Invalid entry date.')
      requireValue(h.type !== 'group' && typeof value === 'number' && Number.isFinite(value) && value >= 0
        && (h.type !== 'boolean' || value === 0 || value === 1), 'Invalid entry value.')
    }
  }
  const habits = state.habits as Habit[]
  for (const h of habits) {
    if (h.parentId !== null) {
      requireValue(
        h.type !== 'group' && habits.some(p => p.id === h.parentId && p.type === 'group'),
        'Child habits must belong to a group. Groups cannot contain other groups.'
      )
    }
  }
  requireValue(new Set(state.collapsedIds).size === state.collapsedIds.length
    && state.collapsedIds.every(id => habits.some(h => h.id === id && h.type === 'group')),
    'Invalid collapsed groups.')
}

export function validateState(state: unknown): State {
  assertState(state)
  return state
}

export function saveHabit(state: State, habit: HabitDraft): State {
  const existing = state.habits.find(h => h.id === habit.id)
  requireValue(!existing || existing.type === habit.type,
    'You cannot change an existing habit’s type.')
  const next = { ...existing, ...habit, name: habit.name.trim(), entries: existing?.entries ?? {} }
  return validateState({ ...state, habits: existing
    ? state.habits.map(h => h.id === next.id ? next : h)
    : [...state.habits, next] })
}

export function deleteHabit(state: State, id: string): State {
  return validateState({
    ...state,
    habits: state.habits.filter(h => h.id !== id).map(h =>
      h.parentId === id ? { ...h, parentId: null } : h
    ),
    collapsedIds: state.collapsedIds.filter(value => value !== id)
  })
}

export function setEntry(state: State, id: string, day: string, value: number): State {
  const habit = state.habits.find(h => h.id === id)
  requireValue(habit && habit.type !== 'group', 'Enter data on a child habit, not its group.')
  return validateState({ ...state, habits: state.habits.map(h =>
    h.id === id
      ? { ...h, entries: { ...h.entries, [day]: value } }
      : h
  ) })
}

export function activity(state: State, id: string, day: string): number {
  const habit = state.habits.find(h => h.id === id)
  if (!habit) return 0
  if (habit.type === 'group') {
    return state.habits.some(h => h.parentId === id && activity(state, h.id, day) > 0) ? 1 : 0
  }
  return habit.entries[day] ?? 0
}

export function completed(state: State, id: string, day: string): boolean {
  const habit = state.habits.find(h => h.id === id)
  if (habit?.type === 'number' && habit.android?.habit.target_type === 1) {
    return Object.hasOwn(habit.entries, day) && activity(state, id, day) <= habit.target
  }
  return Boolean(habit && activity(state, id, day) >= (habit.type === 'number' ? habit.target : 1))
}

export function toggleGroup(state: State, id: string): State {
  const collapsedIds = state.collapsedIds.includes(id)
    ? state.collapsedIds.filter(value => value !== id)
    : [...state.collapsedIds, id]
  return validateState({ ...state, collapsedIds })
}

export function children(state: State, id: string): Habit[] {
  return state.habits.filter(h => h.parentId === id)
    .sort((a, b) =>
      a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || a.id.localeCompare(b.id)
    )
}

export function visibleHabits(state: State): Habit[] {
  return state.habits.filter(h => h.parentId === null).flatMap(
    h => [h,
      ...(h.type === 'group' && !state.collapsedIds.includes(h.id) ? children(state, h.id) : [])]
  )
}
