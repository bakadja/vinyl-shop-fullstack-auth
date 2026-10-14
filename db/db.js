import sqlite3 from 'sqlite3'
import { open } from 'sqlite'
import path from 'node:path'

export async function getDBConnection() {

const dbPath = path.join('database.db')

 return open({
   filename: dbPath,
   driver: sqlite3.Database
 }) 
 
} 

// The legacy SQLite export remains only until all consumers have migrated.
import pg from 'pg'
import { databaseConfig } from './config.js'

export function createDatabase(config) {
  const pool = new pg.Pool(config)
  pool.on('error', () => console.error('PostgreSQL idle connection failed'))
  return {
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
