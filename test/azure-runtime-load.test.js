import assert from 'node:assert/strict'
import { test } from 'node:test'

if (process.env.RUN_AZURE_VM_RUNTIME_LOAD === '1') {
  test('isolated Azure VM workload remains executable and covered', { timeout: 240_000 }, async () => {
    await import('../scripts/azure/runtime-load.js')
    assert.notEqual(process.exitCode, 1, 'The runtime workload must complete successfully')
  })
}
