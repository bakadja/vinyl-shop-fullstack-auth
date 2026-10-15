import { isIP, SocketAddress } from 'node:net'
import proxyaddr from 'proxy-addr'
import { databaseSchema } from '../db/config.js'
const fail = () => { throw new Error('Invalid session configuration') }
function validKey(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) return false
  return ![2, 4, 8, 16].some(size => value.slice(0, size).repeat(64 / size) === value)
}
function origin(value, production) {
  let url
  try { url = new URL(value) } catch { return fail() }
  if (!['http:', 'https:'].includes(url.protocol) || production && url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) fail()
  return url.origin
}
function parseEnvironment(env) {
  const value = env.NODE_ENV ?? 'development'
  if (!['development', 'test', 'production'].includes(value)) fail()
  return value
}
function parseSecrets(env) {
  let previous
  try { previous = JSON.parse(env.SPIRAL_SESSION_PREVIOUS_SECRETS ?? '[]') } catch { fail() }
  if (!Array.isArray(previous) || previous.length > 2) fail()
  const secrets = [env.SPIRAL_SESSION_SECRET, ...previous]
  if (!secrets.every(validKey) || new Set(secrets).size !== secrets.length) fail()
  return secrets
}
function rejectOverrides(env) {
  const names = ['SESSION_COOKIE_SECURE', 'SESSION_COOKIE_HTTP_ONLY', 'SESSION_COOKIE_SAME_SITE', 'SESSION_COOKIE_DOMAIN', 'SESSION_COOKIE_NAME', 'SESSION_ROLLING']
  if (names.some(name => env[name] !== undefined)) fail()
}
function invalidRange(value) {
  const [address, prefix, extra] = value.split('/')
  const version = isIP(address)
  if (version === 6 && new SocketAddress({ address, family: 'ipv6' }).address.startsWith('::ffff:')) return true
  return !version || extra !== undefined || !/^\d+$/.test(prefix ?? '') || Number(prefix) < (version === 4 ? 24 : 64) || Number(prefix) > (version === 4 ? 32 : 128)
}
function trustPredicate(env, mode) {
  if (mode === 'direct') return () => false
  const ranges = (env.TRUSTED_PROXY_CIDRS ?? '').split(',').map(value => value.trim())
  if (ranges.some(invalidRange)) fail()
  let compiled
  try { compiled = proxyaddr.compile(ranges) } catch { fail() }
  return address => { try { return compiled(address) } catch { return false } }
}
function parseProxyMode(env, production) {
  const mode = env.SESSION_PROXY_MODE ?? 'direct'
  if (!['direct', 'verified-proxy'].includes(mode) || production && mode !== 'verified-proxy') fail()
  return mode
}
export function sessionConfig(env = process.env) {
  const environment = parseEnvironment(env)
  const production = environment === 'production'
  const secrets = parseSecrets(env)
  rejectOverrides(env)
  const proxyMode = parseProxyMode(env, production)
  return { environment, secrets, schema: databaseSchema(env), origin: origin(env.PUBLIC_ORIGIN ?? (production ? '' : 'http://localhost:8000'), production), proxyMode, trustPeer: trustPredicate(env, proxyMode),
    cookieName: production ? '__Host-vinyl.sid' : 'connect.sid', lifetimeMs: 28_800_000,
    cookie: { httpOnly: true, secure: production, sameSite: 'lax', path: '/', maxAge: 28_800_000 } }
}
