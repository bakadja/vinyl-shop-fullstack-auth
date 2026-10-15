import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { initializeDatabase } from '../scripts/init-db.js'
import { initializeSessions } from '../sessions/schema.js'
import { postgresFixture } from '../test-support/postgresql.js'
import { startSessionProcess } from '../test-support/session-process.js'
import { account } from '../test-support/http.js'

test('public assets bypass broken session storage and suppress Express disclosure', { timeout: 20000 }, async t => {
  // The generic API fixture runs outside the repository; static files need
  // the real project working directory while retaining disposable DB isolation.
  const hooks = []
  t.after(async () => { for (const hook of hooks.reverse()) await hook() })
  const { database, childEnv } = await postgresFixture(t)
  await initializeDatabase(database)
  await initializeSessions(database)
  const harness = { after: hook => hooks.push(hook) }
  const { baseUrl } = await startSessionProcess(harness, {
    childEnv,
    cwd: fileURLToPath(new URL('../', import.meta.url))
  })

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

  // An authenticated cookie must never trigger a session lookup for public assets.
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
