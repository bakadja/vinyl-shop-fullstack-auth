import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fixture, account } from '../test-support/http.js'
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
for(const failure of ['regenerate','save','committed-save']) test(`authentication ${failure} failure detaches session and withholds success`,async()=>{
 let saved=0,destroyed=[]
 const response={clearCookie(){return this}}
 const req={sessionID:'old',sessionStore:{destroy(sid,cb){destroyed.push(sid);cb(null)}}}
 req.session={regenerate(cb){if(failure==='regenerate') return cb(new Error('sentinel'));req.sessionID='new';req.session={cookie:{},save(cb){saved++;cb(new Error('sentinel'))}};cb(null)}}
 await assert.rejects(establishSession(req,response,1,config))
 assert.equal(req.session,null)
 assert.ok(destroyed.includes(failure==='regenerate'?'old':'new'))
 assert.equal(saved,failure==='regenerate'?0:1)
})
