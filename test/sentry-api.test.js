import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { fixture, account, register } from '../test-support/http.js'

test('real backend preserves auth and API errors while reporting caught and propagated DB failures once', async t => {
  const envelopes = []
  const receiver = createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    envelopes.push(body)
    res.end('{}')
  }).listen(0, '127.0.0.1')
  await once(receiver, 'listening')
  t.after(() => { receiver.closeAllConnections(); receiver.close() })
  const { client, baseUrl, database, shutdown } = await fixture(t, { sentryEnv: {
    SENTRY_DSN: `http://local@127.0.0.1:${receiver.address().port}/1`, SENTRY_ENVIRONMENT: 'test', SENTRY_RELEASE: 'c'.repeat(40)
  } })
  const request = client()
  await register(request, account('sentry-fictional'))
  assert.equal((await request('/api/auth/me')).body.isLoggedIn, true)
  assert.equal((await request('/api/auth/login', { method: 'POST', body: {} })).status, 400)
  assert.equal((await client()('/api/auth/login', { method: 'POST', body: { username: 'absent', password: 'fictional' } })).status, 401)
  assert.equal((await fetch(`${baseUrl}/debug-sentry`)).status, 404)
  await database.query('DROP TABLE products CASCADE')
  const products = await request('/api/products?search=fictional-private-value@example.invalid')
  assert.equal(products.status, 500)
  assert.deepEqual(products.body, { error: 'Internal server error' })
  await database.query('DROP TABLE users CASCADE')
  const login = await request('/api/auth/login', { method: 'POST', body: { username: 'absent', password: 'fictional' } })
  assert.equal(login.status, 500)
  assert.deepEqual(login.body, { error: 'Login failed. Please try again.' })
  assert.equal((await request('/health/live')).status, 200)
  await shutdown()
  assert.equal(envelopes.length, 2)
  assert.doesNotMatch(envelopes.join(''), /fictional|password|SELECT|postgresql:|cookie|stacktrace/)
})

test('unavailable ingestion leaves real login, sessions, logout and health usable', async t => {
  const { client, database } = await fixture(t, { sentryEnv: {
    SENTRY_DSN: 'http://local@127.0.0.1:1/1', SENTRY_ENVIRONMENT: 'test', SENTRY_RELEASE: 'c'.repeat(40)
  } })
  const request = client()
  const user = await register(request, account('outage-fictional'))
  await database.query('DROP TABLE products CASCADE')
  assert.equal((await request('/api/products')).status, 500)
  assert.equal((await request('/api/auth/me')).body.isLoggedIn, true)
  assert.equal((await request('/api/auth/login', { method: 'POST', body: user })).status, 200)
  assert.equal((await request('/api/auth/logout', { method: 'POST', body: {} })).status, 200)
  assert.equal((await request('/api/auth/me')).body.isLoggedIn, false)
  assert.equal((await request('/health/live')).status, 200)
})
