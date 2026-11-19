import { hc } from 'hono/client'
import type { AppType } from './server.ts'
import type { State } from './model.ts'

export function createDatabaseClient(
  baseURL: string,
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  fetcher?: typeof fetch
) {
  const key = 'loop-database-session'
  const client = hc<AppType>(baseURL, {
    fetch: fetcher,
    headers: (): Record<string, string> => {
      const id = storage.getItem(key)
      return id ? { 'X-Loop-Session': id } : {}
    }
  })

  async function connect(): Promise<State> {
    if (storage.getItem(key)) {
      const response = await client.api.state.$get()
      if (response.status === 404) {
        storage.setItem(key, '')
        throw new Error('Database session expired. Import your backup again after you reload the page.')
      }
      if (!response.ok) throw new Error('Could not reconnect to the database. Try to reload the page.')
      return response.json()
    }
    const response = await client.api.sessions.$post()
    if (response.status !== 201) throw new Error('Could not create a database session.')
    const session = await response.json()
    storage.setItem(key, session.id)
    return session.state
  }

  return { client, connect }
}
