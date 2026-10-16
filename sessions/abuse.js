import { createHmac } from 'node:crypto'
import { isIP, SocketAddress } from 'node:net'

export function abuseKey(env = process.env) {
  const key = env.AUTH_ABUSE_HMAC_KEY
  if (!/^[0-9a-f]{64}$/.test(key ?? '') || new Set(key).size < 8) throw new Error('Invalid abuse configuration')
  return Buffer.from(key, 'hex')
}

// Direct peers are authoritative unless they match the configured local proxy.
// Caddy overwrites X-Forwarded-For from its direct socket peer; ambiguous values fail closed.
export function peerIdentity(address) {
  const version = isIP(address)
  if (!version) return 'unknown-peer'
  if (version === 4) return address
  const canonical = new SocketAddress({ address, family: 'ipv6' }).address
  if (canonical.startsWith('::ffff:')) return canonical.slice(7)
  const [left, right = ''] = canonical.split('::')
  const head = left ? left.split(':') : []
  const tail = right ? right.split(':') : []
  const expanded = [...head, ...new Array(8 - head.length - tail.length).fill('0'), ...tail]
  return expanded.slice(0, 4).map(part => part.padStart(4, '0')).join(':') + '::/64'
}

export function requestPeerIdentity(remoteAddress, rawHeaders = [], trustPeer = () => false) {
  if (!trustPeer(remoteAddress)) return peerIdentity(remoteAddress)
  const forwarded = []
  for (let index = 0; index < rawHeaders.length; index += 2) {
    if (rawHeaders[index].toLowerCase() === 'x-forwarded-for') forwarded.push(rawHeaders[index + 1])
  }
  if (forwarded.length !== 1 || forwarded[0] !== forwarded[0].trim() || !isIP(forwarded[0])) {
    throw new Error('Invalid trusted proxy identity')
  }
  return peerIdentity(forwarded[0])
}

const policies = {
  login: { burst: [20, 10], global: [120, 60], peer: [60, 900], pair: [10, 900] },
  register: { burst: [5, 60], global: [30, 3600], peer: [10, 3600], pair: [3, 3600] }
}
export function counterKeys(key, endpoint, peer, username) {
  const normalized = typeof username === 'string' && username.length <= 1024 ? username.trim() : '<invalid>'
  return Object.entries(policies[endpoint]).map(([dimension, [limit, seconds]]) => ({
    key: createHmac('sha256', key).update(JSON.stringify(['auth-abuse-v1', endpoint, dimension,
      ...(dimension === 'peer' || dimension === 'pair' ? [peer] : []), ...(dimension === 'pair' ? [normalized] : [])])).digest('hex'),
    limit, seconds
  }))
}

export async function consumeAttempt(database, counters) {
  return database.transaction(async client => {
    await client.query("SET LOCAL lock_timeout='2s'")
    await client.query("SET LOCAL statement_timeout='3s'")
    // One schema-wide admission lock bounds row growth and serializes all workers.
    // The lock is released before bcrypt; no application/user/session data is locked.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended(current_database() || ':' || current_schema() || ':auth-abuse-v1', 0))")
    const now = (await client.query('SELECT clock_timestamp() AS now')).rows[0].now
    await client.query(`DELETE FROM auth_abuse_counters WHERE key IN
      (SELECT key FROM auth_abuse_counters WHERE expires_at <= $1 ORDER BY expires_at LIMIT 500)`, [now])
    // Hard ceiling also bounds storage after key rotation or deliberate random identifiers.
    const { rows: [storage] } = await client.query(`SELECT count(*) AS total, count(*) FILTER (WHERE key=ANY($1::text[])) AS existing
      FROM auth_abuse_counters`, [counters.map(counter => counter.key)])
    if (Number(storage.total) + counters.length - Number(storage.existing) > 10000) return { allowed: false, retryAfter: 60 }
    for (const counter of counters) {
      const expires = new Date(now.getTime() + counter.seconds * 1000)
      const { rows } = await client.query(`INSERT INTO auth_abuse_counters AS c(key, attempts, expires_at) VALUES ($1,1,$2)
        ON CONFLICT(key) DO UPDATE SET
          attempts=CASE WHEN c.expires_at <= $3 THEN 1 ELSE LEAST(c.attempts+1,$4+1) END,
          expires_at=CASE WHEN c.expires_at <= $3 THEN $2 ELSE c.expires_at END
        RETURNING attempts, expires_at`, [counter.key, expires, now, counter.limit])
      if (rows[0].attempts > counter.limit) return { allowed: false, retryAfter: Math.max(1, Math.ceil((rows[0].expires_at - now) / 1000)) }
    }
    return { allowed: true }
  })
}

export function authenticationAbuse(database, key, trustPeer = () => false) {
  return async (req, res, next) => {
    const endpoint = req.path.toLowerCase().replace(/\/$/, '').slice(1)
    if (req.method !== 'POST' || !Object.hasOwn(policies, endpoint)) return next()
    try {
      const peer = requestPeerIdentity(req.socket.remoteAddress, req.rawHeaders, trustPeer)
      const result = await consumeAttempt(database, counterKeys(key, endpoint, peer, req.body?.username))
      if (result.allowed) return next()
      res.status(429).set({ 'Retry-After': String(result.retryAfter), 'Cache-Control': 'no-store' }).json({ error: 'Too many authentication attempts. Please try again later.' })
    } catch {
      // No raw error, address, username, cookie or PostgreSQL configuration is logged.
      res.status(503).set({ 'Retry-After': '5', 'Cache-Control': 'no-store' }).json({ error: 'Authentication temporarily unavailable. Please try again later.' })
    }
  }
}
