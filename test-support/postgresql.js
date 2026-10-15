import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDatabase } from '../db/db.js'

export function testTarget(env = process.env) {
  let url
  try { url = new URL(env.TEST_DATABASE_URL) } catch { throw new Error('Explicit disposable test configuration TEST_DATABASE_URL is required') }
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['127.0.0.1', '::1'].includes(host) || !url.port ||
      url.pathname !== '/vinyl_shop_test' || url.username !== 'vinyl_shop_test' || !url.password || url.search || url.hash) {
    throw new Error('Unsafe test database target')
  }
  if (env.DATABASE_URL) {
    let app
    try { app = new URL(env.DATABASE_URL) } catch { throw new Error('Cannot verify application/test database separation') }
    if (['127.0.0.1', '[::1]', 'localhost'].includes(app.hostname) && Number(app.port || '5432') === Number(url.port) && decodeURIComponent(app.pathname.slice(1)) === 'vinyl_shop_test') throw new Error('Test database matches application target')
  }
  if (['localhost', '127.0.0.1', '::1'].includes(env.PGHOST) && Number(env.PGPORT ?? '5432') === Number(url.port) && env.PGDATABASE === 'vinyl_shop_test') throw new Error('Test database matches application target')
  let password
  try { password = decodeURIComponent(url.password) } catch { throw new Error('Invalid test credentials') }
  return { host, port: Number(url.port), database: 'vinyl_shop_test', user: 'vinyl_shop_test', password,
    ssl: false, max: 5, connectionTimeoutMillis: 5000, idleTimeoutMillis: 1000,
    options: '-c search_path=vinyl_test_control', application_name: 'vinyl-test-guard' }
}

export async function verifyTestServer(db) {
  const { rows } = await db.query(`SELECT current_database() AS database, current_user AS username,
    r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls AS privileged,
    EXISTS (SELECT 1 FROM pg_auth_members WHERE member = r.oid) AS memberships,
    d.datdba = r.oid AS database_owner,
    has_schema_privilege(current_user, 'public', 'CREATE') AS public_create,
    has_schema_privilege(current_user, 'vinyl_test_control', 'CREATE') AS control_create,
    c.relowner = d.datdba AS admin_marker,
    m.kind
    FROM pg_roles r JOIN pg_database d ON d.datname = current_database()
    JOIN pg_namespace n ON n.nspname = 'vinyl_test_control'
    JOIN pg_class c ON c.relnamespace = n.oid AND c.relname = 'marker'
    CROSS JOIN vinyl_test_control.marker m WHERE r.rolname = current_user`)
  const row = rows[0]
  if (rows.length !== 1 || row.database !== 'vinyl_shop_test' || row.username !== 'vinyl_shop_test' ||
      row.privileged || row.memberships || row.database_owner || row.public_create || row.control_create ||
      !row.admin_marker || row.kind !== 'vinyl-shop-disposable-v1') throw new Error('Unverified disposable test database')
}

export async function postgresFixture(t, env = process.env) {
  const config = testTarget(env)
  const guard = createDatabase(config)
  const schema = `vinyl_test_${randomUUID().replaceAll('-', '')}`
  let identity
  let database
  let directory
  let cleaned = false
  t.after(async () => {
    if (cleaned) return
    cleaned = true
    try {
      if (database) await database.close()
      if (identity) {
        await verifyTestServer(guard)
        await guard.query('SELECT vinyl_test_control.drop_test_schema($1, $2, $3)', [schema, identity.oid, identity.nspowner])
      }
    } finally {
      await guard.close()
      if (directory) await rm(directory, { recursive: true, force: true })
    }
  })
  await verifyTestServer(guard)
  identity = await guard.transaction(async client => {
    await client.query(`CREATE SCHEMA "${schema}"`)
    const registered = (await client.query('SELECT oid, nspowner FROM pg_namespace WHERE nspname = $1', [schema])).rows[0]
    if (!registered) throw new Error('Unable to register test schema identity')
    return registered
  })
  database = createDatabase({ ...config, options: `-c search_path=${schema}`, application_name: `vinyl-test-${schema}` })
  directory = await mkdtemp(join(tmpdir(), 'vinyl-postgres-test-'))
  return { database, schema, directory, childEnv: {
    AUTH_ABUSE_HMAC_KEY: randomBytes(32).toString('hex'), DATABASE_URL: env.TEST_DATABASE_URL, DATABASE_SCHEMA: schema, PGSSLMODE: 'disable', NODE_ENV: 'test'
  } }
}
