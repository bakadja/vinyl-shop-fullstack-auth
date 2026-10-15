// Only configures the disposable GitHub Actions PostgreSQL service, never an app target.
import { testTarget, verifyTestServer } from '../test-support/postgresql.js'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, appendFile } from 'node:fs/promises'
import { createTestCertificates } from '../test-support/certificates.js'
import { installContainerCertificates } from '../test-support/ci-certificates.js'
import pg from 'pg'
const run = promisify(execFile)

async function verifyService(container, target) {
  const image = await run('docker', ['inspect', '--format', '{{.Config.Image}}', container])
  const ports = await run('docker', ['inspect', '--format', '{{json .HostConfig.PortBindings}}', container])
  const binding = JSON.parse(ports.stdout)['5432/tcp']
  if (image.stdout.trim() !== 'postgres:17' || binding?.length !== 1 || binding[0].HostIp !== '127.0.0.1' || binding[0].HostPort !== '5432') throw new Error('Not the disposable PostgreSQL service')
  const guard = new pg.Client(target)
  try { await guard.connect(); await verifyTestServer(guard) } finally { await guard.end() }
}
async function configurePostgres(directory) {
  const admin = new pg.Client({ host: '127.0.0.1', port: 5432, user: 'postgres', database: 'postgres', password: process.env.PGPASSWORD })
  try {
    await admin.connect()
    await admin.query(`ALTER SYSTEM SET ssl_cert_file=${admin.escapeLiteral(directory + '/server.pem')}`)
    await admin.query(`ALTER SYSTEM SET ssl_key_file=${admin.escapeLiteral(directory + '/server.key')}`)
    await admin.query('ALTER SYSTEM SET ssl=on')
    await admin.query('SELECT pg_reload_conf()')
  } finally { await admin.end() }
}
async function verifyTlsAttempt(target, ca) {
  const client = new pg.Client({ ...target, ssl: { rejectUnauthorized: true, ca } })
  try { await client.connect(); await client.query('SELECT 1'); return true } catch { return false } finally { await client.end() }
}
async function waitForVerifiedTls(target, ca, attempts = 30) {
  if (await verifyTlsAttempt(target, ca)) return
  if (attempts <= 1) throw new Error('Disposable PostgreSQL verified TLS unavailable')
  await new Promise(resolve => setTimeout(resolve, 200))
  return waitForVerifiedTls(target, ca, attempts - 1)
}
async function configureDisposableTls() {
  const container = process.env.POSTGRES_SERVICE_ID
  if (process.env.GITHUB_ACTIONS !== 'true' || !/^[a-f0-9]{12,64}$/.test(container ?? '') || !process.env.GITHUB_ENV || !process.env.TEST_DATABASE_URL) throw new Error('Disposable CI service configuration required')
  const target = testTarget({ TEST_DATABASE_URL: process.env.TEST_DATABASE_URL })
  if (target.host !== '127.0.0.1' || target.port !== 5432) throw new Error('Unexpected disposable service port')
  await verifyService(container, target)
  const certificates = await createTestCertificates()
  try {
    const directory = await installContainerCertificates(container, certificates)
    await configurePostgres(directory)
    await waitForVerifiedTls(target, await readFile(certificates.caFile, 'utf8'))
    // The CA must remain available to the subsequent test step on this ephemeral runner.
    await appendFile(process.env.GITHUB_ENV, `TEST_DATABASE_CA_FILE=${certificates.caFile}\n`)
  } catch {
    await certificates.cleanup()
    throw new Error('Disposable service TLS configuration failed')
  }
}
try { await configureDisposableTls() } catch {
  console.error('Disposable PostgreSQL TLS setup failed; no credentials or private keys are logged.')
  process.exitCode = 1
}
