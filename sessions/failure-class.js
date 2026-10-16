const postgresCodes = {
  '55P03': 'postgres_lock_timeout',
  '57014': 'postgres_statement_timeout',
  '53300': 'postgres_connection_limit',
  ECONNREFUSED: 'postgres_connection_refused'
}

export function authenticationFailureClass(error) {
  const code = typeof error?.code === 'string' ? error.code : ''
  if (Object.hasOwn(postgresCodes, code)) return postgresCodes[code]
  if (code.startsWith('08')) return 'postgres_connection_error'
  if (error?.message === 'timeout exceeded when trying to connect') return 'postgres_pool_acquire_timeout'
  return 'unexpected'
}
