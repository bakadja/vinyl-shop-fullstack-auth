import assert from 'node:assert/strict'
import { test } from 'node:test'
import { randomBytes } from 'node:crypto'
import { postgresFixture } from '../test-support/postgresql.js'
import { initializeSessions } from '../sessions/schema.js'
import { createSessionStore } from '../sessions/store.js'
import { sessionConfig } from '../sessions/config.js'
const call = (store, method, ...args) => new Promise((resolve,reject) => store[method](...args, (err,value) => err ? reject(err) : resolve(value)))
test('store expires without pruning, does not touch deadlines and never closes caller pool', async t => {
  let owner
  t.after(async () => { if (owner) await owner.close() })
  const { database, schema } = await postgresFixture(t)
  await initializeSessions(database)
  owner = createSessionStore({ pool: database.getPool(), config: sessionConfig({ DATABASE_SCHEMA: schema, SPIRAL_SESSION_SECRET: randomBytes(32).toString('hex') }) })
  const { store } = owner
  const sid = "sid'; DELETE FROM users; --"
  const session = { cookie: { expires: new Date(Date.now()+3600000) }, userId: 1, authenticatedAt: Date.now() }
  await call(store,'set',sid,session)
  const expiry = (await database.query('SELECT expire FROM user_sessions WHERE sid=$1',[sid])).rows[0].expire
  await call(store,'touch',sid,{...session,cookie:{expires:new Date(Date.now()+7200000)}})
  assert.deepEqual((await database.query('SELECT expire FROM user_sessions WHERE sid=$1',[sid])).rows[0].expire, expiry)
  await database.query("UPDATE user_sessions SET expire=now()-interval '1 minute' WHERE sid=$1",[sid])
  assert.equal(await call(store,'get',sid), undefined)
  await call(store,'pruneSessions')
  assert.equal((await database.query('SELECT count(*) FROM user_sessions')).rows[0].count,'0')
  await owner.close(); await owner.close()
  assert.equal((await database.query('SELECT 1 AS n')).rows[0].n,1)
})
test('store close drains a query already in flight', async () => {
  let release
  const pending = new Promise(resolve => { release=resolve })
  const owner = createSessionStore({ pool: { query: () => pending }, config: sessionConfig({SPIRAL_SESSION_SECRET:randomBytes(32).toString('hex')}) })
  const write = call(owner.store,'set','one',{cookie:{expires:new Date(Date.now()+10000)}})
  let closed=false
  const closing=owner.close().then(()=>{closed=true})
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(closed,false)
  release({rows:[]}); await write; await closing
  assert.equal(closed,true)
})
