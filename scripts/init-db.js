import { open as createFile, readFile, unlink } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sqlite3 from 'sqlite3'
import { open } from 'sqlite'

export async function initializeDatabase(filename = resolve('database.db')) {
  // Exclusive creation prevents accidental replacement of any existing local DB.
  const file = await createFile(filename, 'wx')
  await file.close()

  let db
  try {
    const sql = await readFile(new URL('../db/init.sql', import.meta.url), 'utf8')
    db = await open({ filename, driver: sqlite3.Database })
    await db.exec(sql)
    await db.close()
  } catch (error) {
    if (db) await db.close().catch(() => {})
    await unlink(filename)
    throw error
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await initializeDatabase()
    console.log('Local demo database initialized: catalogue only, no users or carts.')
  } catch (error) {
    console.error(error.code === 'EEXIST'
      ? 'database.db already exists. Back it up or remove it explicitly before initialization.'
      : 'Database initialization failed. Check local filesystem permissions and dependencies.')
    process.exitCode = 1
  }
}
