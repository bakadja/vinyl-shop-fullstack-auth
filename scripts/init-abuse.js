import { createDatabase } from '../db/db.js'
import { databaseConfig } from '../db/config.js'
import { initializeAbuse } from '../sessions/abuse-schema.js'
let database
try {
  database = createDatabase(databaseConfig())
  await initializeAbuse(database)
  console.log('PostgreSQL authentication abuse storage initialized; application data preserved.')
} catch {
  console.error('PostgreSQL abuse initialization failed. Check configuration and schema compatibility.')
  process.exitCode = 1
} finally { if (database) await database.close() }
