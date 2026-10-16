import { test } from 'node:test'
import { runRestoreDrill } from '../test-support/azure-restore-drill.js'

test('logical restore preserves fictional data and revokes resurrected sessions', async () => {
  const originalPath = process.env.PATH
  process.env.PATH = '/nonexistent-vinyl-tools'
  try { await runRestoreDrill() } finally { process.env.PATH = originalPath }
})
