import assert from 'node:assert/strict'
import { test } from 'node:test'
import { databaseConfig } from '../db/config.js'
import { priceNumber, integerNumber, countNumber } from '../db/values.js'
import { createDatabase } from '../db/db.js'

const local = { PGHOST: '127.0.0.1', PGPORT: '5432', PGDATABASE: 'vinyl', PGUSER: 'synthetic', PGPASSWORD: 'fixture-only', PGSSLMODE: 'disable' }

test('PostgreSQL values preserve numbers and reject invalid or unsafe conversions', () => {
  assert.equal(priceNumber('44.99'), 44.99)
  assert.equal(priceNumber('0.10'), 0.1)
  assert.equal(priceNumber('-1.25'), -1.25)
  assert.equal(countNumber(null), 0)
  assert.equal(countNumber('12'), 12)
  assert.equal(integerNumber('9007199254740991'), Number.MAX_SAFE_INTEGER)
  for (const value of ['NaN', 'Infinity', '', '12x', '1e2', '1.001', '100000000', true, null, undefined]) assert.throws(() => priceNumber(value))
  for (const value of ['9007199254740992', '1.5', '', '1x', true, null]) assert.throws(() => integerNumber(value))
  assert.throws(() => countNumber('-1'))
  assert.throws(() => countNumber('9007199254740992'))
})

test('PostgreSQL configuration accepts environment-only settings and URL precedence', () => {
  const config = databaseConfig(local)
  assert.equal(config.database, 'vinyl')
  assert.equal(config.ssl, false)
  const urlConfig = databaseConfig({ ...local, DATABASE_URL: 'postgresql://synthetic:fixture-only@127.0.0.1:6543/other' })
  assert.equal(urlConfig.database, 'other')
  assert.equal(urlConfig.port, 6543)
  assert.throws(() => databaseConfig({}))
  assert.throws(() => databaseConfig({ ...local, PGPORT: 'bad' }))
  assert.throws(() => databaseConfig({ ...local, DATABASE_SCHEMA: 'public,other' }))
})

test('PostgreSQL TLS cannot be weakened by URL options or production settings', () => {
  const remote = { ...local, PGHOST: 'example.invalid', PGSSLMODE: 'verify-full' }
  assert.equal(databaseConfig(remote).ssl.rejectUnauthorized, true)
  assert.equal(databaseConfig({ ...local, PGSSLMODE: 'verify-full' }).ssl.rejectUnauthorized, true)
  assert.throws(() => databaseConfig({ ...local, NODE_ENV: 'production' }))
  assert.throws(() => databaseConfig({ ...remote, PGSSLMODE: 'require' }))
  assert.throws(() => databaseConfig({ ...remote, PGSSLMODE: 'disable' }))
  for (const option of ['sslmode=require', 'sslmode=no-verify', 'sslcert=a', 'sslrootcert=a', 'options=-csearch_path=public', 'host=remote.invalid']) {
    assert.throws(() => databaseConfig({ ...local, DATABASE_URL: `postgresql://synthetic:fixture-only@127.0.0.1:5432/other?${option}` }))
  }
  assert.throws(() => databaseConfig({ ...remote, PGSSLROOTCERT: '/nonexistent/ca.pem' }), error => !error.message.includes('fixture-only'))
})

test('connection refusal is bounded and does not produce secret-bearing diagnostics', async t => {
  const messages = []
  t.mock.method(console, 'error', (...args) => messages.push(args.join(' ')))
  const db = createDatabase({ ...databaseConfig(local), port: 1, connectionTimeoutMillis: 100 })
  t.after(() => db.close())
  await assert.rejects(db.query('SELECT 1'))
  assert.doesNotMatch(messages.join(' '), /fixture-only|postgresql:\/\//)
})
