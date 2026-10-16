import assert from 'node:assert/strict'
import { test } from 'node:test'
import { authenticationAbuse } from '../sessions/abuse.js'
import { authenticationFailureClass, loginFailureResponse } from '../sessions/failure-class.js'

test('authentication failure diagnostics classify only allowlisted causes', () => {
  const timeout = Object.assign(new Error('sensitive pool detail'), { code: '53300' })
  const wrapped = new Error('Authentication session failed', { cause: timeout })
  assert.equal(authenticationFailureClass(wrapped), 'postgres_connection_limit')
  assert.equal(authenticationFailureClass(new Error('unexpected private detail')), 'unexpected')
})

test('known transient PostgreSQL login failures return a generic retryable response', () => {
  const timeout = Object.assign(new Error('sensitive pool detail'), { message: 'timeout exceeded when trying to connect' })
  const response = loginFailureResponse(new Error('Authentication session failed', { cause: timeout }))
  assert.deepEqual(response, {
    status: 503,
    headers: { 'Retry-After': '5', 'Cache-Control': 'no-store' },
    body: { error: 'Authentication temporarily unavailable. Please try again later.' }
  })
  assert.ok(!JSON.stringify(response).includes('sensitive'))
})

test('unknown login failures remain generic server errors without leaking details', () => {
  const response = loginFailureResponse(new Error('private implementation detail'))
  assert.deepEqual(response, {
    status: 500,
    headers: { 'Cache-Control': 'no-store' },
    body: { error: 'Login failed. Please try again.' }
  })
  assert.ok(!JSON.stringify(response).includes('private implementation detail'))
})

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
