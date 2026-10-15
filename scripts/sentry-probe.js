// Operator-only CLI, deliberately excluded from the deployed runtime artifact.
import { telemetryConfig, captureFailure, flushTelemetry, initializeTelemetry } from '../telemetry/sentry.js'
const env = process.env
const approved = env.SENTRY_PROBE_APPROVED === 'yes' && env.SENTRY_PRIVACY_REVIEWED === 'yes' &&
  env.SENTRY_QUOTA_REVIEWED === 'yes' && env.SENTRY_ZERO_SPEND_CONFIRMED === 'yes'
const config = telemetryConfig(env)
if (process.argv.length !== 2 || !approved || !config || !['test', 'staging'].includes(config.environment) ||
    env.NODE_ENV === 'production' || env.SENTRY_PROBE_PROJECT !== 'baki-dev/vinyl-shop-api') {
  console.error('Probe blocked. Review docs/sentry-backend.md; no event was sent.')
  process.exitCode = 1
} else {
  initializeTelemetry(env)
  const id = captureFailure('synthetic')
  const flushed = await flushTelemetry()
  if (!id || !flushed) {
    console.error('Probe could not be flushed; do not retry until the project has been checked.')
    process.exitCode = 1
  } else {
    console.log(`Probe event ID: ${id}. Verify exactly one received event in the approved project; flushing is not proof of delivery.`)
  }
}
