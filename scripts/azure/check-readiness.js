import { readFile } from 'node:fs/promises'
import { assertReadiness, assertConfiguration } from './guards.js'
try {
  assertReadiness(JSON.parse(await readFile(new URL('../../infra/azure/readiness.json', import.meta.url), 'utf8')))
  assertConfiguration(JSON.parse(await readFile(new URL('../../infra/azure/configuration.json', import.meta.url), 'utf8')))
  console.log('Reviewed deployment gates passed')
} catch {
  console.error('Deployment blocked. See infra/azure/readiness.json and docs/azure-deployment.md.')
  process.exitCode = 1
}
