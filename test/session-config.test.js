import assert from 'node:assert/strict'
import { test } from 'node:test'
import { randomBytes } from 'node:crypto'
import { sessionConfig } from '../sessions/config.js'
const key = () => randomBytes(32).toString('hex')
const production = () => ({ NODE_ENV: 'production', SPIRAL_SESSION_SECRET: key(), SESSION_PROXY_MODE: 'verified-proxy', TRUSTED_PROXY_CIDRS: '127.0.0.1/32', PUBLIC_ORIGIN: 'https://shop.example' })
test('explicit strong configuration selects secure cookies and current-first rotation', () => {
  const env = production(), previous = key()
  env.SPIRAL_SESSION_PREVIOUS_SECRETS = JSON.stringify([previous])
  const config = sessionConfig(env)
  assert.deepEqual(config.secrets, [env.SPIRAL_SESSION_SECRET, previous])
  assert.equal(config.cookieName, '__Host-vinyl.sid')
  assert.deepEqual(config.cookie, { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 28_800_000 })
  assert.equal(config.trustPeer('::ffff:127.0.0.1'), true)
  assert.equal(config.trustPeer('192.0.2.1'), false)
  const local = sessionConfig({ SPIRAL_SESSION_SECRET: key() })
  assert.equal(local.cookieName, 'connect.sid')
  assert.equal(local.cookie.secure, false)
  assert.equal(local.trustPeer('127.0.0.1'), false)
})
test('invalid keys and unsafe production inputs fail without echoing values', () => {
  for (const secret of [undefined, '', 'jellyfish-baskingshark', 'a'.repeat(64), 'ab'.repeat(32), key().toUpperCase(), 'x'.repeat(64)]) {
    assert.throws(() => sessionConfig({ SPIRAL_SESSION_SECRET: secret }), /^Error: Invalid session configuration$/)
  }
  for (const change of [{ NODE_ENV: 'prod' }, { SESSION_PROXY_MODE: 'direct' }, { PUBLIC_ORIGIN: 'http://shop.example' }, { PUBLIC_ORIGIN: 'https://x/path' }, { PUBLIC_ORIGIN: 'https://user:pass@x' }, { TRUSTED_PROXY_CIDRS: '' }, { TRUSTED_PROXY_CIDRS: '0.0.0.0/0' }, { TRUSTED_PROXY_CIDRS: '10.0.0.0/8' }, { TRUSTED_PROXY_CIDRS: 'uniquelocal' }, { SESSION_COOKIE_SECURE: 'false' }]) assert.throws(() => sessionConfig({ ...production(), ...change }))
  for (const previous of ['null', '{}', 'invalid', JSON.stringify([key(), key(), key()]), JSON.stringify([null])]) assert.throws(() => sessionConfig({ ...production(), SPIRAL_SESSION_PREVIOUS_SECRETS: previous }))
  const env = production()
  assert.throws(() => sessionConfig({ ...env, SPIRAL_SESSION_PREVIOUS_SECRETS: JSON.stringify([env.SPIRAL_SESSION_SECRET]) }))
})
test('broad explicit networks cannot impersonate a narrowly trusted proxy',()=>{
 for(const range of ['0.0.0.0/1','128.0.0.0/1','::/1','8000::/1','10.0.0.0/9']) assert.throws(()=>sessionConfig({...production(),TRUSTED_PROXY_CIDRS:range}))
})
