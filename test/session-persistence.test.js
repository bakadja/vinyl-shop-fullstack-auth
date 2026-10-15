import assert from 'node:assert/strict'
import { test } from 'node:test'
import { randomBytes } from 'node:crypto'
import { postgresFixture } from '../test-support/postgresql.js'
import { initializeDatabase } from '../scripts/init-db.js'
import { initializeSessions } from '../sessions/schema.js'
import { startSessionProcess } from '../test-support/session-process.js'
import { account } from '../test-support/http.js'
async function setup(t){const hooks=[];t.after(async()=>{for(const h of hooks)await h()});const f=await postgresFixture(t);await initializeDatabase(f.database);await initializeSessions(f.database);return {...f,harness:{after:h=>hooks.push(h)}}}
test('sessions survive restarts and workers, respect rotation and reject expired identity before pruning',async t=>{
 const f=await setup(t),oldKey=randomBytes(32).toString('hex'),nextKey=randomBytes(32).toString('hex')
 const start=(secret,overrides={})=>startSessionProcess(f.harness,{childEnv:f.childEnv,cwd:f.directory,secret,overrides})
 const first=await start(oldKey)
 const created=await first.request('/api/auth/register',{method:'POST',body:account()});assert.equal(created.status,201)
 const Cookie=created.setCookies[0].split(';')[0]
 await first.stop()
 const second=await start(nextKey,{SPIRAL_SESSION_PREVIOUS_SECRETS:JSON.stringify([oldKey])})
 const me=()=>second.request('/api/auth/me',{headers:{Cookie}})
 assert.equal((await me()).body.isLoggedIn,true)
 const worker=await start(nextKey,{SPIRAL_SESSION_PREVIOUS_SECRETS:JSON.stringify([oldKey])})
 assert.equal((await worker.request('/api/auth/me',{headers:{Cookie}})).body.isLoggedIn,true)
 const removed=await start(nextKey)
 assert.deepEqual((await removed.request('/api/auth/me',{headers:{Cookie}})).body,{isLoggedIn:false})
 const before=(await f.database.query('SELECT expire FROM user_sessions')).rows[0].expire
 await me(); assert.deepEqual((await f.database.query('SELECT expire FROM user_sessions')).rows[0].expire,before)
 await f.database.query("UPDATE user_sessions SET sess=jsonb_set(sess::jsonb,'{authenticatedAt}',to_jsonb((extract(epoch from now())*1000)::bigint-28800001))::json")
 assert.deepEqual((await me()).body,{isLoggedIn:false})
 assert.equal((await second.request('/api/cart',{headers:{Cookie}})).status,401)
})
