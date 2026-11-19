import { settingsOf, validateState } from './model.ts'
import type { State } from './model.ts'

export interface HabitMetrics {
  entries: Record<string, { value: number; completed: boolean }>
  overview: { strength: number; monthDifference: number; yearDifference: number; total: number }
  scores: { date: string; value: number }[]
  streaks: { start: string; end: string; length: number }[]
  frequency: { date: string; values: number[] }[]
  totals: { date: string; value: number }[]
  targets?: { values: number[]; targets: number[]; intervals: number[] }
}

const moduleURL = typeof window === 'undefined'
  ? new URL('../../uhabits-core/build/dist/js/productionLibrary/uhabits-uhabits-core.mjs', import.meta.url).href
  : '/core/uhabits-uhabits-core.mjs'
const engine = await import(moduleURL) as { calculateWebMetrics(input: string): string }

export function calculateMetrics(state: State, today: string, firstWeekday = 1, scoreBucket = 0, totalBucket = 0): Record<string, HabitMetrics> {
  validateState(state)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today) || !Number.isFinite(Date.parse(today))) throw new Error('Invalid current date.')
  if (!Number.isInteger(firstWeekday) || firstWeekday < 1 || firstWeekday > 7) throw new Error('Invalid first weekday.')
  if (![scoreBucket, totalBucket].every(bucket => Number.isInteger(bucket) && bucket >= 0 && bucket < 5)) throw new Error('Invalid chart period.')
  const habits = state.habits.map(habit => {
    const settings = settingsOf(habit)
    const originals = new Map((habit.android?.entries ?? []).map(entry => [new Date(entry.timestamp).toISOString().slice(0, 10), entry.value]))
    return {
      id: habit.id, type: habit.type, parentId: habit.parentId, target: habit.target,
      numerator: settings.frequencyNumerator, denominator: settings.frequencyDenominator,
      targetType: settings.targetType,
      records: Object.entries(habit.entries).map(([date, value]) => ({ date,
        notes: habit.notes?.[date] ?? '',
        value: !habit.editedDays?.includes(date) && originals.has(date) ? originals.get(date)
          : habit.unknownDays?.includes(date) ? -1 : habit.skippedDays?.includes(date) ? 3
            : habit.type === 'number' ? Math.round(value * 1000) : value ? 2 : 0
      }))
    }
  })
  return JSON.parse(engine.calculateWebMetrics(JSON.stringify({ today, firstWeekday, scoreBucket, totalBucket,
    booleanTotalBucket: Math.max(0, totalBucket - 1), habits }))) as Record<string, HabitMetrics>
}
