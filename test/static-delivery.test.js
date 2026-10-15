import assert from 'node:assert/strict'
import { test } from 'node:test'
import { account, fixture } from '../test-support/http.js'

test('public assets bypass broken session storage and suppress Express disclosure', { timeout: 20000 }, async t => {
  const { baseUrl, database } = await fixture(t)
  const registration = await fetch(baseUrl + '/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(account('static-assets'))
  })
  assert.equal(registration.status, 201)
  assert.equal(registration.headers.get('x-powered-by'), null)
  const cookie = registration.headers.get('set-cookie')?.split(';')[0]
  assert.ok(cookie)

  const options = { headers: { Cookie: cookie }, signal: AbortSignal.timeout(5000) }
  const asset = await fetch(baseUrl + '/css/index.css', options)
  assert.equal(asset.status, 200)
  assert.equal(asset.headers.get('x-powered-by'), null)
  assert.equal(asset.headers.get('set-cookie'), null)
  assert.match(await asset.text(), /--color-accent:/)

  // The authenticated session cookie must not trigger a PostgreSQL lookup for assets.
  await database.query('DROP TABLE user_sessions')
  const withoutSessions = await fetch(baseUrl + '/css/index.css', options)
  assert.equal(withoutSessions.status, 200)
  assert.equal(withoutSessions.headers.get('x-powered-by'), null)
  assert.equal(withoutSessions.headers.get('set-cookie'), null)
  assert.match(await withoutSessions.text(), /--color-accent:/)

  const home = await fetch(baseUrl + '/', options)
  assert.equal(home.status, 200)
  assert.match(await home.text(), /<div id="cart-banner" class="cart-banner-link"><\/div>/)
})
