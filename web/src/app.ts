import { activity, children, deleteHabit, emptyState,
  saveHabit, setEntry, setRecord, settingsOf, filterHabits, moveHabit, toggleGroup } from './model.ts'
import type { Habit, HabitType, State } from './model.ts'
import { createDatabaseClient } from './client.ts'
import { exportCSV } from './csv.ts'
import { calculateMetrics } from './metrics.ts'
import type { HabitMetrics } from './metrics.ts'
import { drawChart } from './charts.ts'

function $<T extends HTMLElement = HTMLElement>(selector: string): T {
  const node = document.querySelector(selector)
  if (!(node instanceof HTMLElement)) throw new Error(`Missing element: ${selector}`)
  return node as T
}
const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error)
let state = emptyState()
let ready = false
let busy = false
const database = createDatabaseClient(window.location.origin, {
  getItem: key => sessionStorage.getItem(key) || localStorage.getItem(key),
  setItem: (key, value) => { sessionStorage.setItem(key, value); localStorage.setItem(key, value); }
})
const { client } = database
let offset = 0
let editingId: string | null = null
let entryContext: { day: string; habits: Habit[]; inputs: Map<string, HTMLInputElement | HTMLSelectElement>; notes: Map<string, HTMLTextAreaElement>; statuses: Map<string, HTMLSelectElement> } | null = null
let detailId: string | null = null
const selected = new Set<string>()
let metrics: Record<string, HabitMetrics> = {}
let metricsState: State | null = null
let metricsOptions = ''

function refreshMetrics() {
  const today = dateKey(new Date())
  const firstWeekday = Number($<HTMLSelectElement>('#first-weekday').value)
  const scoreBucket = Number($<HTMLSelectElement>('#score-period').value)
  const totalBucket = Number($<HTMLSelectElement>('#total-period').value)
  const options = `${today}:${firstWeekday}:${scoreBucket}:${totalBucket}`
  if (metricsState === state && metricsOptions === options) return
  metrics = calculateMetrics(state, today, firstWeekday, scoreBucket, totalBucket)
  metricsState = state
  metricsOptions = options
}

function isComplete(id: string, day: string) {
  return metrics[id]?.entries[day]?.completed ?? false
}

function report(message: string, error = false) {
  $('#status').textContent = message
  $('#status').classList.toggle('error', error)
}

async function checked<T extends Response>(pending: Promise<T>): Promise<T> {
  const response = await pending
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(body?.error ?? `Database request failed (${response.status}).`)
  }
  return response
}

async function commit(next: State) {
  if (!ready) throw new Error('The database is not ready.')
  const response = await checked(client.api.state.$put({ json: next }))
  if (response.status !== 200) throw new Error('Could not update the database.')
  state = await response.json()
  report('Changes saved on the local server. Export DB for a portable backup.')
  render()
}

