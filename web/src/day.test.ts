import assert from 'node:assert/strict'
import test from 'node:test'
import { habitDate } from './day.ts'

test('extended day changes the date before 03:00 only', () => {
  const early = new Date(2026, 0, 1, 2, 59)
  assert.equal(habitDate(early, true).getFullYear(), 2025)
  assert.equal(habitDate(early, true).getDate(), 31)
  assert.equal(habitDate(early, false).getDate(), 1)
  assert.equal(habitDate(new Date(2026, 0, 1, 3), true).getDate(), 1)
  assert.equal(early.getDate(), 1)
})

test('habit dates handle leap days and preserve the local time', () => {
  const now = new Date(2024, 2, 1, 1, 23, 45, 678)
  const adjusted = habitDate(now, true)
  assert.equal(adjusted.getFullYear(), 2024)
  assert.equal(adjusted.getMonth(), 1)
  assert.equal(adjusted.getDate(), 29)
  assert.equal(adjusted.getHours(), 1)
  assert.equal(adjusted.getMinutes(), 23)
  assert.equal(adjusted.getMilliseconds(), 678)
  assert.equal(now.getMonth(), 2)
})
