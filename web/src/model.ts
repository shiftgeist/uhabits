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
export interface HabitSettings {
  question: string
  description: string
  category: string
  archived: boolean
  frequencyNumerator: number
  frequencyDenominator: number
  targetType: 0 | 1
  reminder: { hour: number; minute: number; days: number } | null
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
  notes?: Record<string, string>
  skippedDays?: string[]
  unknownDays?: string[]
  editedDays?: string[]
  settings?: HabitSettings
  android?: { habit: AndroidFields; entries: AndroidEntry[] }
}
export type HabitDraft = Omit<Habit, 'entries'> & { entries?: Habit['entries'] }
export interface State {
  habits: Habit[]
  collapsedIds: string[]
  revision?: string
}

export const emptyState = (): State => ({ habits: [], collapsedIds: [] })

export function settingsOf(habit: Pick<Habit, 'settings' | 'android'> = {}): HabitSettings {
  const row = habit.android?.habit
  return habit.settings ?? {
    question: String(row?.question ?? ''), description: String(row?.description ?? ''),
    category: String(row?.category ?? ''), archived: row?.archived === 1,
    frequencyNumerator: Number(row?.freq_num ?? 1), frequencyDenominator: Number(row?.freq_den ?? 1),
    targetType: row?.target_type === 1 ? 1 : 0,
    reminder: row?.reminder_hour != null && row?.reminder_min != null ? {
      hour: Number(row.reminder_hour), minute: Number(row.reminder_min), days: Number(row.reminder_days ?? 127)
    } : null
  }
}

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
  requireValue(state.revision === undefined || (typeof state.revision === 'string' && state.revision.length <= 64), 'Invalid database revision.')
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
    const targetType = isObject(h.settings) ? h.settings.targetType
      : isObject(h.android) && isObject(h.android.habit) ? h.android.habit.target_type : undefined
    requireValue(typeof h.target === 'number' && Number.isFinite(h.target)
      && (h.target > 0 || (h.target === 0 && targetType === 1)),
    'Target must be positive, or zero for an Android at-most habit.')
    requireValue(typeof h.color === 'string' && /^#[0-9a-f]{6}$/i.test(h.color),
      'Invalid habit color.')
    requireValue(isObject(h.entries), 'Invalid daily entries.')
    if (h.settings !== undefined) {
      const s = h.settings
      requireValue(isObject(s), 'Invalid habit settings.')
      requireValue(['question', 'description', 'category'].every(key => typeof s[key] === 'string'), 'Invalid habit text.')
      requireValue(typeof s.archived === 'boolean' && (s.targetType === 0 || s.targetType === 1), 'Invalid habit options.')
      requireValue(Number.isSafeInteger(s.frequencyNumerator) && Number.isSafeInteger(s.frequencyDenominator)
        && Number(s.frequencyNumerator) > 0 && Number(s.frequencyDenominator) >= Number(s.frequencyNumerator)
        && Number(s.frequencyDenominator) <= 365, 'Use a frequency between 1 and 365 days.')
      const r = s.reminder
      requireValue(r === null || (isObject(r) && Number.isInteger(r.hour) && Number(r.hour) >= 0 && Number(r.hour) < 24
        && Number.isInteger(r.minute) && Number(r.minute) >= 0 && Number(r.minute) < 60
        && Number.isInteger(r.days) && Number(r.days) > 0 && Number(r.days) <= 127), 'Invalid reminder.')
    }
    requireValue(h.notes === undefined || (isObject(h.notes) && Object.entries(h.notes).every(([day, note]) =>
      validDate(day) && typeof note === 'string' && Object.hasOwn(h.entries as object, day))), 'Invalid date notes.')
    requireValue(h.skippedDays === undefined || (Array.isArray(h.skippedDays)
      && new Set(h.skippedDays).size === h.skippedDays.length
      && h.skippedDays.every(day => validDate(day) && (h.entries as Record<string, number>)[day] === 0)), 'Invalid skipped days.')
    requireValue(h.unknownDays === undefined || (Array.isArray(h.unknownDays)
      && new Set(h.unknownDays).size === h.unknownDays.length
      && h.unknownDays.every(day => validDate(day) && (h.entries as Record<string, number>)[day] === 0
        && !(h.skippedDays as string[] | undefined)?.includes(day))), 'Invalid unknown days.')
    requireValue(h.editedDays === undefined || (Array.isArray(h.editedDays)
      && new Set(h.editedDays).size === h.editedDays.length && h.editedDays.every(validDate)), 'Invalid edited days.')
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
      ? { ...h, entries: { ...h.entries, [day]: value }, skippedDays: (h.skippedDays ?? []).filter(d => d !== day),
        unknownDays: (h.unknownDays ?? []).filter(d => d !== day), editedDays: [...new Set([...(h.editedDays ?? []), day])] }
      : h
  ) })
}

