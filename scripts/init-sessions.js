import { createDatabase } from '../db/db.js'
import { databaseConfig } from '../db/config.js'
import { initializeSessions } from '../sessions/schema.js'
let database
try {
  database = createDatabase(databaseConfig())
  await initializeSessions(database)
  console.log('PostgreSQL session storage initialized; application data preserved.')
} catch {
  console.error('PostgreSQL session initialization failed. Check configuration and schema compatibility.')
  process.exitCode = 1
} finally { if (database) await database.close() }
