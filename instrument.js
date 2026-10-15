// ESM preload: evaluated before Express, PostgreSQL, routes and session modules.
import { readFileSync } from 'node:fs'
import { initializeTelemetry } from './telemetry/sentry.js'
let release = process.env.SENTRY_RELEASE
try {
  // Immutable artifact metadata is authoritative when running a packaged Azure release.
  release = JSON.parse(readFileSync(new URL('./release.json', import.meta.url), 'utf8')).release
} catch { /* Source checkouts use an explicitly supplied SENTRY_RELEASE. */ }
initializeTelemetry({ ...process.env, SENTRY_RELEASE: release })
