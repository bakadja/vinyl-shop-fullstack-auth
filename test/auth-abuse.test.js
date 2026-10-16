import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fixture, account, register } from '../test-support/http.js'

test('login budget counts concurrent failures, refuses without a session, and expires', async t => {
  const { client, database } = await fixture(t)
  const user = await register(client())
  const responses = await Promise.all(Array.from({ length: 12 }, () => client()('/api/auth/login', {
    method: 'POST', body: { username: user.username, password: 'incorrect' }
  })))
  assert.equal(responses.filter(r => r.status === 401).length, 10)
  assert.equal(responses.filter(r => r.status === 429).length, 2)
  assert.ok(responses.every(r => r.cookie === null))
  assert.equal((await database.query('SELECT count(*) FROM user_sessions')).rows[0].count, '1')
  await database.query("UPDATE auth_abuse_counters SET expires_at=clock_timestamp()-interval '1 second'")
  const response = await client()('/api/auth/login', { method: 'POST', body: user })
  assert.equal(response.status, 200)
})

test('registration limits abuse and rejects bcrypt truncation before creating users', async t => {
  const { client, database } = await fixture(t)
  const response = await client()('/api/auth/register', { method: 'POST', body: { ...account(), password: 'é'.repeat(37) } })
  assert.equal(response.status, 400)
  assert.equal((await database.query('SELECT count(*) FROM users')).rows[0].count, '0')
  for (let index = 0; index < 3; index++) assert.equal((await client()('/api/auth/register', { method: 'POST', body: {} })).status, 400)
  assert.equal((await client()('/api/auth/register', { method: 'POST', body: {} })).status, 429)
})

import { randomBytes } from 'node:crypto'
import * as abuse from '../sessions/abuse.js'
import { abuseKey, peerIdentity, counterKeys, consumeAttempt, authenticationAbuse } from '../sessions/abuse.js'
import { initializeAbuse, validateAbuseSchema } from '../sessions/abuse-schema.js'
import { startSessionProcess } from '../test-support/session-process.js'
import { postgresFixture } from '../test-support/postgresql.js'
import { createDatabase } from '../db/db.js'

test('HMAC domains preserve case and trim semantics without personal identifiers; peer canonicalization ignores IPv6 host rotation', () => {
  const key = randomBytes(32)
  const keys = name => counterKeys(key, 'login', '127.0.0.1', name)
  assert.deepEqual(keys(' User '), keys('User'))
  assert.notDeepEqual(keys('user'), keys('User'))
  assert.notDeepEqual(keys('User'), counterKeys(key, 'register', '127.0.0.1', 'User'))
  assert.notDeepEqual(keys('User'), counterKeys(randomBytes(32), 'login', '127.0.0.1', 'User'))
  for (const c of keys('User')) assert.match(c.key, /^[a-f0-9]{64}$/)
  for (const value of [undefined, '', 'a'.repeat(64), 'wrong']) assert.throws(() => abuseKey({ AUTH_ABUSE_HMAC_KEY: value }), /Invalid abuse configuration/)
  assert.equal(abuseKey({ AUTH_ABUSE_HMAC_KEY: key.toString('hex') }).length, 32)
  assert.equal(peerIdentity('127.0.0.1'), peerIdentity('::ffff:127.0.0.1'))
  assert.equal(peerIdentity('2001:db8::1234'), peerIdentity('2001:0db8:0:0::ffff'))
  assert.equal(peerIdentity('::1'), '0000:0000:0000:0000::/64')
  assert.equal(peerIdentity('invalid'), 'unknown-peer')
  assert.equal(peerIdentity(undefined), 'unknown-peer')
  assert.deepEqual(keys({}), keys('x'.repeat(1025)))
})

test('abuse identity trusts one valid forwarded IP only from the configured immediate proxy', () => {
  assert.equal(typeof abuse.requestPeerIdentity, 'function')
  const { requestPeerIdentity } = abuse
  const trustedLoopback = address => address === '127.0.0.1'
  assert.equal(requestPeerIdentity('127.0.0.1', ['X-Forwarded-For', '198.51.100.23'], trustedLoopback), '198.51.100.23')
  assert.equal(requestPeerIdentity('127.0.0.1', ['x-forwarded-for', '2001:db8:abcd:12::9'], trustedLoopback), '2001:0db8:abcd:0012::/64')
  assert.equal(requestPeerIdentity('198.51.100.9', ['X-Forwarded-For', '203.0.113.7'], trustedLoopback), '198.51.100.9')
  assert.equal(requestPeerIdentity('127.0.0.1', ['X-Forwarded-For', '203.0.113.7'], () => false), '127.0.0.1')
  for (const headers of [
    [],
    ['X-Forwarded-For', '198.51.100.23', 'x-forwarded-for', '198.51.100.24'],
    ['X-Forwarded-For', '198.51.100.23, 198.51.100.24'],
    ['X-Forwarded-For', '198.51.100.23:8000'],
    ['X-Forwarded-For', ' 198.51.100.23']
  ]) assert.throws(() => requestPeerIdentity('127.0.0.1', headers, trustedLoopback), /Invalid trusted proxy identity/)
})

