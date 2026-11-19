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
