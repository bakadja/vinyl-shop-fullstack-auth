import assert from 'node:assert/strict'
import { test } from 'node:test'

// Removing the output allowlist must expose the hostile fields and fail this test.
test('telemetry rebuilds hostile events without retaining any free-form data', async () => {
  const { sanitizeEvent } = await import('../telemetry/sentry.js')
  const marker = 'fictional-private-value@example.invalid'
  const input = {
    event_id: 'a'.repeat(32), timestamp: 123, level: 'fatal', message: marker,
    exception: { values: [{ type: marker, value: marker, stacktrace: { frames: [{ filename: marker, function: marker, vars: { marker }, context_line: marker }] } }] },
    request: { url: marker, headers: { cookie: marker }, data: marker },
    user: { email: marker }, breadcrumbs: [{ message: marker }], contexts: { trace: { trace_id: marker } },
    extra: { sql: marker }, tags: { operation: marker }, server_name: marker,
    sdkProcessingMetadata: { marker }, attachments: [{ data: marker }]
  }
  const safe = sanitizeEvent(input, { environment: 'test', release: 'b'.repeat(40) })
  assert.doesNotMatch(JSON.stringify(safe), /fictional-private|stacktrace|request|breadcrumbs|contexts|server_name/)
  assert.equal(safe.release, 'b'.repeat(40))
  assert.equal(safe.environment, 'test')
  assert.equal(safe.exception.values[0].type, 'BackendFailure')
  assert.equal(safe.level, 'fatal')
  assert.equal(safe.tags.operation, 'unhandled')
})

test('expected HTTP failures never become incidents; invalid metadata cannot enter events', async () => {
  const { filterEvent, telemetryConfig } = await import('../telemetry/sentry.js')
  for (const status of [400, 401, 403, 404, 413, 429]) {
    assert.equal(filterEvent({}, { originalException: { status } }, {}), null)
  }
  assert.equal(telemetryConfig({ SENTRY_DSN: 'malformed' }), null)
  assert.equal(telemetryConfig({}), null)
  assert.equal(telemetryConfig({ SENTRY_DSN: 'http://local@127.0.0.1:1/1', SENTRY_ENVIRONMENT: 'private@example.invalid', SENTRY_RELEASE: 'b'.repeat(40) }), null)
  assert.equal(telemetryConfig({ SENTRY_DSN: 'http://local@127.0.0.1:1/1', SENTRY_ENVIRONMENT: 'test', SENTRY_RELEASE: 'private@example.invalid' }), null)
})

test('operator probe refuses unreviewed settings and production without exposing configuration', async () => {
  const { spawnSync } = await import('node:child_process')
  for (const extra of [{}, { SENTRY_PROBE_APPROVED: 'yes', SENTRY_PRIVACY_REVIEWED: 'yes', SENTRY_QUOTA_REVIEWED: 'yes',
    SENTRY_ZERO_SPEND_CONFIRMED: 'yes', SENTRY_PROBE_PROJECT: 'baki-dev/vinyl-shop-api', NODE_ENV: 'production' }]) {
    const result = spawnSync(process.execPath, [new URL('../scripts/sentry-probe.js', import.meta.url).pathname], {
      env: { SENTRY_DSN: 'http://local@127.0.0.1:1/1', SENTRY_RELEASE: 'b'.repeat(40), SENTRY_ENVIRONMENT: 'test', ...extra }, encoding: 'utf8'
    })
    assert.equal(result.status, 1)
    assert.equal(result.stdout, '')
    assert.match(result.stderr, /^Probe blocked\./)
    assert.doesNotMatch(result.stderr, /local@|127\.0\.0\.1/)
  }
})
