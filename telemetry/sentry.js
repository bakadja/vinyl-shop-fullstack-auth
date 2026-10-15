import * as Sentry from '@sentry/node'
import http from 'node:http'
import https from 'node:https'

const operations = new Set(['http_5xx', 'startup', 'shutdown', 'database_idle', 'unhandled', 'unhandled_rejection', 'synthetic'])
const environments = new Set(['development', 'test', 'staging', 'production'])
let client
let fatalStopping = false

export function telemetryConfig(env = process.env) {
  if (!env.SENTRY_DSN) return null
  try {
    const dsn = new URL(env.SENTRY_DSN)
    const environment = env.SENTRY_ENVIRONMENT ?? 'development'
    const release = env.SENTRY_RELEASE
    const localTest = environment === 'test' && dsn.hostname === '127.0.0.1'
    if ((!localTest && dsn.protocol !== 'https:') || !['http:', 'https:'].includes(dsn.protocol) ||
        !/^[a-zA-Z0-9]+$/.test(dsn.username) || dsn.password || !/^\/\d+$/.test(dsn.pathname) ||
        dsn.search || dsn.hash || !environments.has(environment) || !/^[a-f0-9]{40}$/.test(release ?? '')) return null
    return { dsn: dsn.href, environment, release }
  } catch { return null }
}

// No original message, type, stack, paths, source lines or arbitrary metadata survive.
// This runs both after SDK scope processing and at the final envelope boundary.
export function sanitizeEvent(event, config) {
  const operation = operations.has(event.tags?.operation) ? event.tags.operation : 'unhandled'
  const fatal = event.level === 'fatal'
  return {
    ...(/^[a-f0-9]{32}$/.test(event.event_id ?? '') ? { event_id: event.event_id } : {}),
    ...(Number.isFinite(event.timestamp) ? { timestamp: event.timestamp } : {}),
    platform: 'node', level: fatal ? 'fatal' : 'error',
    environment: config.environment, release: config.release,
    exception: { values: [{ type: 'BackendFailure', value: `Backend failure: ${operation}`,
      mechanism: { type: 'generic', handled: !fatal } }] },
    tags: { operation }, fingerprint: ['backend', operation]
  }
}
export function filterEvent(event, hint, config) {
  const status = hint?.originalException?.status ?? hint?.originalException?.statusCode
  if (Number.isInteger(status) && status >= 400 && status < 500) return null
  return sanitizeEvent(event, config)
}

// The SDK retains buffering, rate-limit handling and envelope serialization.
// Our executor bounds the full network attempt, including DNS/TLS, and never retries.
function boundedRequest(url, body) {
  return new Promise((resolve, reject) => {
    const request = (url.startsWith('https:') ? https : http).request(url, {
      method: 'POST', agent: false, headers: { 'Content-Type': 'application/x-sentry-envelope' }
    })
    const deadline = setTimeout(() => request.destroy(new Error('Telemetry timeout')), 1000)
    request.once('error', reject)
    request.once('close', () => clearTimeout(deadline))
    request.once('response', response => {
      response.resume()
      resolve({ statusCode: response.statusCode, headers: {
        'retry-after': response.headers['retry-after'], 'x-sentry-rate-limits': response.headers['x-sentry-rate-limits']
      } })
    })
    request.end(body)
  })
}
function privateTransport(options, config) {
  const transport = Sentry.createTransport({ ...options, bufferSize: 16 }, request => boundedRequest(options.url, request.body))
  return {
    send(envelope) {
      // Drop attachments, sessions, traces, profiles, logs, metrics, feedback and client reports.
      const items = envelope[1].filter(([header]) => header.type === 'event').map(([, event]) =>
        [{ type: 'event' }, sanitizeEvent(event, config)])
      if (!items.length) return Promise.resolve({})
      // SDK envelope headers can contain a dynamic sampling context with personal data.
      return transport.send([{ sent_at: new Date().toISOString(), event_id: items[0][1].event_id }, items])
    },
    flush: timeout => transport.flush(timeout)
  }
}
function handleFatal(operation) {
  if (fatalStopping) return
  fatalStopping = true
  captureFailure(operation)
  void fatalExit()
}
async function fatalExit() {
  const deadline = setTimeout(() => process.exit(1), 750)
  try { await flushTelemetry() }
  finally { clearTimeout(deadline); process.exit(1) }
}
export function initializeTelemetry(env = process.env) {
  const config = telemetryConfig(env)
  if (!config || client) return
  try {
    client = Sentry.init({
      ...config, debug: false, spotlight: false, defaultIntegrations: false,
      integrations: [],
      enableOpenTelemetrySetup: false, traceLifecycle: 'static', tracesSampleRate: 0, profilesSampleRate: 0, profileSessionSampleRate: 0,
      enableLogs: false, enableMetrics: false, sendDefaultPii: false, sendClientReports: false,
      maxBreadcrumbs: 0, attachStacktrace: false, includeLocalVariables: false, maxValueLength: 100,
      dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false,
        databaseQueryData: false, stackFrameVariables: false, frameContextLines: 0,
        graphQL: { document: false, variables: false }, genAI: { inputs: false, outputs: false }, queues: false },
      beforeBreadcrumb: () => null, beforeSendLog: () => null, beforeSendMetric: () => null,
      beforeSendTransaction: () => null, beforeSend: (event, hint) => filterEvent(event, hint, config),
      transport: options => privateTransport(options, config)
    })
    // SDK fatal handlers can print raw errors on secondary failures: own both paths.
    process.on('uncaughtException', () => handleFatal('unhandled'))
    process.on('unhandledRejection', () => handleFatal('unhandled_rejection'))
  } catch {
    client = undefined
    console.error('Backend telemetry unavailable; application continues')
  }
}
export function captureFailure(operation) {
  if (!client || !operations.has(operation)) return undefined
  try {
    return Sentry.captureEvent({ level: ['unhandled', 'unhandled_rejection'].includes(operation) ? 'fatal' : 'error', tags: { operation },
      exception: { values: [{ type: 'BackendFailure', value: `Backend failure: ${operation}` }] } })
  } catch { return undefined }
}
export async function flushTelemetry() {
  try { return client ? await client.flush(500) : true }
  catch { return false }
}
export function requestTelemetry(_req, res, next) {
  // One listener per response covers caught controller/store failures as well as next(err).
  res.once('finish', () => { if (res.statusCode >= 500) captureFailure('http_5xx') })
  next()
}
