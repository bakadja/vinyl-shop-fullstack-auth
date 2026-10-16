import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loginUser } from '../controllers/authController.js'
import { getCurrentUser } from '../controllers/meController.js'
import { closeDatabase } from '../db/db.js'

for (const [name, handler, status, message, headers, diagnostic] of [
  ['login', loginUser, 503, 'Authentication temporarily unavailable. Please try again later.', { 'Retry-After': '5', 'Cache-Control': 'no-store' }, 'Login failed (stage=postgres_user_lookup, class=postgres_connection_refused)'],
  ['current user', getCurrentUser, 500, 'Internal server error', {}, 'Current user database connection refused']
]) {
  test(`${name} handles connection refusal explicitly without exposing database details`, async t => {
    const previous = { DATABASE_URL: process.env.DATABASE_URL, PGSSLMODE: process.env.PGSSLMODE }
    process.env.DATABASE_URL = 'postgresql://vinyl_shop_test:synthetic-sensitive-value@127.0.0.1:1/vinyl_shop_test'
    process.env.PGSSLMODE = 'disable'
    t.after(async () => {
      await closeDatabase()
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    })
    const logs = []
    t.mock.method(console, 'error', (...args) => logs.push(args))
    const response = {
      code: 200, body: undefined, headers: {},
      status(code) { this.code = code; return this },
      set(values) { Object.assign(this.headers, values); return this },
      json(body) { this.body = body; return this }
    }
    await handler({ body: { username: 'synthetic', password: 'synthetic' }, session: { userId: 1 } }, response)
    assert.equal(response.code, status)
    assert.deepEqual(response.body, { error: message })
    assert.deepEqual(response.headers, headers)
    assert.deepEqual(logs, [[diagnostic]])
    assert.doesNotMatch(JSON.stringify([response.body, logs]), /synthetic-sensitive-value|postgresql:|ECONNREFUSED|stack/)
  })
}
