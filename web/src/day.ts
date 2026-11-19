import { core } from './core.ts'

export function habitDate(now: Date, extended: boolean): Date {
  const [year, month, day] = core.calculateWebHabitDate(now.getTime(), extended).split('-').map(Number)
  const date = new Date(now)
  date.setFullYear(year, month - 1, day)
  return date
}