async function attempt(action: () => void | Promise<void>) {
  if (busy) return
  busy = true
  try {
    await action()
  } catch (error) {
    report(errorMessage(error), true)
  } finally { busy = false; }
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${
    String(date.getDate()).padStart(2, '0')
  }`
}

function dates() {
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date()
    date.setHours(12, 0, 0, 0)
    date.setDate(date.getDate() + offset - 6 + index)
    return date
  })
  return $<HTMLInputElement>('#reverse-dates').checked ? days.reverse() : days
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (text !== undefined) node.textContent = text
  if (className) node.className = className
  return node
}

function button(text: string, label: string, action: () => void | Promise<void>, className?: string) {
  const node = element('button', text, className)
  node.type = 'button'
  node.setAttribute('aria-label', label)
  node.addEventListener('click', () => attempt(action))
  return node
}

function render() {
  refreshMetrics()
  const days = dates()
  const today = dateKey(new Date())
  const top = state.habits.filter(h => h.parentId === null && !settingsOf(h).archived)
  $('#summary').textContent = `${
    top.filter(h => isComplete(h.id, today)).length
  } of ${top.length} complete today`
  const header = element('tr')
  const selectionHead = element('th')
  const selectAll = element('input')
  selectAll.type = 'checkbox'
  selectAll.setAttribute('aria-label', 'Select all visible habits')
  const habits = filterHabits(state, { day: today, search: $<HTMLInputElement>('#search').value,
    category: $<HTMLSelectElement>('#category').value, showArchived: $<HTMLInputElement>('#show-archived').checked,
    hideCompleted: $<HTMLInputElement>('#hide-completed').checked,
    sort: $<HTMLSelectElement>('#sort').value as 'manual' | 'name' | 'color' | 'completion' }, isComplete)
  selectAll.checked = habits.length > 0 && habits.every(h => selected.has(h.id))
  selectAll.addEventListener('change', () => { for (const h of habits) selectAll.checked ? selected.add(h.id) : selected.delete(h.id); render(); })
  selectionHead.append(selectAll)
  header.append(selectionHead)
  header.append(element('th', 'HABIT', 'name-column'))
  for (const date of days) {
    const cell = element('th', undefined, dateKey(date) === today ? 'today' : '')
    cell.append(element('span', date.toLocaleDateString(undefined, { weekday: 'short' })),
      element('strong', date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })))
    header.append(cell)
  }
  header.append(element('th', 'Edit', 'edit-column'))
  $('#head').replaceChildren(header)
  $('#habits').replaceChildren()
  for (const habit of habits) {
    const settings = settingsOf(habit)
    const row = element('tr', undefined,
      habit.parentId ? 'child' : habit.type === 'group' ? 'group' : '')
    row.style.setProperty('--habit-color', habit.color)
    const selection = element('td')
    const checkbox = element('input')
    checkbox.type = 'checkbox'
    checkbox.checked = selected.has(habit.id)
    checkbox.setAttribute('aria-label', `Select ${habit.name}`)
    checkbox.addEventListener('change', () => { checkbox.checked ? selected.add(habit.id) : selected.delete(habit.id); render(); })
    selection.append(checkbox)
    row.append(selection)
    const nameCell = element('th', undefined, 'habit-name')
    nameCell.scope = 'row'
    const name = button(
      habit.type === 'group'
        ? `${state.collapsedIds.includes(habit.id) ? '▸' : '▾'} ${habit.name}`
        : habit.name,
      habit.type === 'group' ? `Open ${habit.name}` : `View ${habit.name}`,
      () => habit.type === 'group' ? openEntries(habit, today) : openDetails(habit),
      'name-button'
    )
    if (habit.type === 'group') {
      name.setAttribute('aria-expanded', String(!state.collapsedIds.includes(habit.id)))
      nameCell.append(button(state.collapsedIds.includes(habit.id) ? '▸' : '▾', `Show or hide ${habit.name} children`, () => commit(toggleGroup(state, habit.id))))
    }
    nameCell.append(name, element('small', habit.type === 'group'
      ? `${children(state, habit.id).filter(h => !settingsOf(h).archived).length} active child habits · any activity`
      : habit.type === 'number'
      ? `Target: ${settings.targetType === 1 ? 'at most ' : ''}${habit.target} ${habit.unit} / ${settings.frequencyDenominator} day(s)`
      : 'Yes or no'))
    if (settings.category) nameCell.append(element('small', settings.category))
    if (settings.archived) nameCell.append(element('small', 'Archived'))
    row.append(nameCell)
    for (const date of days) {
      const day = dateKey(date)
      const value = activity(state, habit.id, day)
      const done = isComplete(habit.id, day)
      const cell = element('td', undefined, day === today ? 'today' : '')
      const skipped = habit.skippedDays?.includes(day)
      const unknown = habit.type !== 'group' && (metrics[habit.id]?.entries[day]?.value ?? -1) === -1
      const text = skipped ? '−' : unknown && $<HTMLInputElement>('#show-unknown').checked ? '?' : habit.type === 'number' ? String(value) : done ? '✓' : '·'
      const control = button(text,
        `${habit.name}, ${day}: ${
          habit.type === 'number' ? `${value} ${habit.unit}` : done ? 'complete' : 'incomplete'
        }`, () =>
        habit.type === 'boolean' && $<HTMLInputElement>('#quick-toggle').checked
          ? commit(setEntry(state, habit.id, day, value ? 0 : 1))
          : openEntries(habit, day), `check ${done ? 'done' : value > 0 ? 'partial' : ''}`)
      if (habit.type === 'boolean') control.setAttribute('aria-pressed', String(done))
      if (habit.notes?.[day]) control.title = habit.notes[day]
      control.addEventListener('contextmenu', event => { event.preventDefault(); void attempt(() => habit.type === 'boolean' && !$<HTMLInputElement>('#quick-toggle').checked
        ? commit(setEntry(state, habit.id, day, value ? 0 : 1)) : openEntries(habit, day)); })
      cell.append(control)
      row.append(cell)
    }
    const edit = element('td')
    edit.append(button('✎', `Edit ${habit.name}`, () => openEditor(habit), 'edit-button'))
    if ($<HTMLSelectElement>('#sort').value === 'manual' && habit.parentId === null) {
      edit.append(button('↑', `Move ${habit.name} up`, () => commit(moveHabit(state, habit.id, -1))))
      edit.append(button('↓', `Move ${habit.name} down`, () => commit(moveHabit(state, habit.id, 1))))
    }
    row.append(edit)
    $('#habits').append(row)
  }
  $('#empty').hidden = habits.length > 0
  $('#empty-title').textContent = state.habits.length ? 'No habits match these filters.' : 'Make room for a new habit.'
  $('#empty-message').textContent = state.habits.length ? 'Check search, category, archived, and completed filters.' : 'Add a Boolean habit, a numeric habit, or a group.'
  for (const id of selected) if (!state.habits.some(h => h.id === id)) selected.delete(id)
  $('#selection').hidden = selected.size === 0
  $('#selection-count').textContent = `${selected.size} selected`
  const category = $<HTMLSelectElement>('#category')
  const current = category.value
  const categories = [...new Set(state.habits.map(h => settingsOf(h).category).filter(Boolean))].sort()
  category.replaceChildren(new Option('All categories', ''), ...categories.map(c => new Option(c, c)))
  category.value = current
  $('#categories').replaceChildren(...categories.map(c => new Option(c, c)))
}

const editor = $<HTMLDialogElement>('#editor')
const habitForm = $<HTMLFormElement>('#habit-form')
type Fields = {
  name: HTMLInputElement; type: HTMLSelectElement; target: HTMLInputElement
  unit: HTMLInputElement; color: HTMLInputElement; parentId: HTMLSelectElement
}
function field<K extends keyof Fields>(name: K): Fields[K] {
  const node = habitForm.elements.namedItem(name)
  if (!(node instanceof HTMLInputElement || node instanceof HTMLSelectElement)) throw new Error(`Missing field: ${name}`)
  return node as Fields[K]
}

function updateTypeFields() {
  const numeric = field('type').value === 'number'
  $('#numeric-fields').hidden = !numeric
  field('target').disabled = !numeric
  $('#parent-field').hidden = field('type').value === 'group'
  $('#schedule-fields').hidden = field('type').value === 'group'
  $('#children-field').hidden = field('type').value !== 'group'
  field('target').min = setting('targetType').value === '1' ? '0' : '0.000001'
}

function setting(name: string): HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement {
  const node = habitForm.elements.namedItem(name)
  if (!(node instanceof HTMLInputElement || node instanceof HTMLSelectElement || node instanceof HTMLTextAreaElement)) throw new Error(`Missing setting: ${name}`)
  return node
}

function openEditor(habit: Habit | null = null) {
  editingId = habit?.id ?? null
  habitForm.reset()
  $('#editor-title').textContent = habit ? 'Edit habit' : 'New habit'
  field('type').disabled = Boolean(habit)
  field('parentId').replaceChildren(new Option('No group', ''))
  for (const group of state.habits.filter(h => h.type === 'group')) {
    field('parentId').add(new Option(group.name, group.id))
  }
  for (const key of ['name', 'type', 'target', 'unit', 'color'] as const) {
    if (habit) field(key).value = String(habit[key])
  }
  field('parentId').value = habit?.parentId ?? ''
  const settings = settingsOf(habit ?? undefined)
  for (const name of ['question', 'description', 'category', 'frequencyNumerator', 'frequencyDenominator', 'targetType'] as const) setting(name).value = String(settings[name])
  ;(setting('archived') as HTMLInputElement).checked = settings.archived
  setting('reminderTime').value = settings.reminder ? `${String(settings.reminder.hour).padStart(2, '0')}:${String(settings.reminder.minute).padStart(2, '0')}` : ''
  for (const checkbox of document.querySelectorAll<HTMLInputElement>('#reminder-days input')) checkbox.checked = Boolean((settings.reminder?.days ?? 127) & Number(checkbox.value))
  const groupChildren = $<HTMLSelectElement>('#group-children')
  groupChildren.replaceChildren(...state.habits.filter(h => h.type !== 'group').map(h => {
    const option = new Option(h.name, h.id)
    option.selected = h.parentId === habit?.id
    return option
  }))
  $('#delete').hidden = !habit
  updateTypeFields()
  editor.showModal()
  field('name').focus()
}

field('type').addEventListener('change', updateTypeFields)
setting('targetType').addEventListener('change', updateTypeFields)
habitForm.addEventListener('submit', event => {
  event.preventDefault()
  void attempt(async () => {
    const id = editingId ?? crypto.randomUUID()
    const time = setting('reminderTime').value
    const [hour, minute] = time.split(':').map(Number)
    const days = [...document.querySelectorAll<HTMLInputElement>('#reminder-days input:checked')].reduce((mask, input) => mask | Number(input.value), 0)
    let next = saveHabit(state, {
      id,
      name: field('name').value,
      type: field('type').value as HabitType,
      target: field('type').value === 'number' ? Number(field('target').value) : 1,
      unit: field('unit').value,
      color: field('color').value,
      parentId: field('type').value === 'group' ? null : field('parentId').value || null,
      settings: {
        question: setting('question').value, description: setting('description').value, category: setting('category').value,
        archived: (setting('archived') as HTMLInputElement).checked,
        frequencyNumerator: field('type').value === 'group' ? 1 : Number(setting('frequencyNumerator').value),
        frequencyDenominator: field('type').value === 'group' ? 1 : Number(setting('frequencyDenominator').value),
        targetType: Number(setting('targetType').value) as 0 | 1,
        reminder: field('type').value !== 'group' && time ? { hour, minute, days } : null
      }
    })
    if (field('type').value === 'group') {
      const childIds = new Set([...$<HTMLSelectElement>('#group-children').selectedOptions].map(o => o.value))
      next = { ...next, habits: next.habits.map(h => h.type === 'group' ? h : childIds.has(h.id) ? { ...h, parentId: id } : h.parentId === id ? { ...h, parentId: null } : h) }
    }
    await commit(next)
    editor.close()
  })
})

$('#delete').addEventListener('click', () => attempt(async () => {
  if (editingId === null) return
  if (!confirm('Delete this habit and its entries? Child habits of a group will stay.')) return
  await commit(deleteHabit(state, editingId))
  editor.close()
}))

function openEntries(habit: Habit, day: string) {
  const habits = habit.type === 'group' ? children(state, habit.id).filter(h => !settingsOf(h).archived) : [habit]
  entryContext = { day, habits, inputs: new Map(), notes: new Map(), statuses: new Map() }
  $('#entry-title').textContent = habit.name
  $('#entry-date').textContent = day
  $('#entry-fields').replaceChildren()
  $('#entry-hint').textContent = !habits.length
    ? 'Add a child habit and choose this group in its editor.'
    : habit.type === 'group'
    ? 'Save child activity to update the group automatically.'
    : `Daily target: ${habit.target} ${habit.unit}`
  $<HTMLButtonElement>('#save-entries').disabled = habits.length === 0
  for (const child of habits) {
    const label = element('label',
      child.type === 'number' ? `${child.name} (${child.unit || 'amount'})` : child.name)
    const input = child.type === 'boolean' ? element('select') : element('input')
    input.name = child.id
    if (child.type === 'boolean') {
      const select = input as HTMLSelectElement
      select.add(new Option('Unknown · no record', 'unknown'))
      select.add(new Option('No', '0'))
      select.add(new Option('Yes', '1'))
      if ($<HTMLInputElement>('#allow-skip').checked || child.skippedDays?.includes(day)) select.add(new Option('Skip', 'skip'))
      select.value = child.skippedDays?.includes(day) ? 'skip' : child.unknownDays?.includes(day) ? 'unknown' : Object.hasOwn(child.entries, day) ? String(activity(state, child.id, day)) : 'unknown'
    } else {
      const numeric = input as HTMLInputElement
      numeric.type = 'number'
      numeric.min = '0'
      numeric.step = '0.001'
      numeric.required = true
      input.value = String(activity(state, child.id, day))
      const status = element('select')
      status.setAttribute('aria-label', `${child.name} entry state`)
      status.add(new Option('Recorded value', 'value'))
      status.add(new Option('Unknown · no record', 'unknown'))
      if ($<HTMLInputElement>('#allow-skip').checked || child.skippedDays?.includes(day)) status.add(new Option('Skip', 'skip'))
      status.value = child.skippedDays?.includes(day) ? 'skip' : child.unknownDays?.includes(day) ? 'unknown' : Object.hasOwn(child.entries, day) ? 'value' : 'unknown'
      numeric.disabled = status.value !== 'value'
      status.addEventListener('change', () => { numeric.disabled = status.value !== 'value' })
      entryContext.statuses.set(child.id, status)
      label.append(status)
    }
    label.append(input)
    entryContext.inputs.set(child.id, input)
    $('#entry-fields').append(label)
    const noteLabel = element('label', `${child.name} · date notes`)
    const note = element('textarea')
    note.rows = 2
    note.value = child.notes?.[day] ?? ''
    noteLabel.append(note)
    entryContext.notes.set(child.id, note)
    $('#entry-fields').append(noteLabel)
  }
  $<HTMLDialogElement>('#entry').showModal()
}

$('#entry-form').addEventListener('submit', event => {
  event.preventDefault()
  void attempt(async () => {
    const context = entryContext
    if (!context) return
    let next = state
    for (const habit of context.habits) {
      const input = context.inputs.get(habit.id)
      if (!input) throw new Error('Missing entry field.')
      const status = context.statuses.get(habit.id)?.value ?? input.value
      const value = status === 'skip' ? 'skip' : status === 'unknown' ? null : Number(input.value)
      next = setRecord(next, habit.id, context.day, value, context.notes.get(habit.id)?.value)
    }
    await commit(next)
    $<HTMLDialogElement>('#entry').close()
    if (detailId) { renderProgress(); renderHistory(); }
  })
})

for (const node of document.querySelectorAll('[data-close]')) {
  node.addEventListener('click', () => node.closest('dialog')?.close())
}
$('#add').addEventListener('click', () => openEditor())
$('#first').addEventListener('click', () => openEditor())
$('#previous').addEventListener('click', () => {
  offset -= 7
  render()
})
$('#next').addEventListener('click', () => {
  offset += 7
  render()
})
$('#today').addEventListener('click', () => {
  offset = 0
  render()
})
function download(blob: Blob, extension: string) {
  const url = URL.createObjectURL(blob)
  const link = element('a')
  link.href = url
  link.download = `loop-web-${dateKey(new Date())}.${extension}`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function downloadCSV(id?: string) {
  download(new Blob([exportCSV(state, id)], { type: 'text/csv;charset=utf-8' }), 'csv')
  report('CSV exported for analysis. Use Export DB for a restorable backup.')
}

function openDetails(habit: Habit) {
  detailId = habit.id
  const settings = settingsOf(habit)
  $('#details-title').textContent = habit.name
  $('#details-question').textContent = settings.question
  $('#details-notes').textContent = settings.description || 'No habit notes.'
  $('#details-target').textContent = habit.type === 'number'
    ? `${settings.targetType === 1 ? 'At most' : 'At least'} ${habit.target} ${habit.unit} / ${settings.frequencyDenominator} day(s)`
    : `${settings.frequencyNumerator} repetition(s) in ${settings.frequencyDenominator} day(s)`
  $('#details-archive').textContent = settings.archived ? 'Unarchive' : 'Archive'
  $<HTMLInputElement>('#chart-until').value = dateKey(new Date())
  const totalPeriod = $<HTMLSelectElement>('#total-period')
  totalPeriod.options[0]!.disabled = habit.type !== 'number'
  if (habit.type !== 'number' && totalPeriod.value === '0') totalPeriod.value = '1'
  $<HTMLDialogElement>('#details').style.setProperty('--habit-color', habit.color)
  renderProgress()
  $<HTMLInputElement>('#history-month').value = dateKey(new Date()).slice(0, 7)
  renderHistory()
  $<HTMLDialogElement>('#details').showModal()
}

function renderHistory() {
  const habit = state.habits.find(h => h.id === detailId)
  if (!habit) return
  const month = $<HTMLInputElement>('#history-month').value
  if (!/^\d{4}-\d{2}$/.test(month)) return
  const count = new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0).getDate()
  const firstWeekday = Number($<HTMLSelectElement>('#first-weekday').value) - 1
  const cells: HTMLElement[] = []
  for (let index = 0; index < 7; index++) {
    const date = new Date(2026, 10, 1 + (firstWeekday + index) % 7)
    cells.push(element('span', date.toLocaleDateString(undefined, { weekday: 'short' })))
  }
  const firstDay = new Date(`${month}-01T12:00:00`).getDay()
  for (let index = 0; index < (firstDay - firstWeekday + 7) % 7; index++) cells.push(element('span'))
  cells.push(...Array.from({ length: count }, (_, index) => {
    const day = `${month}-${String(index + 1).padStart(2, '0')}`
    const computed = metrics[habit.id]?.entries[day]
    const value = habit.skippedDays?.includes(day) ? '−' : (computed?.value ?? -1) === -1 ? '?' : habit.type === 'number' ? String(habit.entries[day] ?? 0) : isComplete(habit.id, day) ? '✓' : 'No'
    const control = button(`${index + 1}: ${value}`, `${habit.name}, ${day}: ${value}`, () => openEntries(habit, day), isComplete(habit.id, day) ? 'done' : '')
    control.title = habit.notes?.[day] ?? ''
    return control
  }))
  $('#history').replaceChildren(...cells)
}

function renderProgress() {
  refreshMetrics()
  const habit = state.habits.find(h => h.id === detailId)
  if (!habit) return
  const progress = metrics[habit.id]
  if (!progress) return
  const until = $<HTMLInputElement>('#chart-until').value || dateKey(new Date())
  const window = (points: { date: string; value: number }[]) => points.filter(p => p.date <= until).sort((a, b) => a.date.localeCompare(b.date)).slice(-60)
  const percent = (value: number) => `${(value * 100).toFixed(1)}%`
  $('#details-overview').textContent = `Strength ${percent(progress.overview.strength)} · ${progress.overview.total} repetitions · Month change ${percent(progress.overview.monthDifference)} · Year change ${percent(progress.overview.yearDifference)}`
  $('#overview-section').hidden = habit.type === 'number'
  $('#target-section').hidden = habit.type !== 'number'
  $('#target-list').replaceChildren(...(progress.targets?.values ?? []).map((value, index) => {
    const period = ({ 1: 'Today', 7: 'This week', 30: 'This month', 91: 'This quarter', 365: 'This year' } as Record<number, string>)[progress.targets!.intervals[index]!]
    return element('p', `${period}: ${value.toLocaleString()} / ${progress.targets!.targets[index]!.toLocaleString()} ${habit.unit}`)
  }))
  drawChart($('#strength-chart'), window(progress.scores).map(p => ({ ...p, value: p.value * 100 })), 'Habit strength (%)')
  $('#streak-list').replaceChildren(...progress.streaks.map(streak => element('li', `${streak.start} – ${streak.end}: ${streak.length} days`)))
  if (!progress.streaks.length) $('#streak-list').append(element('li', 'No streaks yet.'))
  drawChart($('#totals-chart'), window(progress.totals), habit.type === 'number' ? `Totals (${habit.unit})` : 'Total repetitions', true)
  const month = $<HTMLSelectElement>('#frequency-month')
  const previous = month.value
  const months = [...progress.frequency].sort((a, b) => b.date.localeCompare(a.date))
  month.replaceChildren(...months.map(m => new Option(m.date.slice(0, 7), m.date)))
  if (months.some(m => m.date === previous)) month.value = previous
  renderFrequency()
}

function renderFrequency() {
  const progress = detailId ? metrics[detailId] : undefined
  const month = progress?.frequency.find(m => m.date === $<HTMLSelectElement>('#frequency-month').value)
  const firstWeekday = Number($<HTMLSelectElement>('#first-weekday').value) - 1
  const points = month ? Array.from({ length: 7 }, (_, index) => {
    const day = (firstWeekday + index) % 7
    return { date: new Date(2026, 10, 1 + day).toLocaleDateString(undefined, { weekday: 'short' }), value: month.values[day] ?? 0 }
  }) : []
  drawChart($('#frequency-chart'), points, 'Frequency by weekday', true)
}

async function updateSelection(update: (habit: Habit) => Habit) {
  await commit({ ...state, habits: state.habits.map(h => selected.has(h.id) ? update(h) : h) })
}

for (const id of ['search', 'category', 'sort', 'show-archived', 'hide-completed']) {
  $("#" + id).addEventListener(id === 'search' ? 'input' : 'change', render)
}
$('#jump-date').addEventListener('change', () => {
  const value = $<HTMLInputElement>('#jump-date').value
  if (!value) return
  offset = Math.round((Date.parse(value) - Date.parse(dateKey(new Date()))) / 86_400_000)
  render()
})
$('#bulk-archive').addEventListener('click', () => attempt(() => updateSelection(h => ({ ...h, settings: { ...settingsOf(h), archived: true } }))))
$('#bulk-restore').addEventListener('click', () => attempt(() => updateSelection(h => ({ ...h, settings: { ...settingsOf(h), archived: false } }))))
$('#bulk-category').addEventListener('click', () => attempt(async () => {
  const category = prompt('Category for selected habits. Leave empty to remove it.')
  if (category !== null) await updateSelection(h => ({ ...h, settings: { ...settingsOf(h), category } }))
}))
$('#bulk-color').addEventListener('click', () => attempt(async () => {
  const color = prompt('Color for selected habits, for example #6750a4')
  if (color !== null) await updateSelection(h => ({ ...h, color }))
}))
$('#bulk-delete').addEventListener('click', () => attempt(async () => {
  if (!confirm(`Permanently delete ${selected.size} habit(s) and their records? Export DB first if you need a backup. You cannot undo this.`)) return
  let next = state
  for (const id of selected) next = deleteHabit(next, id)
  await commit(next)
}))
$('#clear-selection').addEventListener('click', () => { selected.clear(); render(); })
$('#csv').addEventListener('click', () => downloadCSV())
$('#history-month').addEventListener('change', renderHistory)
$('#frequency-month').addEventListener('change', renderFrequency)
$('#chart-until').addEventListener('change', renderProgress)
for (const id of ['score-period', 'total-period']) $("#" + id).addEventListener('change', () => { renderProgress(); renderHistory(); })
$('#details-edit').addEventListener('click', () => {
  const habit = state.habits.find(h => h.id === detailId)
  if (!habit) return
  $<HTMLDialogElement>('#details').close()
  openEditor(habit)
})
$('#details-archive').addEventListener('click', () => attempt(async () => {
  const habit = state.habits.find(h => h.id === detailId)
  if (!habit) return
  await commit(saveHabit(state, { ...habit, settings: { ...settingsOf(habit), archived: !settingsOf(habit).archived } }))
  $<HTMLDialogElement>('#details').close()
}))
$('#details-export').addEventListener('click', () => { if (detailId) downloadCSV(detailId) })
$('#preferences').addEventListener('click', () => $<HTMLDialogElement>('#settings').showModal())
$('#enable-reminders').addEventListener('click', () => attempt(async () => {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) throw new Error('This browser does not support push reminders.')
  if (await Notification.requestPermission() !== 'granted') throw new Error('Allow notifications in browser settings to receive reminders.')
  const registration = await navigator.serviceWorker.register('/sw.js')
  await navigator.serviceWorker.ready
  const key = await (await checked(client.api.push.key.$get())).json()
  if (!('publicKey' in key)) throw new Error(key.error)
  const { publicKey } = key
  const bytes = Uint8Array.from(atob(publicKey.replaceAll('-', '+').replaceAll('_', '/')), character => character.charCodeAt(0))
  const subscription = await registration.pushManager.getSubscription()
    ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes })
  await checked(client.api.push.subscription.$post({ json: { subscription: subscription.toJSON(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone } }))
  report('Browser reminders enabled. Keep the local server running.')
}))
$('#disable-reminders').addEventListener('click', () => attempt(async () => {
  if (!('serviceWorker' in navigator)) return
  const registration = await navigator.serviceWorker.getRegistration('/')
  const subscription = await registration?.pushManager.getSubscription()
  if (subscription) {
    await checked(client.api.push.subscription.$delete({ query: { endpoint: subscription.endpoint } }))
    await subscription.unsubscribe()
  }
  report('Browser reminders disabled for this database and device.')
}))
for (const id of ['quick-toggle', 'show-unknown', 'allow-skip', 'reverse-dates']) {
  const input = $<HTMLInputElement>(`#${id}`)
  const stored = localStorage.getItem(`loop-${id}`)
  if (stored !== null) input.checked = stored === 'true'
  input.addEventListener('change', () => { localStorage.setItem(`loop-${id}`, String(input.checked)); render(); })
}
const theme = $<HTMLSelectElement>('#theme')
theme.value = localStorage.getItem('loop-theme') ?? 'system'
document.documentElement.dataset.theme = theme.value
theme.addEventListener('change', () => {
  localStorage.setItem('loop-theme', theme.value)
  document.documentElement.dataset.theme = theme.value
})
const firstWeekday = $<HTMLSelectElement>('#first-weekday')
firstWeekday.value = localStorage.getItem('loop-first-weekday') ?? '1'
if (!firstWeekday.value) firstWeekday.value = '1'
firstWeekday.addEventListener('change', () => {
  localStorage.setItem('loop-first-weekday', firstWeekday.value)
  render()
  if (detailId) { renderProgress(); renderHistory(); }
})
for (const [index, day] of ['Saturday', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].entries()) {
  const label = element('label', day)
  const checkbox = element('input')
  checkbox.type = 'checkbox'
  checkbox.value = String(1 << index)
  checkbox.checked = true
  label.prepend(checkbox)
  $('#reminder-days').append(label)
}

