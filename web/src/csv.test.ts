import assert from 'node:assert/strict'
import test from 'node:test'
import { exportCSV } from './csv.ts'
import { emptyState, saveHabit, setRecord } from './model.ts'

test('CSV quotes fields, protects formula cells, and exports notes and skipped states', () => {
  let state = saveHabit(emptyState(), { id: 'walk', name: '=Walk,"now"', type: 'boolean', parentId: null, target: 1, unit: '', color: '#d32f2f' })
  state = setRecord(state, 'walk', '2026-11-18', 'skip', 'Rest\nthen walk')
  const csv = exportCSV(state)
  assert.match(csv, /"'=Walk,""now"""/)
  assert.match(csv, /"skipped"/)
  assert.match(csv, /"Rest\nthen walk"/)
  assert.equal(exportCSV(state, 'missing').split('\r\n').length, 2)
})