test('authentication middleware keys trusted proxy requests by the validated client and rejects ambiguous identity before admission', async () => {
  const key = randomBytes(32)
  const inserted = []
  const database = { transaction: async operation => operation({ query: async (sql, values = []) => {
    if (sql.includes('SELECT clock_timestamp() AS now')) return { rows: [{ now: new Date() }] }
    if (sql.includes('count(*) FILTER')) return { rows: [{ total: '0', existing: '0' }] }
    if (sql.startsWith('INSERT INTO auth_abuse_counters')) {
      inserted.push(values[0])
      return { rows: [{ attempts: 1, expires_at: values[1] }] }
    }
    return { rows: [] }
  } }) }
  const middleware = authenticationAbuse(database, key, address => address === '127.0.0.1')
  let next = 0
  const response = { status(code) { this.code = code; return this }, set() { return this }, json(body) { this.body = body; return this } }
  await middleware({ method: 'POST', path: '/login', socket: { remoteAddress: '127.0.0.1' }, rawHeaders: ['X-Forwarded-For', '198.51.100.23'], body: { username: 'User' } }, response, () => next++)
  assert.equal(next, 1)
  assert.deepEqual(inserted, counterKeys(key, 'login', '198.51.100.23', 'User').map(counter => counter.key))

  inserted.length = 0
  const unavailable = { ...response, code: 0, body: null }
  await middleware({ method: 'POST', path: '/login', socket: { remoteAddress: '127.0.0.1' }, rawHeaders: ['X-Forwarded-For', '198.51.100.23', 'x-forwarded-for', '198.51.100.24'], body: { username: 'User' } }, unavailable, () => next++)
  assert.equal(unavailable.code, 503)
  assert.deepEqual(unavailable.body, { error: 'Authentication temporarily unavailable. Please try again later.' })
  assert.deepEqual(inserted, [])
  assert.equal(next, 1)
})

test('shared workers and a restarted worker cannot reset login limits; retry header and spoofed IPs remain safe', async t => {
  const f = await fixture(t)
  await register(f.client())
  const hooks = []; t.after(async () => { for (const hook of hooks) await hook() })
  const start = () => startSessionProcess({ after: fn => hooks.push(fn) }, { childEnv: f.childEnv, cwd: f.directory })
  const first = await start(), second = await start()
  const request = (worker, index) => worker.request('/api/auth/LoGiN/', { method: 'POST', body: { username: ' test-user ', password: 'wrong' },
    headers: { 'X-Forwarded-For': `192.0.2.${index}`, Forwarded: `for=192.0.2.${index}`, 'X-Real-IP': `192.0.2.${index}` } })
  const results = await Promise.all(Array.from({ length: 12 }, (_, i) => request(i % 2 ? first : second, i)))
  assert.equal(results.filter(r => r.status === 401).length, 10)
  for (const r of results.filter(r => r.status === 429)) {
    assert.match(r.headers.get('retry-after'), /^[1-9]\d*$/)
    assert.equal(r.headers.get('cache-control'), 'no-store')
    assert.deepEqual(r.setCookies, [])
  }
  await first.stop()
  const restarted = await start()
  assert.equal((await request(restarted, 99)).status, 429)
  // Another username still gets a normal credential response; there is no global account lockout.
  assert.equal((await second.request('/api/auth/login', { method: 'POST', body: { username: 'another', password: 'wrong' } })).status, 401)
  const values = (await f.database.query('SELECT * FROM auth_abuse_counters')).rows
  assert.ok(values.every(row => /^[a-f0-9]{64}$/.test(row.key)))
})

test('database storage outage fails closed before sessions and recovers without fallback', async t => {
  const f = await fixture(t)
  await f.database.query('ALTER TABLE auth_abuse_counters RENAME TO unavailable_abuse')
  const r = await f.client()('/api/auth/register', { method: 'POST', body: account() })
  assert.equal(r.status, 503)
  assert.equal(r.cookie, null)
  assert.deepEqual(r.body, { error: 'Authentication temporarily unavailable. Please try again later.' })
  assert.equal((await f.database.query('SELECT count(*) FROM users')).rows[0].count, '0')
  assert.equal((await f.database.query('SELECT count(*) FROM user_sessions')).rows[0].count, '0')
  await f.database.query('ALTER TABLE unavailable_abuse RENAME TO auth_abuse_counters')
  assert.equal((await f.client()('/api/auth/register', { method: 'POST', body: account() })).status, 201)
})

