import { getDatabase, closeDatabase } from './db/db.js'

async function logTable() {
  try {
    // Keep this debug utility restricted to cart rows; never print accounts or hashes.
    const { rows } = await getDatabase().query('SELECT * FROM cart_items')
    console.table(rows)
  } catch {
    console.error('Unable to read cart table')
    process.exitCode = 1
  } finally { await closeDatabase() }
}

await logTable()
