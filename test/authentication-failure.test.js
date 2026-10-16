import assert from 'node:assert/strict'
import { test } from 'node:test'
import { authenticationAbuse } from '../sessions/abuse.js'

test('authentication admission logs a safe class for PostgreSQL lock timeouts', async () => {
  const failure = Object.assign(new Error('sensitive database diagnostic'), { code: '55P03' })
  const middleware = authenticationAbuse({ transaction: async () => { throw failure } }, Buffer.alloc(32, 7))
  const logs = []
  const originalError = console.error
  console.error = (...values) => logs.push(values.join(' '))
  const response = {
    status(code) { this.statusCode = code; return this },
    set() { return this },
    json(body) { this.body = body; return this }
  }

  try {
    await middleware({ method: 'POST', path: '/login', socket: { remoteAddress: '192.0.2.1' }, rawHeaders: [], body: { username: 'fictional-user' } }, response, () => assert.fail('Admission failure must fail closed'))
  } finally {
    console.error = originalError
  }

  assert.equal(response.statusCode, 503)
  assert.deepEqual(logs, ['Authentication admission failed (class=postgres_lock_timeout)'])
  assert.ok(!logs.join(' ').includes('sensitive database diagnostic'))
})