test('unavailable PostgreSQL connection rejects admission rather than using memory', async () => {
  const db = createDatabase({ host: '127.0.0.1', port: 1, database: 'vinyl_shop_test', user: 'fictional', password: randomBytes(32).toString('hex'), connectionTimeoutMillis: 200 })
  try { await assert.rejects(consumeAttempt(db, [])) } finally { await db.close() }
})

test('global budget caps random peers/identifiers, saturates without extending expiry and bounds storage', async t => {
  const { database } = await postgresFixture(t)
  await initializeAbuse(database)
  const key = randomBytes(32)
  // Bypass the shorter burst bucket only in this storage-level test to isolate the minute budget.
  for (let i = 0; i < 120; i++) assert.equal((await consumeAttempt(database, counterKeys(key, 'login', `fictional-${i}`, `user-${i}`).slice(1))).allowed, true)
  const before = (await database.query('SELECT max(expires_at) AS expiry FROM auth_abuse_counters')).rows[0].expiry
  for (let i = 0; i < 5; i++) assert.equal((await consumeAttempt(database, counterKeys(key, 'login', `new-${i}`, `new-${i}`).slice(1))).allowed, false)
  assert.equal(Number((await database.query('SELECT count(*) FROM auth_abuse_counters')).rows[0].count), 241)
  assert.deepEqual((await database.query('SELECT max(expires_at) AS expiry FROM auth_abuse_counters')).rows[0].expiry, before)
  await database.query("UPDATE auth_abuse_counters SET expires_at=clock_timestamp()-interval '1 second'")
  assert.equal((await consumeAttempt(database, counterKeys(key, 'login', 'fresh', 'fresh'))).allowed, true)
  assert.equal((await database.query('SELECT count(*) FROM auth_abuse_counters')).rows[0].count, '4')
  await database.query(`INSERT INTO auth_abuse_counters SELECT lpad(to_hex(n),64,'0'),1,clock_timestamp()+interval '1 hour' FROM generate_series(1,9996) n`)
  assert.deepEqual(await consumeAttempt(database, counterKeys(key, 'login', 'new-peer', 'new-user')), { allowed: false, retryAfter: 60 })
})

test('peer budget prevents username multiplication while distinct peers retain access', async t => {
  const { database } = await postgresFixture(t)
  await initializeAbuse(database)
  const key = randomBytes(32)
  for (let i = 0; i < 60; i++) assert.equal((await consumeAttempt(database, counterKeys(key, 'login', 'peer', `user${i}`).slice(2))).allowed, true)
  assert.equal((await consumeAttempt(database, counterKeys(key, 'login', 'peer', 'fresh').slice(2))).allowed, false)
  assert.equal((await consumeAttempt(database, counterKeys(key, 'login', 'other-peer', 'fresh').slice(2))).allowed, true)
})

test('explicit migration is idempotent, startup validation detects missing indexes and privileges', async t => {
  const { database } = await postgresFixture(t)
  await initializeAbuse(database)
  const c = counterKeys(randomBytes(32), 'login', 'peer', 'user')
  await consumeAttempt(database, c)
  const before = (await database.query('SELECT * FROM auth_abuse_counters ORDER BY key')).rows
  await Promise.all([initializeAbuse(database), initializeAbuse(database)])
  assert.deepEqual((await database.query('SELECT * FROM auth_abuse_counters ORDER BY key')).rows, before)
  await database.query('DROP INDEX auth_abuse_expiry_idx')
  await assert.rejects(validateAbuseSchema(database), /indexes/)
  await initializeAbuse(database)
  await database.query('REVOKE UPDATE ON auth_abuse_counters FROM CURRENT_USER')
  await assert.rejects(validateAbuseSchema(database), /unavailable/)
  await assert.rejects(consumeAttempt(database, c))
})

test('oversized and abnormal inputs do not reach bcrypt or create sessions', async t => {
  const { client } = await fixture(t)
  for (const body of [null, [], { username: {}, password: [] }, { username: 'x'.repeat(1025), password: 'p' }, { username: 'valid', password: 'p'.repeat(8193) }]) {
    const r = await client()('/api/auth/login', { method: 'POST', body })
    assert.equal(r.status, 400)
    assert.equal(r.cookie, null)
  }
})

