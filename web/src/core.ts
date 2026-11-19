const moduleURL = typeof window === 'undefined'
  ? new URL('../../uhabits-core/build/dist/js/productionLibrary/uhabits-uhabits-core.mjs', import.meta.url).href
  : '/core/uhabits-uhabits-core.mjs'

export const core = await import(moduleURL) as {
  calculateWebMetrics(input: string): string
  queryWebHabits(input: string): string
  mutateWebHabits(input: string): string
  calculateWebHabitDate(timestamp: number, extended: boolean): string
  webNearestColorIndex(hex: string): number
  webPaletteColor(index: number): string
}
