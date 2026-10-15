import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:https'
import { readFile } from 'node:fs/promises'
import { once } from 'node:events'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createTestCertificates } from '../test-support/certificates.js'
const run = promisify(execFile)
const script = new URL('../scripts/azure/smoke.js', import.meta.url).pathname

test('delivery smoke requires verified HTTPS, healthy JSON and no session cookie', async t => {
  const certs = await createTestCertificates(); t.after(certs.cleanup)
  let mode = 'healthy'
  const server = createServer({ key: await readFile(certs.serverKeyFile), cert: await readFile(certs.serverCertFile) }, (_req, res) => {
    if (mode === 'cookie') res.setHeader('Set-Cookie', 'synthetic-session=invalid')
    if (mode === 'unhealthy') res.statusCode = 503
    if (mode === 'redirect') { res.writeHead(302, { Location: '/health/ready' }); return res.end() }
    res.end(mode === 'invalid-json' ? 'invalid' : JSON.stringify({ status: 'ok' }))
  }).listen(0, '127.0.0.1')
  await once(server, 'listening'); t.after(() => new Promise(resolve => server.close(resolve)))
  const env = { HEALTH_URL: `https://127.0.0.1:${server.address().port}/health/ready`, NODE_EXTRA_CA_CERTS: certs.caFile }
  const success = await run(process.execPath, [script], { env, timeout: 15000 })
  assert.match(success.stdout, /Public HTTPS readiness passed/); assert.equal(success.stderr, '')
  for (mode of ['cookie', 'unhealthy', 'redirect', 'invalid-json']) {
    await assert.rejects(run(process.execPath, [script], { env, timeout: 15000 }), error => error.code === 1 && error.stderr.trim() === 'Public HTTPS readiness failed; follow the approved rollback runbook')
  }
  await assert.rejects(run(process.execPath, [script], { env: { HEALTH_URL: env.HEALTH_URL }, timeout: 15000 }), error => error.code === 1)
  for (const url of ['http://shop.example/health/ready', 'https://user:synthetic@shop.example/health/ready', 'https://shop.example/health/ready?token=synthetic', 'https://shop.example/other']) {
    await assert.rejects(run(process.execPath, [script], { env: { HEALTH_URL: url }, timeout: 15000 }), error => error.code === 1 && !error.stderr.includes('synthetic'))
  }
})
