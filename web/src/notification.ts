import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

interface Action { session: string; habit: string; day: string; expires: number }

export function signAction(action: Action, secret: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', createHash('sha256').update(secret).digest(), iv)
  const payload = Buffer.concat([cipher.update(JSON.stringify(action)), cipher.final()])
  return [iv, payload, cipher.getAuthTag()].map(value => value.toString('base64url')).join('.')
}

export function verifyAction(token: string, secret: string): Action {
  if (token.length > 4096) throw new Error('Invalid notification credential.')
  const [iv, payload, tag, extra] = token.split('.')
  if (!iv || !payload || !tag || extra) throw new Error('Invalid notification credential.')
  const decipher = createDecipheriv('aes-256-gcm', createHash('sha256').update(secret).digest(), Buffer.from(iv, 'base64url'))
  decipher.setAuthTag(Buffer.from(tag, 'base64url'))
  const action = JSON.parse(Buffer.concat([decipher.update(Buffer.from(payload, 'base64url')), decipher.final()]).toString()) as Action
  if (!Number.isFinite(action.expires) || action.expires <= Date.now()) throw new Error('Notification expired.')
  return action
}
