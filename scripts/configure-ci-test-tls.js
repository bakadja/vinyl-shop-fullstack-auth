import { testTarget } from '../test-support/postgresql.js'
// Only configures the disposable GitHub Actions PostgreSQL service, never an app target.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { createTestCertificates } from '../test-support/tls.js'
import pg from 'pg'
const run = promisify(execFile)
if (process.env.GITHUB_ACTIONS !== 'true' || !/^[a-f0-9]{12,64}$/.test(process.env.POSTGRES_SERVICE_ID ?? '') || !process.env.RUNNER_TEMP || !process.env.TEST_DATABASE_URL) throw new Error('Disposable CI service configuration required')
const target = testTarget({ TEST_DATABASE_URL: process.env.TEST_DATABASE_URL })
const directory = await mkdtemp(join(process.env.RUNNER_TEMP, 'vinyl-tls-'))
const certificates = await createTestCertificates(directory)
const container = process.env.POSTGRES_SERVICE_ID
for (const [source, target] of [[certificates.serverCertFile, 'server.pem'], [certificates.serverKeyFile, 'server.key']]) await run('docker', ['cp', source, `${container}:/tmp/vinyl-${target}`])
await run('docker', ['exec', '-u', '0', container, 'chown', 'postgres:postgres', '/tmp/vinyl-server.pem', '/tmp/vinyl-server.key'])
await run('docker', ['exec', '-u', '0', container, 'chmod', '600', '/tmp/vinyl-server.key'])
const admin = new pg.Client({ host: '127.0.0.1', port: 5432, user: 'postgres', database: 'postgres', password: process.env.PGPASSWORD })
try {
  await admin.connect()
  for (const statement of ["ALTER SYSTEM SET ssl_cert_file='/tmp/vinyl-server.pem'", "ALTER SYSTEM SET ssl_key_file='/tmp/vinyl-server.key'", "ALTER SYSTEM SET ssl=on", 'SELECT pg_reload_conf()']) await admin.query(statement)
} finally { await admin.end() }
const { readFile, appendFile } = await import('node:fs/promises')
let verified = false
for (let attempt = 0; attempt < 30 && !verified; attempt++) {
  const client = new pg.Client({ ...target, ssl: { rejectUnauthorized: true, ca: await readFile(certificates.caFile, 'utf8') } })
  try { await client.connect(); await client.query('SELECT 1'); verified = true } catch { await new Promise(resolve => setTimeout(resolve, 200)) } finally { await client.end() }
}
if (!verified) throw new Error('Disposable PostgreSQL verified TLS unavailable')
await appendFile(process.env.GITHUB_ENV, `TEST_DATABASE_CA_FILE=${certificates.caFile}\n`)