$('#export').addEventListener('click', () => attempt(async () => {
    if (state.habits.some(h => h.type === 'group' || h.android?.habit.category) && !confirm(
      'This backup contains groups or categories. It requires the modified Android build. Continue?'
    )) return
    download(await (await checked(client.api.export.$get())).blob(), 'db')
    report('Android Loop database exported. Import this .db file in the Android app.')
}))

const fileInput = $<HTMLInputElement>('#file')
$('#import').addEventListener('click', () => fileInput.click())
fileInput.addEventListener('change', () => attempt(async () => {
  const file = fileInput.files?.[0]
  if (!file) return
  try {
    if (file.size > 10 * 1024 * 1024) throw new Error('Choose a backup smaller than 10 MB.')
    if (state.habits.length && !confirm('Replace the current database? Export DB first to keep a backup.')) {
      return
    }
    const response = await checked(client.api.import.$post({}, { init: { body: file } }))
    if (response.status !== 200) throw new Error('Could not import the database.')
    state = await response.json()
    render()
    report('Database opened. Export DB after you make changes.')
  } catch (error) {
    report(errorMessage(error), true)
  } finally {
    fileInput.value = ''
  }
}))

render()

try {
  state = await database.connect()
  ready = true
  render()
  report('Database connected. The local server saves changes automatically. Export DB for a portable backup.')
} catch (error) {
  report(errorMessage(error), true)
}
