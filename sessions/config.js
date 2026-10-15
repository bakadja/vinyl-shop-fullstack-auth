import { isIP } from 'node:net'
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
export function sessionConfig(env = process.env) {
  const environment = env.NODE_ENV ?? 'development'
  if (!['development', 'test', 'production'].includes(environment)) fail()
  const production = environment === 'production'
  let previous
  try { previous = JSON.parse(env.SPIRAL_SESSION_PREVIOUS_SECRETS ?? '[]') } catch { fail() }
  if (!Array.isArray(previous) || previous.length > 2) fail()
  const secrets = [env.SPIRAL_SESSION_SECRET, ...previous]
  if (!secrets.every(validKey) || new Set(secrets).size !== secrets.length) fail()
  for (const suffix of ['SECURE', 'HTTP_ONLY', 'SAME_SITE', 'DOMAIN', 'NAME']) if (env[`SESSION_COOKIE_${suffix}`] !== undefined) fail()
  if (env.SESSION_ROLLING !== undefined) fail()
  const proxyMode = env.SESSION_PROXY_MODE ?? 'direct'
  if (!['direct', 'verified-proxy'].includes(proxyMode) || production && proxyMode !== 'verified-proxy') fail()
  let trustPeer = () => false
  if (proxyMode === 'verified-proxy') {
    const ranges = (env.TRUSTED_PROXY_CIDRS ?? '').split(',').map(value => value.trim())
    if (ranges.some(value => {
      const [address, prefix, extra] = value.split('/')
      const version = isIP(address)
      return !version || extra !== undefined || !/^\d+$/.test(prefix ?? '') || Number(prefix) < (version === 4 ? 24 : 64) || Number(prefix) > (version === 4 ? 32 : 128)
    })) fail()
    let compiled
    try { compiled = proxyaddr.compile(ranges) } catch { fail() }
    trustPeer = address => { try { return compiled(address) } catch { return false } }
  }
  return { environment, secrets, schema: databaseSchema(env), origin: origin(env.PUBLIC_ORIGIN ?? (production ? '' : 'http://localhost:8000'), production), proxyMode, trustPeer,
    cookieName: production ? '__Host-vinyl.sid' : 'connect.sid', lifetimeMs: 28_800_000,
    cookie: { httpOnly: true, secure: production, sameSite: 'lax', path: '/', maxAge: 28_800_000 } }
}