export function setRecord(state: State, id: string, day: string, value: number | 'skip' | null, note?: string): State {
  requireValue(validDate(day), 'Invalid entry date.')
  const habit = state.habits.find(h => h.id === id)
  requireValue(habit && habit.type !== 'group', 'Enter data on a child habit, not its group.')
  const entries = { ...habit.entries }
  const notes = { ...habit.notes }
  const skippedDays = (habit.skippedDays ?? []).filter(d => d !== day)
  const unknownDays = (habit.unknownDays ?? []).filter(d => d !== day)
  if (value === null) {
    delete entries[day]; delete notes[day]
    if (note) { entries[day] = 0; notes[day] = note; unknownDays.push(day); }
  }
  else {
    entries[day] = value === 'skip' ? 0 : value
    if (value === 'skip') skippedDays.push(day)
    if (note !== undefined) notes[day] = note
  }
  return validateState({ ...state, habits: state.habits.map(h => h.id === id ? {
    ...h, entries, notes, skippedDays, unknownDays, editedDays: [...new Set([...(h.editedDays ?? []), day])]
  } : h) })
}

export function moveHabit(state: State, id: string, direction: -1 | 1): State {
  const habits = [...state.habits]
  const index = habits.findIndex(h => h.id === id)
  if (index < 0) return state
  const siblings = habits.map((h, position) => ({ h, position })).filter(({ h }) => h.parentId === habits[index].parentId)
  const position = siblings.findIndex(item => item.position === index)
  const next = siblings[position + direction]?.position
  if (next !== undefined) [habits[index], habits[next]] = [habits[next], habits[index]]
  return { ...state, habits }
}

export interface HabitFilter {
  day: string
  search?: string
  category?: string
  showArchived?: boolean
  hideCompleted?: boolean
  sort?: 'manual' | 'name' | 'color' | 'completion'
}

export function filterHabits(state: State, filter: HabitFilter, isComplete = (id: string, day: string) => completed(state, id, day)): Habit[] {
  const habits = visibleHabits(state).filter(h => {
    const s = settingsOf(h)
    return (filter.showArchived || !s.archived)
      && (!filter.hideCompleted || !isComplete(h.id, filter.day))
      && (!filter.category || s.category === filter.category)
      && (!filter.search || `${h.name} ${s.question} ${s.category}`.toLocaleLowerCase().includes(filter.search.toLocaleLowerCase()))
  })
  if (filter.sort === 'name') habits.sort((a, b) => a.name.localeCompare(b.name))
  if (filter.sort === 'color') habits.sort((a, b) => a.color.localeCompare(b.color))
  if (filter.sort === 'completion') habits.sort((a, b) => Number(isComplete(b.id, filter.day)) - Number(isComplete(a.id, filter.day)))
  return habits
}

export function activity(state: State, id: string, day: string): number {
  const habit = state.habits.find(h => h.id === id)
  if (!habit) return 0
  if (habit.type === 'group') {
    return state.habits.some(h => h.parentId === id && !settingsOf(h).archived && activity(state, h.id, day) > 0) ? 1 : 0
  }
  return habit.entries[day] ?? 0
}

export function completed(state: State, id: string, day: string): boolean {
  const habit = state.habits.find(h => h.id === id)
  if (habit?.skippedDays?.includes(day) || habit?.unknownDays?.includes(day)) return false
  if (habit?.type === 'number' && settingsOf(habit).targetType === 1) {
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
