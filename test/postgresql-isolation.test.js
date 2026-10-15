import pg from 'pg'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { testTarget, postgresFixture } from '../test-support/postgresql.js'

const target = 'postgresql://vinyl_shop_test:fixture@127.0.0.1:15433/vinyl_shop_test'
test('test target selection rejects application fallbacks, remote hosts and injected options', () => {
  assert.equal(testTarget({ TEST_DATABASE_URL: target }).database, 'vinyl_shop_test')
  for (const env of [
    {}, { DATABASE_URL: target },
    { TEST_DATABASE_URL: target.replace('vinyl_shop_test', 'postgres') },
    { TEST_DATABASE_URL: target.replace('/vinyl_shop_test', '/development') },
    { TEST_DATABASE_URL: target.replace('127.0.0.1', 'production.example') },
    { TEST_DATABASE_URL: `${target}?options=-csearch_path=public` },
    { TEST_DATABASE_URL: target, DATABASE_URL: target.replace(':fixture@', ':other@') },
    { TEST_DATABASE_URL: target, PGHOST: '127.0.0.1', PGPORT: '15433', PGDATABASE: 'vinyl_shop_test' }
  ]) assert.throws(() => testTarget(env), /test|Test/)
  assert.equal(testTarget({ TEST_DATABASE_URL: target, PGOPTIONS: '-csearch_path=public' }).options, '-c search_path=vinyl_test_control')
})

test('test fixtures use private schemas and cleanup preserves another fixture', async t => {
  const first = await postgresFixture(t)
  const second = await postgresFixture(t)
  assert.notEqual(first.schema, second.schema)
  await first.database.query('CREATE TABLE sentinel (id integer)')
  await second.database.query('CREATE TABLE sentinel (id integer)')
  await first.database.query('INSERT INTO sentinel VALUES (1)')
  assert.equal((await first.database.query('SELECT COUNT(*) AS n FROM sentinel')).rows[0].n, '1')
  assert.equal((await second.database.query('SELECT COUNT(*) AS n FROM sentinel')).rows[0].n, '0')
  await assert.rejects(first.database.query('CREATE TABLE public.forbidden (id integer)'), { code: '42501' })
  await assert.rejects(first.database.query('DROP TABLE vinyl_test_control.marker'), { code: '42501' })
  assert.equal(first.childEnv.DATABASE_SCHEMA, first.schema)
  assert.equal(first.childEnv.PGOPTIONS, undefined)
})

test('fixture setup fails before DDL without an administrator marker', async t => {
  await assert.rejects(postgresFixture(t, { TEST_DATABASE_URL: target.replace('15433', '1') }), /connect|ECONNREFUSED|EPERM/)
})

test('loopback aliases and default ports cannot disguise an application target', () => {
  assert.throws(() => testTarget({ TEST_DATABASE_URL: target, DATABASE_URL: target.replace('127.0.0.1', 'localhost') }))
})

test('cleanup verifies schema identity and preserves renamed or recreated namespaces', async t => {
  const hooks = []
  const fixture = await postgresFixture({ after: callback => hooks.push(callback) })
  const observer = await postgresFixture(t)
  const renamed = `${fixture.schema}_old`
  await fixture.database.query(`ALTER SCHEMA "${fixture.schema}" RENAME TO "${renamed}"`)
  await observer.database.query(`CREATE SCHEMA "${fixture.schema}"`)
  await assert.rejects(hooks[0](), /identity changed/)
  const namespaces = await observer.database.query('SELECT nspname FROM pg_namespace WHERE nspname = ANY($1)', [[fixture.schema, renamed]])
  assert.equal(namespaces.rows.length, 2)
  // Both namespaces belong to this synthetic negative test in the disposable server.
  await observer.database.query(`DROP SCHEMA "${fixture.schema}"`)
  await observer.database.query(`DROP SCHEMA "${renamed}"`)
})

test('encoded application database names and numeric port aliases cannot bypass isolation', () => {
  for (const application of [
    target.replace('/vinyl_shop_test', '/%76inyl_shop_test'),
    target.replace(':15433/', ':015433/'),
    target.replace('127.0.0.1', '[::1]')
  ]) assert.throws(() => testTarget({ TEST_DATABASE_URL: target, DATABASE_URL: application }))
  assert.throws(() => testTarget({ TEST_DATABASE_URL: target, PGHOST: '::1', PGPORT: '015433', PGDATABASE: 'vinyl_shop_test' }))
})

test('concurrent namespace replacement cannot make cleanup delete a replacement schema', async t => {
  const hooks = []
  const original = await postgresFixture({ after: callback => hooks.push(callback) })
  const observer = await postgresFixture(t)
  const renamed = `${original.schema}_old`
  let replaced = false
  const query = pg.Client.prototype.query
  const replace = async () => {
    replaced = true
    await observer.database.transaction(async client => {
      await client.query(`ALTER SCHEMA "${original.schema}" RENAME TO "${renamed}"`)
      await client.query(`CREATE SCHEMA "${original.schema}"`)
    })
  }
  // Real PostgreSQL statements; interpose only to schedule a committed DDL race
  // after the old client-side check, or before the new atomic server-side helper.
  const interleave = t.mock.method(pg.Client.prototype, 'query', async function (...args) {
    if (!replaced && String(args[0]).includes('SELECT vinyl_test_control.drop_test_schema')) await replace()
    const result = await query.apply(this, args)
    if (!replaced && String(args[0]).includes('SELECT oid, nspowner FROM pg_namespace WHERE nspname = $1')) await replace()
    return result
  })
  try {
    await assert.rejects(hooks[0](), /identity changed/)
    assert.equal((await observer.database.query('SELECT oid FROM pg_namespace WHERE nspname = ANY($1)', [[original.schema, renamed]])).rows.length, 2)
  } finally {
    interleave.mock.restore()
    await observer.database.query(`DROP SCHEMA IF EXISTS "${original.schema}"`)
    await observer.database.query(`DROP SCHEMA IF EXISTS "${renamed}"`)
  }
})

test('atomic cleanup helper cannot target public, control or forged schema identity', async t => {
  const { database, schema } = await postgresFixture(t)
  for (const name of ['public', 'vinyl_test_control', `${schema}; DROP SCHEMA public`]) {
    await assert.rejects(database.query('SELECT vinyl_test_control.drop_test_schema($1, 0::oid, 0::oid)', [name]), /Unsafe disposable/)
  }
  await assert.rejects(database.query('SELECT vinyl_test_control.drop_test_schema($1, 0::oid, 0::oid)', [schema]), /identity changed/)
  assert.equal((await database.query('SELECT nspname FROM pg_namespace WHERE nspname = $1', [schema])).rows.length, 1)
})
