const postgresCodes = {
  '55P03': 'postgres_lock_timeout',
  '57014': 'postgres_statement_timeout',
  '53300': 'postgres_connection_limit',
  ECONNREFUSED: 'postgres_connection_refused'
}

export function authenticationFailureClass(error) {
  const seen = new Set()
  let current = error
  while (current && !seen.has(current) && seen.size < 4) {
    seen.add(current)
    const code = typeof current.code === 'string' ? current.code : ''
    if (Object.hasOwn(postgresCodes, code)) return postgresCodes[code]
    if (code.startsWith('08')) return 'postgres_connection_error'
    if (current.message === 'timeout exceeded when trying to connect') return 'postgres_pool_acquire_timeout'
    current = current.cause
  }
  return 'unexpected'
}

const retryableDatabaseFailures = new Set([
  'postgres_lock_timeout', 'postgres_statement_timeout', 'postgres_connection_limit',
  'postgres_connection_refused', 'postgres_connection_error', 'postgres_pool_acquire_timeout'
])

export function loginFailureResponse(error) {
  if (retryableDatabaseFailures.has(authenticationFailureClass(error))) {
    return {
      status: 503,
      headers: { 'Retry-After': '5', 'Cache-Control': 'no-store' },
      body: { error: 'Authentication temporarily unavailable. Please try again later.' }
    }
  }
  return {
    status: 500,
    headers: { 'Cache-Control': 'no-store' },
    body: { error: 'Login failed. Please try again.' }
  }
}
