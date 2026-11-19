export function habitDate(now: Date, extended: boolean): Date {
  const date = new Date(now)
  if (extended && date.getHours() < 3) date.setDate(date.getDate() - 1)
  return date
}
