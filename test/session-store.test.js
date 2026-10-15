import { initializeDatabase } from '../scripts/init-db.js'
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
  await initializeDatabase(database)
  await initializeSessions(database)
  owner = createSessionStore({ pool: database.getPool(), config: sessionConfig({ DATABASE_SCHEMA: schema, SPIRAL_SESSION_SECRET: randomBytes(32).toString('hex') }) })
  await database.query("INSERT INTO users(email,username,password) VALUES ('keep@example.invalid','keep','unchanged')")
  await database.query('INSERT INTO cart_items(user_id,product_id) SELECT id,1 FROM users')
  const appSnapshot=()=>Promise.all(['users','cart_items','products'].map(table=>database.query(`SELECT * FROM ${table} ORDER BY id`).then(r=>r.rows)))
  const before=await appSnapshot()
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
  assert.deepEqual(await appSnapshot(),before)
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
test('prune failures use sanitized diagnostics and do not disable later store recovery',async t=>{
 let owner;t.after(async()=>{if(owner)await owner.close()})
 const f=await postgresFixture(t);await initializeSessions(f.database)
 const logs=[];t.mock.method(console,'error',(...args)=>logs.push(args))
 owner=createSessionStore({pool:f.database.getPool(),config:sessionConfig({DATABASE_SCHEMA:f.schema,SPIRAL_SESSION_SECRET:randomBytes(32).toString('hex')})})
 await f.database.query('DROP TABLE user_sessions')
 await assert.rejects(call(owner.store,'get','missing'))
 owner.store.pruneSessions()
 for(let attempt=0;attempt<50&&logs.length===0;attempt++)await new Promise(resolve=>setTimeout(resolve,10))
 assert.deepEqual(logs,[['Session cleanup failed']])
 await initializeSessions(f.database)
 await call(owner.store,'set','recovered',{cookie:{expires:new Date(Date.now()+10000)}})
 assert.ok(await call(owner.store,'get','recovered'))
})
test('store close drains a real in-flight prune and cancels future pruning',async t=>{
 let owner,release,transaction
 t.after(async()=>{if(release)release();if(transaction)await transaction;if(owner)await owner.close()})
 const f=await postgresFixture(t);await initializeSessions(f.database)
 owner=createSessionStore({pool:f.database.getPool(),config:sessionConfig({DATABASE_SCHEMA:f.schema,SPIRAL_SESSION_SECRET:randomBytes(32).toString('hex')})})
 let locked;const ready=new Promise(resolve=>{locked=resolve}),gate=new Promise(resolve=>{release=resolve})
 transaction=f.database.transaction(async client=>{await client.query('LOCK TABLE user_sessions IN ACCESS EXCLUSIVE MODE');locked();await gate})
 await ready
 const pruning=call(owner.store,'pruneSessions')
 let waiting=false
 for(let i=0;i<100;i++){
  waiting=(await f.database.query("SELECT 1 FROM pg_stat_activity WHERE query LIKE 'DELETE FROM %user_sessions%' AND wait_event_type='Lock'")).rows.length>0
  if(waiting)break
  await new Promise(resolve=>setTimeout(resolve,10))
 }
 assert.equal(waiting,true)
 let closed=false;const closing=owner.close().then(()=>{closed=true})
 await new Promise(resolve=>setImmediate(resolve));assert.equal(closed,false)
 release();await transaction;await pruning;await closing
 assert.equal(owner.store.closed,true)
 assert.equal(owner.store.pruneTimer,undefined)
 assert.equal((await f.database.query('SELECT 1 AS n')).rows[0].n,1)
})
test('UTC application connections preserve absolute expiry under non-UTC observers/defaults',async t=>{
 let owner,appDatabase
 t.after(async()=>{if(owner)await owner.close();if(appDatabase)await appDatabase.close()})
 const f=await postgresFixture(t);await initializeSessions(f.database)
 await f.database.query("SET timezone='Pacific/Auckland'")
 const {createDatabase}=await import('../db/db.js'),{databaseConfig}=await import('../db/config.js')
 appDatabase=createDatabase(databaseConfig(f.childEnv))
 assert.equal((await appDatabase.query('SHOW timezone')).rows[0].TimeZone,'UTC')
 owner=createSessionStore({pool:appDatabase.getPool(),config:sessionConfig({...f.childEnv,SPIRAL_SESSION_SECRET:randomBytes(32).toString('hex')})})
 const authenticatedAt=Date.now()
 const value={cookie:{expires:new Date(authenticatedAt+28800000)},userId:1,authenticatedAt}
 await call(owner.store,'set','utc-session',value)
 const delta=Number((await f.database.query("SELECT EXTRACT(EPOCH FROM expire AT TIME ZONE 'UTC')*1000-$1::numeric AS delta FROM user_sessions WHERE sid='utc-session'",[authenticatedAt])).rows[0].delta)
 assert.ok(delta>=28800000&&delta<28801000)
 value.userId=2
 await call(owner.store,'set','utc-session',value)
 assert.equal((await call(owner.store,'get','utc-session')).userId,2)
 await f.database.query("UPDATE user_sessions SET expire=(now() AT TIME ZONE 'UTC')-interval '1 minute'")
 assert.equal(await call(owner.store,'get','utc-session'),undefined)
})
