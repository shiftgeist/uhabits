import assert from 'node:assert/strict'
import test from 'node:test'
import { signAction, verifyAction } from './notification.ts'

test('notification credentials bind the session, habit, date and expiry', () => {
  const action = { session: 'session', habit: 'walk', day: '2026-11-19', expires: Date.now() + 60000 }
  const token = signAction(action, 'secret')
  assert.deepEqual(verifyAction(token, 'secret'), action)
  assert.throws(() => verifyAction(token, 'wrong'))
  assert.throws(() => verifyAction(`${token}x`, 'secret'))
  assert.throws(() => verifyAction(signAction({ ...action, expires: 0 }, 'secret'), 'secret'))
})
