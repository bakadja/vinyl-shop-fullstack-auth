import { readFileSync } from 'node:fs'

const loopback = host => ['127.0.0.1', '::1', 'localhost'].includes(host)

export function databaseConfig(env = process.env) {
  let host = env.PGHOST
  let port = env.PGPORT ?? '5432'
  let database = env.PGDATABASE
  let user = env.PGUSER
  let password = env.PGPASSWORD
  let mode = env.PGSSLMODE ?? 'verify-full'
  if (env.DATABASE_URL) {
    let url
    try { url = new URL(env.DATABASE_URL) } catch { throw new Error('Invalid PostgreSQL configuration') }
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hash) throw new Error('Invalid PostgreSQL configuration')
    for (const [key, value] of url.searchParams) {
      if (key !== 'sslmode' || value !== 'verify-full' || env.PGSSLMODE && env.PGSSLMODE !== value) {
        throw new Error('Unsupported PostgreSQL connection options')
      }
      mode = value
    }
    try {
      host = url.hostname.replace(/^\[|\]$/g, '')
      port = url.port || '5432'
      database = decodeURIComponent(url.pathname.slice(1))
      user = decodeURIComponent(url.username)
      password = decodeURIComponent(url.password)
    } catch { throw new Error('Invalid PostgreSQL configuration') }
  }
  if (![host, database, user, password].every(value => typeof value === 'string' && value.length > 0) || !/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    throw new Error('Incomplete PostgreSQL configuration')
  }
  if (!['disable', 'verify-full'].includes(mode) || mode === 'disable' && (!loopback(host) || env.NODE_ENV === 'production')) {
    throw new Error('PostgreSQL requires verified TLS outside local development')
  }
  const schema = env.DATABASE_SCHEMA ?? 'public'
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw new Error('Invalid PostgreSQL schema')
  let ssl = false
  if (mode === 'verify-full') {
    ssl = { rejectUnauthorized: true }
    if (env.PGSSLROOTCERT) {
      try { ssl.ca = readFileSync(env.PGSSLROOTCERT, 'utf8') } catch { throw new Error('Unable to load PostgreSQL CA certificate') }
    }
  }
  return { host, port: Number(port), database, user, password, ssl, max: 5,
    connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000,
    options: `-c search_path=${schema}`, application_name: 'vinyl-shop' }
}
