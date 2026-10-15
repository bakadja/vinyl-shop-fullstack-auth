import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fixture, register } from '../test-support/http.js'
test('GET and HEAD logout are 405 without touching authenticated sessions; POST invalidates raw cookie',async t=>{
 const {client,database}=await fixture(t),request=client()
 const created=await request('/api/auth/register',{method:'POST',body:{name:'Fictional',email:'fictional@example.com',username:'fictional',password:'synthetic-password'}})
 const Cookie=created.cookie.split(';')[0]
 const snapshot=()=>database.query('SELECT * FROM user_sessions ORDER BY sid').then(r=>r.rows)
 const before=await snapshot()
 for(const path of ['/api/auth/logout','/api/auth/logout/'])for(const method of ['GET','HEAD']){
   const result=await request(path,{method})
   assert.equal(result.status,405)
   assert.equal(result.cookie,null)
   assert.deepEqual(result.body,method==='HEAD'?null:{error:'Method not allowed'})
 }
 assert.deepEqual(await snapshot(),before)
 assert.equal((await request('/api/auth/me')).body.isLoggedIn,true)
 const post=await request('/api/auth/logout',{method:'POST',body:{}})
 assert.equal(post.status,200);assert.match(post.cookie,/Expires=Thu, 01 Jan 1970/)
 assert.deepEqual((await request('/api/auth/me',{headers:{Cookie}})).body,{isLoggedIn:false})
 assert.equal((await request('/api/cart',{headers:{Cookie}})).status,401)
})
test('logout CSRF/content policy rejects forged browser requests without revocation',async t=>{
 const {client,database}=await fixture(t),request=client();await register(request)
 for(const headers of [{Origin:'https://evil.example'},{Origin:'null'},{'Sec-Fetch-Site':'cross-site'}]){
  assert.equal((await request('/api/auth/logout',{method:'POST',body:{},headers})).status,403)
  assert.equal((await request('/api/auth/me')).body.isLoggedIn,true)
 }
 assert.equal((await request('/api/auth/logout',{method:'POST'})).status,415)
 assert.equal((await database.query('SELECT count(*) FROM user_sessions')).rows[0].count,'1')
})
