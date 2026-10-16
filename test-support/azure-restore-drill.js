import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { writeFile, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { postgresFixture, testTarget } from './postgresql.js'
import { initializeDatabase } from '../scripts/init-db.js'
import { initializeSessions } from '../sessions/schema.js'
import { initializeAbuse } from '../sessions/abuse-schema.js'

async function bootstrap(db) {
  await initializeDatabase(db)
  await initializeSessions(db)
  await initializeAbuse(db)
}

function tools(config) {
  const container = process.env.PG_TEST_CONTAINER_ID
  if (container && !/^[a-f0-9]{12,64}$/.test(container)) throw new Error('Invalid disposable PostgreSQL container')
  if (!container && !process.env.PG_TEST_BIN) throw new Error('Explicit disposable PostgreSQL tools are required')
  const env = { PATH: '/usr/bin:/bin', PGHOST: config.host, PGPORT: String(config.port), PGDATABASE: config.database,
    PGUSER: config.user, PGPASSWORD: config.password, PGSSLMODE: 'disable' }
  return (tool, args, input) => {
    if (container) {
      // Reuse only the disposable CI PostgreSQL service's version-matched client.
      // Docker imports these variables from its environment; no password is an argument.
      const names = ['PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD', 'PGSSLMODE']
      const docker = process.platform === 'linux' ? '/usr/bin/docker' : '/opt/homebrew/bin/docker'
      return execFileSync(docker, ['exec', '-i', ...names.flatMap(name => ['--env', name]), container, tool, ...args],
        { env: { ...env, PGHOST: '127.0.0.1', PGPORT: '5432' }, input, stdio: ['pipe', 'pipe', 'pipe'] })
    }
    return execFileSync(join(process.env.PG_TEST_BIN, tool), args, { env, input, stdio: ['pipe', 'pipe', 'pipe'] })
  }
}

export async function runRestoreDrill() {
  const cleanup = []
  const t = { after: fn => cleanup.push(fn) }
  try {
    const source = await postgresFixture(t)
    const target = await postgresFixture(t)
    const db = source.database
    await bootstrap(db)
    await bootstrap(db)
    const user = (await db.query("INSERT INTO users(email,username,password) VALUES ('restore@example.invalid','restore-fixture','fictional-hash') RETURNING id")).rows[0]
    await db.query('INSERT INTO cart_items(user_id,product_id,quantity) VALUES ($1,1,2)', [user.id])
    await db.query("INSERT INTO user_sessions VALUES ('fictional-revoked-after-backup', '{}', CURRENT_TIMESTAMP + interval '1 hour')")
    await db.query("INSERT INTO auth_abuse_counters VALUES ($1,3,CURRENT_TIMESTAMP + interval '1 hour')", ['a'.repeat(64)])
    const execute = tools(testTarget())
    const dump = join(source.directory, 'fictional-backup.sql')
    await writeFile(dump, execute('pg_dump', ['--no-owner', '--no-privileges', '--schema', source.schema]), { mode: 0o600 })
    // Controlled local schema remapping only; never an Azure/production restore procedure.
    const sql = (await readFile(dump, 'utf8')).replaceAll(source.schema, target.schema).replace(`CREATE SCHEMA ${target.schema};`, '')
    execute('psql', ['-X', '--set', 'ON_ERROR_STOP=1', '--single-transaction'], sql)
    await Promise.all(['products', 'users', 'cart_items', 'user_sessions', 'auth_abuse_counters'].map(async table => {
      const [restored, original] = await Promise.all([target.database.query(`SELECT * FROM ${table} ORDER BY 1`), db.query(`SELECT * FROM ${table} ORDER BY 1`)])
      assert.deepEqual(restored.rows, original.rows)
    }))
    await target.database.query('DELETE FROM user_sessions')
    assert.equal((await target.database.query('SELECT count(*)::int AS count FROM user_sessions')).rows[0].count, 0)
    assert.equal((await target.database.query('SELECT count(*)::int AS count FROM users')).rows[0].count, 1)
    await bootstrap(target.database)
    assert.equal((await target.database.query('SELECT count(*)::int AS count FROM cart_items')).rows[0].count, 1)
  } finally {
    // Independent fixture cleanups each verify their own schema identity.
    await Promise.all(cleanup.map(fn => fn()))
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) throw new Error('Arguments are not accepted')
  await runRestoreDrill()
  console.log('PASS: fictional local logical restore, repeatable bootstrap and restored-session revocation; Azure PITR and runtime-role grants NOT verified.')
}
