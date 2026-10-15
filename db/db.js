import pg from 'pg'
import { databaseConfig } from './config.js'

export function createDatabase(config) {
  const pool = new pg.Pool(config)
  pool.on('error', () => console.error('PostgreSQL idle connection failed'))
  return {
    getPool: () => pool,
    query: (text, values = []) => pool.query(text, values),
    async transaction(work) {
      const client = await pool.connect()
      let broken = false
      try {
        await client.query('BEGIN')
        const result = await work(client)
        await client.query('COMMIT')
        return result
      } catch (error) {
        try { await client.query('ROLLBACK') } catch { broken = true }
        throw error
      } finally { client.release(broken) }
    },
    close: () => pool.end()
  }
}

let database
export function getDatabase() {
  database ??= createDatabase(databaseConfig())
  return database
}
export async function closeDatabase() {
  if (!database) return
  const current = database
  database = undefined
  await current.close()
}
