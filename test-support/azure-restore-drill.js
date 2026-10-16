import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
const root = new URL('../', import.meta.url).href
if (process.argv.length !== 2 || !process.env.PG_TEST_BIN) throw new Error('Run with the disposable PostgreSQL helper and explicit PG_TEST_BIN')
const { postgresFixture, testTarget } = await import(root + 'test-support/postgresql.js')
const { initializeDatabase } = await import(root + 'scripts/init-db.js')
const { initializeSessions } = await import(root + 'sessions/schema.js')
const { initializeAbuse } = await import(root + 'sessions/abuse-schema.js')
const cleanup = []
const t = { after: fn => cleanup.push(fn) }
try {
  const source = await postgresFixture(t)
  const target = await postgresFixture(t)
  const db = source.database
  for (let n = 0; n < 2; n++) {
    await initializeDatabase(db); await initializeSessions(db); await initializeAbuse(db)
  }
  const user = (await db.query("INSERT INTO users(email,username,password) VALUES ('restore@example.invalid','restore-fixture','fictional-hash') RETURNING id")).rows[0]
  await db.query('INSERT INTO cart_items(user_id,product_id,quantity) VALUES ($1,1,2)', [user.id])
  await db.query("INSERT INTO user_sessions VALUES ('fictional-revoked-after-backup', '{}', CURRENT_TIMESTAMP + interval '1 hour')")
  await db.query("INSERT INTO auth_abuse_counters VALUES ($1,3,CURRENT_TIMESTAMP + interval '1 hour')", ['a'.repeat(64)])
  const cfg = testTarget()
  const env = { PATH: process.env.PATH, PGHOST: cfg.host, PGPORT: String(cfg.port), PGDATABASE: cfg.database, PGUSER: cfg.user, PGPASSWORD: cfg.password, PGSSLMODE: 'disable' }
  const dump = join(source.directory, 'fictional-backup.sql')
  const bins = process.env.PG_TEST_BIN + '/'
  execFileSync(bins + 'pg_dump', ['--no-owner','--no-privileges','--schema',source.schema,'--file',dump], { env, stdio: 'pipe' })
  // Controlled local schema remapping only; never an Azure/production restore procedure.
  let sql = (await readFile(dump,'utf8')).replaceAll(source.schema, target.schema)
  sql = sql.replace(`CREATE SCHEMA ${target.schema};`, '')
  const restored = join(target.directory, 'fictional-restore.sql')
  await writeFile(restored,sql,{ mode:0o600 })
  execFileSync(bins + 'psql', ['-X','--set','ON_ERROR_STOP=1','--single-transaction','--file',restored], { env, stdio:'pipe' })
  for (const table of ['products','users','cart_items','user_sessions','auth_abuse_counters']) {
    assert.deepEqual((await target.database.query(`SELECT * FROM ${table}`)).rows,(await db.query(`SELECT * FROM ${table}`)).rows)
  }
  await target.database.query('DELETE FROM user_sessions')
  assert.equal((await target.database.query('SELECT count(*)::int AS count FROM user_sessions')).rows[0].count,0)
  assert.equal((await target.database.query('SELECT count(*)::int AS count FROM users')).rows[0].count,1)
  await initializeDatabase(target.database); await initializeSessions(target.database); await initializeAbuse(target.database)
  assert.equal((await target.database.query('SELECT count(*)::int AS count FROM cart_items')).rows[0].count,1)
  console.log('PASS: repeatable bootstrap; five-table PostgreSQL 17 logical dump/restore; restored sessions revoked; users/cart retained. Fictional local schemas only; Azure PITR and runtime-role grants NOT verified.')
} finally { for (const fn of cleanup.reverse()) await fn() }
