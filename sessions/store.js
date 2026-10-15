import session from 'express-session'
import connectPgSimple from 'connect-pg-simple'
const PgStore = connectPgSimple(session)
export function createSessionStore({ pool, config }) {
  const queries = new Set()
  // A regenerated express-session instance can be saved again at response end.
  // Remember only acknowledgements for this exact in-flight Session object;
  // never serve reads from memory or reuse acknowledgements across requests.
  const acknowledged = new WeakMap()
  let closing
  let closed = false
  const trackedPool = { query(text, values) {
    if (closed) return Promise.reject(new Error('Session store closed'))
    const pending = Promise.resolve().then(() => pool.query(text, values))
    queries.add(pending)
    pending.then(() => queries.delete(pending), () => queries.delete(pending))
    return pending
  } }
  const store = new PgStore({ pool: trackedPool, schemaName: config.schema, tableName: 'user_sessions',
    createTableIfMissing: false, ttl: 28800, disableTouch: true, pruneSessionInterval: 900,
    errorLog: () => console.error('Session cleanup failed') })
  const set = store.set.bind(store)
  store.set = (sid, value, callback = () => {}) => {
    let snapshot
    if (value.userId !== undefined) {
      const deadline = value.authenticatedAt + config.lifetimeMs
      if (!Number.isSafeInteger(value.authenticatedAt) || !Number.isFinite(deadline)) return callback(new Error('Invalid session identity'))
      value.cookie.expires = new Date(Math.min(new Date(value.cookie.expires).getTime() || deadline, deadline))
      const { cookie, ...identity } = value
      snapshot = JSON.stringify(identity)
      const previous = acknowledged.get(value)
      if (previous?.sid === sid && previous.snapshot === snapshot) {
        process.nextTick(callback, null)
        return
      }
    }
    set(sid, value, error => {
      if (!error && snapshot !== undefined) acknowledged.set(value, { sid, snapshot })
      callback(error)
    })
  }
  return { store, close() {
    closing ??= (async () => {
      await store.close()
      closed = true
      await Promise.allSettled([...queries])
    })()
    return closing
  } }
}