test('limiter leaves unrelated endpoints and methods alone', async () => {
  const middleware = authenticationAbuse({}, randomBytes(32))
  let calls = 0
  for (const [method, path] of [['GET', '/login'], ['POST', '/logout'], ['POST', '/me']]) await middleware({ method, path }, {}, () => calls++)
  assert.equal(calls, 3)
})

test('non-owner runtime SQL role can authenticate but cannot create tables or write products', async t => {
  const f = await fixture(t)
  await f.database.query(`GRANT USAGE ON SCHEMA "${f.schema}" TO vinyl_abuse_runtime`)
  await f.database.query('GRANT SELECT ON products TO vinyl_abuse_runtime')
  await f.database.query('GRANT SELECT, INSERT, UPDATE ON users TO vinyl_abuse_runtime')
  await f.database.query('GRANT SELECT, INSERT, UPDATE, DELETE ON cart_items, user_sessions, auth_abuse_counters TO vinyl_abuse_runtime')
  await f.database.query('GRANT USAGE ON SEQUENCE users_id_seq, cart_items_id_seq TO vinyl_abuse_runtime')
  const url = new URL(f.childEnv.DATABASE_URL); url.username = 'vinyl_abuse_runtime'
  const runtime = createDatabase({ host: url.hostname, port: Number(url.port), database: 'vinyl_shop_test', user: url.username, password: decodeURIComponent(url.password), options: `-c search_path=${f.schema}` })
  t.after(() => runtime.close())
  await validateAbuseSchema(runtime)
  await assert.rejects(runtime.query('CREATE TABLE forbidden(id int)'), { code: '42501' })
  await assert.rejects(runtime.query("INSERT INTO products(title,artist,price,image) VALUES ('Synthetic','Synthetic',1,'synthetic.png')"), { code: '42501' })
  const hooks = []; t.after(async () => { for (const hook of hooks) await hook() })
  const worker = await startSessionProcess({ after: fn => hooks.push(fn) }, { cwd: f.directory, childEnv: { ...f.childEnv, DATABASE_URL: url.href } })
  assert.equal((await worker.request('/api/auth/register', { method: 'POST', body: account() })).status, 201)
  assert.equal((await worker.request('/api/auth/login', { method: 'POST', body: account() })).status, 200)
  for (let i = 0; i < 9; i++) assert.equal((await worker.request('/api/auth/login', { method: 'POST', body: { username: account().username, password: 'wrong' } })).status, 401)
  assert.equal((await worker.request('/api/auth/login', { method: 'POST', body: account() })).status, 429)
})

test('startup refuses missing abuse schema and unresolved key without initializing storage', async t => {
  const f = await fixture(t)
  const hooks = []; t.after(async () => { for (const hook of hooks) await hook() })
  const start = overrides => startSessionProcess({ after: fn => hooks.push(fn) }, { cwd: f.directory, childEnv: f.childEnv, overrides })
  await assert.rejects(start({ AUTH_ABUSE_HMAC_KEY: '@Microsoft.KeyVault(unresolved)' }), /startup failed/)
  await f.database.query('DROP TABLE auth_abuse_counters')
  await assert.rejects(start({}), /startup failed/)
  assert.equal((await f.database.query("SELECT to_regclass('auth_abuse_counters') AS name")).rows[0].name, null)
})

test('migration preserves live application data and cleanup deletes at most 500 expired rows per admission', async t => {
  const f = await fixture(t), request = f.client()
  await register(request)
  assert.equal((await request('/api/cart/add', { method: 'POST', body: { productId: 1 } })).status, 200)
  const snapshot = async () => Promise.all(['users', 'cart_items', 'products', 'user_sessions'].map(table => f.database.query(`SELECT * FROM ${table}`).then(r => r.rows)))
  const before = await snapshot()
  await initializeAbuse(f.database)
  assert.deepEqual(await snapshot(), before)
  await f.database.query('DELETE FROM auth_abuse_counters')
  await f.database.query(`INSERT INTO auth_abuse_counters SELECT lpad(to_hex(n),64,'0'),1,clock_timestamp()-interval '1 hour' FROM generate_series(1,1200) n`)
  const counters = counterKeys(randomBytes(32), 'login', 'peer', 'user')
  for (const expected of [704, 204, 4]) {
    assert.equal((await consumeAttempt(f.database, counters)).allowed, true)
    assert.equal(Number((await f.database.query('SELECT count(*) FROM auth_abuse_counters')).rows[0].count), expected)
  }
})
