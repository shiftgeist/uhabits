import { validateState } from './model.ts'
import type { State } from './model.ts'
import { core } from './core.ts'

export interface HabitMetrics {
  entries: Record<string, { value: number; completed: boolean }>
  overview: { strength: number; monthDifference: number; yearDifference: number; total: number }
  scores: { date: string; value: number }[]
  streaks: { start: string; end: string; length: number }[]
  frequency: { date: string; values: number[] }[]
  totals: { date: string; value: number }[]
  targets?: { values: number[]; targets: number[]; intervals: number[] }
}

export function calculateMetrics(state: State, today: string, firstWeekday = 1, scoreBucket = 0, totalBucket = 0): Record<string, HabitMetrics> {
  validateState(state)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today) || !Number.isFinite(Date.parse(today))) throw new Error('Invalid current date.')
  if (!Number.isInteger(firstWeekday) || firstWeekday < 1 || firstWeekday > 7) throw new Error('Invalid first weekday.')
  if (![scoreBucket, totalBucket].every(bucket => Number.isInteger(bucket) && bucket >= 0 && bucket < 5)) throw new Error('Invalid chart period.')
  return JSON.parse(core.calculateWebMetrics(JSON.stringify({ today, firstWeekday, scoreBucket, totalBucket,
    booleanTotalBucket: Math.max(0, totalBucket - 1), state }))) as Record<string, HabitMetrics>
}
