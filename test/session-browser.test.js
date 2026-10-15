import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { postgresFixture } from '../test-support/postgresql.js'
import { initializeDatabase } from '../scripts/init-db.js'
import { initializeSessions } from '../sessions/schema.js'
import { startSessionProcess } from '../test-support/session-process.js'
import { createTestCertificates, startTlsProxy } from '../test-support/tls.js'
import { account } from '../test-support/http.js'
test('Chromium enforces production cookies and POST logout with actual frontend assets', {timeout:60000}, async t=>{
 const hooks=[];t.after(async()=>{for(const hook of hooks.reverse())await hook()})
 const f=await postgresFixture(t),harness={after:hook=>hooks.push(hook)}
 await initializeDatabase(f.database);await initializeSessions(f.database)
 const certificates=await createTestCertificates(f.directory+'/proxy-tls')
 let child
 const proxy=await startTlsProxy(harness,{targetUrl:()=>child.baseUrl,certificates})
 const origin=proxy.origin.replace('localhost','vinyl.test')
 child=await startSessionProcess(harness,{childEnv:f.childEnv,cwd:fileURLToPath(new URL('../',import.meta.url)),overrides:{NODE_ENV:'production',PGSSLMODE:'verify-full',PGSSLROOTCERT:process.env.TEST_DATABASE_CA_FILE,PUBLIC_ORIGIN:origin,SESSION_PROXY_MODE:'verified-proxy',TRUSTED_PROXY_CIDRS:'127.0.0.1/32'}})
 const browser=await chromium.launch({args:['--host-resolver-rules=MAP vinyl.test 127.0.0.1','--no-proxy-server']})
 harness.after(()=>browser.close())
 const context=await browser.newContext({ignoreHTTPSErrors:true})
 const page=await context.newPage()
 await page.goto(origin)
 const registered=await page.evaluate(async user=>{const r=await fetch('/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(user)});return r.status},account('browser'))
 assert.equal(registered,201)
 const cookie=(await context.cookies()).find(c=>c.name==='__Host-vinyl.sid')
 assert.ok(cookie);assert.equal(cookie.secure,true);assert.equal(cookie.httpOnly,true);assert.equal(cookie.sameSite,'Lax');assert.equal(cookie.path,'/');assert.equal(cookie.domain,'vinyl.test')
 assert.ok(Math.abs(cookie.expires-Date.now()/1000-28800)<20)
 assert.doesNotMatch(await page.evaluate(()=>document.cookie),/__Host-vinyl/)
 for(const method of ['GET','HEAD']) assert.equal(await page.evaluate(async method=>(await fetch('/api/auth/logout',{method})).status,method),405)
 assert.equal((await page.evaluate(async()=>(await (await fetch('/api/auth/me')).json()))).isLoggedIn,true)
 const cookieHeader=`${cookie.name}=${cookie.value}`
 let logouts=0;page.on('request',r=>{if(r.url().includes('/api/auth/logout')&&r.method()==='POST')logouts++})
 await page.reload();await page.waitForFunction(()=>document.getElementById('logout-btn').style.display==='inline')
 await page.evaluate(()=>{document.getElementById('logout-btn').click();document.getElementById('logout-btn').click()})
 await page.waitForFunction(()=>document.getElementById('greeting').textContent==='Welcome, Guest!')
 assert.equal(logouts,1)
 assert.equal((await context.cookies()).some(c=>c.name==='__Host-vinyl.sid'),false)
 assert.deepEqual((await child.request('/api/auth/me',{headers:{Cookie:cookieHeader,'X-Forwarded-Proto':'https'}})).body,{isLoggedIn:false})
 // Non-localhost mapped hostname avoids the browser's special HTTP localhost cookie exception.
 await context.addCookies([cookie])
 const httpPage=await context.newPage()
 const httpOrigin=`http://vinyl.test:${new URL(child.baseUrl).port}`
 const observed=httpPage.waitForRequest(httpOrigin+'/api/auth/me')
 const response=await httpPage.goto(httpOrigin+'/api/auth/me')
 const sent=(await (await observed).allHeaders()).cookie
 assert.equal(response.status(),400);assert.equal(sent,undefined)
})
