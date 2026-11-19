import { settingsOf } from './model.ts'
import type { State } from './model.ts'

export function exportCSV(state: State, habitId?: string): string {
  const cell = (value: string | number) => {
    let text = String(value)
    if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`
    return `"${text.replaceAll('"', '""')}"`
  }
  const rows: (string | number)[][] = [['Habit', 'Type', 'Category', 'Archived', 'Date', 'Value', 'State', 'Notes', 'Unit']]
  for (const habit of state.habits.filter(h => !habitId || h.id === habitId)) {
    const settings = settingsOf(habit)
    const days = Object.keys(habit.entries).sort()
    for (const day of days.length ? days : ['']) rows.push([
      habit.name, habit.type, settings.category, Number(settings.archived), day,
      day && !habit.unknownDays?.includes(day) ? habit.entries[day] : '', day ? habit.skippedDays?.includes(day) ? 'skipped' : habit.unknownDays?.includes(day) ? 'unknown' : 'recorded' : 'unknown',
      habit.notes?.[day] ?? '', habit.unit
    ])
  }
  return `${rows.map(row => row.map(cell).join(',')).join('\r\n')}\r\n`
}
