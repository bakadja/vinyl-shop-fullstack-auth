import assert from 'node:assert/strict'
import { test } from 'node:test'
import express from 'express'
import { once } from 'node:events'
import { fixture, register } from '../test-support/http.js'
import http from 'node:http'
import { healthRouter } from '../routes/health.js'
import { postgresFixture } from '../test-support/postgresql.js'
import { initializeDatabase } from '../scripts/init-db.js'
import { initializeSessions } from '../sessions/schema.js'
import { startSessionProcess } from '../test-support/session-process.js'

test('health routes are wired before session reads and return no-store without cookies', async t => {
  const f = await fixture(t)
  const request = f.client()
  await register(request)
  await f.database.query('ALTER TABLE user_sessions RENAME TO unavailable_sessions')
  for (const path of ['/health/live', '/health/ready']) {
    const r = await request(path)
    assert.equal(r.status, 200)
    assert.equal(r.cookie, null)
    assert.deepEqual(r.body, { status: 'ok' })
  }
  assert.equal((await f.database.query('SELECT count(*) FROM unavailable_sessions')).rows[0].count, '1')
})

test('readiness bounds the DB query and sanitizes failures while liveness stays independent', async t => {
  const queries = []
  const database = { query(options) { queries.push(options); throw new Error('synthetic-private-database-detail') } }
  const app = express().use(healthRouter(database))
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => new Promise(resolve => server.close(resolve)))
  const base = `http://127.0.0.1:${server.address().port}`
  const live = await fetch(base + '/health/live')
  assert.equal(live.status, 200)
  assert.equal(queries.length, 0)
  const ready = await fetch(base + '/health/ready')
  assert.equal(ready.status, 503)
  assert.equal(ready.headers.get('cache-control'), 'no-store')
  assert.equal(ready.headers.get('set-cookie'), null)
  assert.deepEqual(await ready.json(), { status: 'unavailable' })
  assert.deepEqual(queries, [{ text: 'SELECT 1', query_timeout: 1000 }])
})

test('production health never bypasses trusted-peer HTTPS enforcement', async t => {
  const hooks = []; t.after(async () => { for (const hook of hooks) await hook() })
  const f = await postgresFixture(t)
  await initializeDatabase(f.database); await initializeSessions(f.database)
  const overrides = { NODE_ENV: 'production', PGSSLMODE: 'verify-full', PGSSLROOTCERT: process.env.TEST_DATABASE_CA_FILE,
    SESSION_PROXY_MODE: 'verified-proxy', TRUSTED_PROXY_CIDRS: '127.0.0.1/32', PUBLIC_ORIGIN: 'https://shop.example' }
  const child = await startSessionProcess({ after: fn => hooks.push(fn) }, { childEnv: f.childEnv, cwd: f.directory, overrides })
  for (const path of ['/health/live', '/health/ready']) {
    for (const proto of [undefined, 'http', 'https,http']) {
      const r = await child.request(path, { headers: proto ? { 'X-Forwarded-Proto': proto } : {} })
      assert.equal(r.status, 400); assert.equal(r.setCookies.length, 0)
    }
    const duplicateStatus = await new Promise((resolve, reject) => {
      const req = http.request(child.baseUrl + path, { headers: ['X-Forwarded-Proto', 'https', 'x-forwarded-proto', 'https'] }, res => {
        res.resume(); res.on('end', () => resolve(res.statusCode))
      })
      req.on('error', reject); req.end()
    })
    assert.equal(duplicateStatus, 400)
    const r = await child.request(path, { headers: { 'X-Forwarded-Proto': 'https' } })
    assert.equal(r.status, 200); assert.equal(r.headers.get('cache-control'), 'no-store'); assert.equal(r.setCookies.length, 0)
  }
  const untrusted = await startSessionProcess({ after: fn => hooks.push(fn) }, { childEnv: f.childEnv, cwd: f.directory,
    overrides: { ...overrides, TRUSTED_PROXY_CIDRS: '::1/128' } })
  assert.equal((await untrusted.request('/health/ready', { headers: { 'X-Forwarded-Proto': 'https' } })).status, 400)
})
