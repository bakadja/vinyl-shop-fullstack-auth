import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import http from 'node:http'
import { postgresFixture } from '../test-support/postgresql.js'
import { initializeSessions } from '../sessions/schema.js'
import { initializeDatabase } from '../scripts/init-db.js'
import { startSessionProcess } from '../test-support/session-process.js'
const serverFile=fileURLToPath(new URL('../server.js',import.meta.url))
test('startup rejects missing/weak session configuration before listening without exposing input', () => {
  for(const secret of ['', 'synthetic-sensitive-value']) {
    const result=spawnSync(process.execPath,[serverFile],{env:{SPIRAL_SESSION_SECRET:secret},encoding:'utf8',timeout:3000})
    assert.notEqual(result.status,0)
    assert.doesNotMatch(result.stdout,/Server running/)
    assert.doesNotMatch(result.stderr,/synthetic-sensitive-value/)
  }
})
test('production verifies DB TLS and rejects spoofed or ambiguous protocol before session writes', async t => {
  const hooks=[]; t.after(async()=>{for(const hook of hooks) await hook()})
  const f=await postgresFixture(t)
  await initializeDatabase(f.database); await initializeSessions(f.database)
  assert.ok(process.env.TEST_DATABASE_CA_FILE,'Verified test CA must be provisioned')
  const overrides={NODE_ENV:'production',PGSSLMODE:'verify-full',PGSSLROOTCERT:process.env.TEST_DATABASE_CA_FILE,SESSION_PROXY_MODE:'verified-proxy',TRUSTED_PROXY_CIDRS:'127.0.0.1/32',PUBLIC_ORIGIN:'https://shop.example'}
  const child=await startSessionProcess({after:fn=>hooks.push(fn)},{childEnv:f.childEnv,cwd:f.directory,overrides})
  for(const protocol of [undefined,'http','https,http','garbage']) {
    const r=await child.request('/api/auth/register',{method:'POST',body:{},headers:protocol?{'X-Forwarded-Proto':protocol}:{}})
    assert.equal(r.status,400);assert.deepEqual(r.body,{error:'HTTPS required'});assert.equal(r.setCookies.length,0)
  }
  assert.equal((await child.request('/api/auth/me',{headers:{'X-Forwarded-Proto':'https'}})).status,200)
  const duplicate=await new Promise((resolve,reject)=>{
    const req=http.request(child.baseUrl+'/api/auth/me',{headers:['X-Forwarded-Proto','https','x-forwarded-proto','https']},res=>{res.resume();res.on('end',()=>resolve(res.statusCode))});req.on('error',reject);req.end()
  })
  assert.equal(duplicate,400)
  for (const Origin of [undefined, 'null', 'https://evil.example']) {
    const r = await child.request('/api/auth/logout', { method: 'POST', body: {}, headers: { 'X-Forwarded-Proto': 'https', ...(Origin === undefined ? {} : { Origin }) } })
    assert.equal(r.status, 403)
  }
  const untrusted=await startSessionProcess({after:fn=>hooks.push(fn)},{childEnv:f.childEnv,cwd:f.directory,overrides:{...overrides,TRUSTED_PROXY_CIDRS:'::1/128'}})
  assert.equal((await untrusted.request('/api/auth/me',{headers:{'X-Forwarded-Proto':'https'}})).status,400)
  assert.equal((await f.database.query('SELECT count(*) FROM user_sessions')).rows[0].count,'0')
})
