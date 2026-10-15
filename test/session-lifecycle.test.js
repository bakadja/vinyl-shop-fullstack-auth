import { initializeAbuse } from '../sessions/abuse-schema.js'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { once } from 'node:events'
import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { postgresFixture } from '../test-support/postgresql.js'
import { initializeDatabase } from '../scripts/init-db.js'
import { initializeSessions } from '../sessions/schema.js'
import { startSessionProcess } from '../test-support/session-process.js'
import { createTestCertificates } from '../test-support/tls.js'
import { account } from '../test-support/http.js'
const serverFile=fileURLToPath(new URL('../server.js',import.meta.url))
test('production startup fails before readiness for wrong CA or missing session table',async t=>{
 const hooks=[];t.after(async()=>{for(const h of hooks)await h()})
 const f=await postgresFixture(t);await initializeDatabase(f.database)
 await assert.rejects(startSessionProcess({after:h=>hooks.push(h)},{childEnv:f.childEnv,cwd:f.directory}),/startup failed/)
 assert.equal((await f.database.query("SELECT to_regclass('user_sessions') AS name")).rows[0].name,null)
 await initializeSessions(f.database);await initializeAbuse(f.database)
 const wrong=await createTestCertificates()
 hooks.push(wrong.cleanup)
 await assert.rejects(startSessionProcess({after:h=>hooks.push(h)},{childEnv:f.childEnv,cwd:f.directory,overrides:{NODE_ENV:'production',PGSSLMODE:'verify-full',PGSSLROOTCERT:wrong.caFile,PUBLIC_ORIGIN:'https://shop.example',SESSION_PROXY_MODE:'verified-proxy',TRUSTED_PROXY_CIDRS:'127.0.0.1/32'}}),/startup failed/)
})
test('repeated shutdown signals honor the ten-second deadline with a blocked real DB request',{timeout:25000},async t=>{
 let child,release,transaction
 t.after(async()=>{if(release)release();if(transaction)await transaction;if(child&&child.exitCode===null&&child.signalCode===null){const done=once(child,'exit');child.kill('SIGKILL');await done}})
 const f=await postgresFixture(t);await initializeDatabase(f.database);await initializeSessions(f.database);await initializeAbuse(f.database)
 child=spawn(process.execPath,[serverFile],{cwd:f.directory,env:{...f.childEnv,PORT:'0',SPIRAL_SESSION_SECRET:randomBytes(32).toString('hex')},stdio:['ignore','pipe','pipe']})
 let logs='';child.stderr.on('data',chunk=>{logs+=chunk})
 const url=await new Promise((resolve,reject)=>{child.once('error',reject);child.stdout.on('data',chunk=>{const m=String(chunk).match(/localhost:(\d+)/);if(m)resolve(`http://127.0.0.1:${m[1]}`)})})
 const registered=await fetch(url+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(account('shutdown'))})
 assert.equal(registered.status,201);await registered.json()
 const Cookie=registered.headers.get('set-cookie').split(';')[0]
 let locked
 const ready=new Promise(resolve=>{locked=resolve}),gate=new Promise(resolve=>{release=resolve})
 transaction=f.database.transaction(async client=>{await client.query('LOCK TABLE cart_items IN ACCESS EXCLUSIVE MODE');locked();await gate})
 await ready
 const request=fetch(url+'/api/cart',{headers:{Cookie},signal:AbortSignal.timeout(18000)});request.catch(()=>{})
 let waiting=false
 for(let i=0;i<100;i++){
  waiting=(await f.database.query("SELECT 1 FROM pg_stat_activity WHERE application_name='vinyl-shop' AND wait_event_type='Lock'")).rows.length>0
  if(waiting)break
  await new Promise(resolve=>setTimeout(resolve,20))
 }
 assert.equal(waiting,true)
 const exited=once(child,'exit'),started=Date.now()
 child.kill('SIGTERM');await new Promise(resolve=>setTimeout(resolve,100));child.kill('SIGINT')
 const [code,signal]=await exited
 assert.equal(code,1);assert.equal(signal,null)
 assert.ok(Date.now()-started>=9500);assert.ok(Date.now()-started<14000)
 assert.match(logs,/shutdown timed out/)
 await assert.rejects(request)
 release();await transaction
})
