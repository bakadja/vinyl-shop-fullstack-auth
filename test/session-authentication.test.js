import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fixture, account } from '../test-support/http.js'
import { sessionValidity } from '../sessions/policy.js'
import { establishSession } from '../sessions/authentication.js'
import { sessionConfig } from '../sessions/config.js'
import { randomBytes } from 'node:crypto'
const config=sessionConfig({SPIRAL_SESSION_SECRET:randomBytes(32).toString('hex')})
for(const path of ['login','register']) test(`${path} regenerates identity and invalidates the previous SID`,async t=>{
 const f=await fixture(t),request=f.client()
 const first=await request('/api/auth/register',{method:'POST',body:account('alice')})
 assert.equal(first.status,201)
 const old=first.cookie.split(';')[0]
 let body=account('bob')
 if(path==='login') assert.equal((await f.client()('/api/auth/register',{method:'POST',body})).status,201)
 const next=await request('/api/auth/'+path,{method:'POST',body})
 assert.equal(next.status,path==='register'?201:200)
 assert.notEqual(next.cookie.split(';')[0],old)
 const rows=(await f.database.query('SELECT sess FROM user_sessions')).rows
 assert.ok(rows.every(row=>Number.isSafeInteger(row.sess.authenticatedAt)))
 // Cookie replay uses an independent native request, not the client's cleared jar.
 const {getPool}=f.database;assert.ok(getPool())
 const result=await request('/api/auth/me',{headers:{Cookie:old}})
 assert.deepEqual(result.body,{isLoggedIn:false})
})
for(const failure of ['regenerate','save']) test(`authentication ${failure} failure detaches session and withholds success`,async()=>{
 let saved=0,destroyed=[]
 const response={clearCookie(){return this}}
 const req={sessionID:'old',sessionStore:{destroy(sid,cb){destroyed.push(sid);cb(null)}}}
 req.session={regenerate(cb){if(failure==='regenerate') return cb(new Error('sentinel'));req.sessionID='new';req.session={cookie:{},save(cb){saved++;cb(new Error('sentinel'))}};cb(null)}}
 await assert.rejects(establishSession(req,response,1,config),error=>error.message==='Authentication session failed'&&error.cause?.message==='sentinel')
 assert.equal(req.session,null)
 assert.ok(destroyed.includes(failure==='regenerate'?'old':'new'))
 assert.equal(saved,failure==='regenerate'?0:1)
})

test('application expiry rejects exact deadline, future or malformed identities without a new session', async()=>{
 for(const data of [{userId:1,authenticatedAt:0},{userId:1,authenticatedAt:28800001},{userId:'1',authenticatedAt:1},{userId:0,authenticatedAt:1},{userId:1}]) {
  let cleared=0,deleted=0,nextError
  const req={session:data,sessionID:'fixture',sessionStore:{destroy(sid,cb){deleted++;cb(null)}}}
  await sessionValidity(config,{now:()=>28800000})(req,{clearCookie(){cleared++;return this}},error=>{nextError=error})
  assert.equal(req.session,null);assert.equal(deleted,1);assert.equal(cleared,1);assert.equal(nextError,undefined)
 }
})
