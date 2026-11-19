import { activity, children, completed, deleteHabit, emptyState,
  saveHabit, setEntry, toggleGroup, visibleHabits } from './model.ts'
import type { Habit, HabitType, State } from './model.ts'
import { createDatabaseClient } from './client.ts'

function $<T extends HTMLElement = HTMLElement>(selector: string): T {
  const node = document.querySelector(selector)
  if (!(node instanceof HTMLElement)) throw new Error(`Missing element: ${selector}`)
  return node as T
}
const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error)
let state = emptyState()
let ready = false
let busy = false
const database = createDatabaseClient(window.location.origin, sessionStorage)
const { client } = database
let dirty = sessionStorage.getItem('loop-database-dirty') === 'true'
let offset = 0
let editingId: string | null = null
let entryContext: { day: string; habits: Habit[]; inputs: Map<string, HTMLInputElement> } | null = null

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
  dirty = true
  sessionStorage.setItem('loop-database-dirty', 'true')
  report('Database updated on the local server. Export DB to keep your changes.')
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
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date()
    date.setHours(12, 0, 0, 0)
    date.setDate(date.getDate() + offset - 6 + index)
    return date
  })
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
  const days = dates()
  const today = dateKey(new Date())
  const top = state.habits.filter(h => h.parentId === null)
  $('#summary').textContent = `${
    top.filter(h => completed(state, h.id, today)).length
  } of ${top.length} complete today`
  const header = element('tr')
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
  for (const habit of visibleHabits(state)) {
    const row = element('tr', undefined,
      habit.parentId ? 'child' : habit.type === 'group' ? 'group' : '')
    row.style.setProperty('--habit-color', habit.color)
    const nameCell = element('th', undefined, 'habit-name')
    nameCell.scope = 'row'
    const name = button(
      habit.type === 'group'
        ? `${state.collapsedIds.includes(habit.id) ? '▸' : '▾'} ${habit.name}`
        : habit.name,
      habit.type === 'group' ? `Toggle ${habit.name}` : `Edit ${habit.name}`,
      () => habit.type === 'group' ? commit(toggleGroup(state, habit.id)) : openEditor(habit),
      'name-button'
    )
    if (habit.type === 'group') {
      name.setAttribute('aria-expanded', String(!state.collapsedIds.includes(habit.id)))
    }
    nameCell.append(name, element('small', habit.type === 'group'
      ? `${children(state, habit.id).length} child habits · any activity`
      : habit.type === 'number'
      ? `Target: ${habit.android?.habit.target_type === 1 ? 'at most ' : ''}${habit.target} ${habit.unit}`
      : 'Yes or no'))
    row.append(nameCell)
    for (const date of days) {
      const day = dateKey(date)
      const value = activity(state, habit.id, day)
      const done = completed(state, habit.id, day)
      const cell = element('td', undefined, day === today ? 'today' : '')
      const control = button(habit.type === 'number' ? String(value) : done ? '✓' : '·',
        `${habit.name}, ${day}: ${
          habit.type === 'number' ? `${value} ${habit.unit}` : done ? 'complete' : 'incomplete'
        }`, () =>
        habit.type === 'boolean'
          ? commit(setEntry(state, habit.id, day, value ? 0 : 1))
          : openEntries(habit, day), `check ${done ? 'done' : value > 0 ? 'partial' : ''}`)
      if (habit.type === 'boolean') control.setAttribute('aria-pressed', String(done))
      cell.append(control)
      row.append(cell)
    }
    const edit = element('td')
    edit.append(button('✎', `Edit ${habit.name}`, () => openEditor(habit), 'edit-button'))
    row.append(edit)
    $('#habits').append(row)
  }
  $('#empty').hidden = state.habits.length > 0
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
}

function openEditor(habit: Habit | null = null) {
  editingId = habit?.id ?? null
  field('target').min = habit?.android?.habit.target_type === 1 ? '0' : '0.000001'
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
  $('#delete').hidden = !habit
  updateTypeFields()
  editor.showModal()
  field('name').focus()
}

field('type').addEventListener('change', updateTypeFields)
habitForm.addEventListener('submit', event => {
  event.preventDefault()
  void attempt(async () => {
    await commit(saveHabit(state, {
      id: editingId ?? crypto.randomUUID(),
      name: field('name').value,
      type: field('type').value as HabitType,
      target: field('type').value === 'number' ? Number(field('target').value) : 1,
      unit: field('unit').value,
      color: field('color').value,
      parentId: field('type').value === 'group' ? null : field('parentId').value || null
    }))
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
  const habits = habit.type === 'group' ? children(state, habit.id) : [habit]
  entryContext = { day, habits, inputs: new Map() }
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
    const input = element('input')
    input.name = child.id
    if (child.type === 'boolean') {
      input.type = 'checkbox'
      input.checked = activity(state, child.id, day) > 0
      label.className = 'checkbox-label'
    } else {
      input.type = 'number'
      input.min = '0'
      input.step = 'any'
      input.required = true
      input.value = String(activity(state, child.id, day))
    }
    label.append(input)
    entryContext.inputs.set(child.id, input)
    $('#entry-fields').append(label)
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
      next = setEntry(next, habit.id, context.day,
        habit.type === 'boolean' ? Number(input.checked) : Number(input.value))
    }
    await commit(next)
    $<HTMLDialogElement>('#entry').close()
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

$('#export').addEventListener('click', () => attempt(async () => {
    if (state.habits.some(h => h.type === 'group' || h.android?.habit.category) && !confirm(
      'This backup contains groups or categories. It requires the modified Android build. Continue?'
    )) return
    download(await (await checked(client.api.export.$get())).blob(), 'db')
    dirty = false
    sessionStorage.removeItem('loop-database-dirty')
    report('Android Loop database exported. Import this .db file in the Android app.')
}))

const fileInput = $<HTMLInputElement>('#file')
$('#import').addEventListener('click', () => fileInput.click())
fileInput.addEventListener('change', () => attempt(async () => {
  const file = fileInput.files?.[0]
  if (!file) return
  try {
    if (file.size > 10 * 1024 * 1024) throw new Error('Choose a backup smaller than 10 MB.')
    if (dirty && !confirm('Replace the current database? Export DB first to keep your changes.')) {
      return
    }
    const response = await checked(client.api.import.$post({}, { init: { body: file } }))
    if (response.status !== 200) throw new Error('Could not import the database.')
    state = await response.json()
    dirty = false
    sessionStorage.removeItem('loop-database-dirty')
    render()
    report('Database opened. Export DB after you make changes.')
  } catch (error) {
    report(errorMessage(error), true)
  } finally {
    fileInput.value = ''
  }
}))

window.addEventListener('beforeunload', event => {
  if (!dirty) return
  event.preventDefault()
  event.returnValue = ''
})

render()

try {
  state = await database.connect()
  ready = true
  render()
  report('Database connected. Import DB to open another backup. Export DB to keep changes after the server stops.')
} catch (error) {
  report(errorMessage(error), true)
}
