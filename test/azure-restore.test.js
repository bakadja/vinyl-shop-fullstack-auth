import { test } from 'node:test'
import { runRestoreDrill } from '../test-support/azure-restore-drill.js'

test('logical restore preserves fictional data and revokes resurrected sessions', async () => {
  await runRestoreDrill()
})
