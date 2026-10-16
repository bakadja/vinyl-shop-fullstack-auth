import assert from 'node:assert/strict'
import { test } from 'node:test'

if (process.env.RUN_AZURE_VM_RUNTIME_LOAD === '1') {
  test('isolated Azure VM workload remains executable and covered', { timeout: 240_000 }, async () => {
    const output = []
    const originalLog = console.log
    console.log = (...values) => output.push(values.join(' '))
    try {
      await import('../scripts/azure/runtime-load.js')
    } finally {
      console.log = originalLog
    }
    assert.notEqual(process.exitCode, 1, `The runtime workload must complete successfully: ${output.join(' | ')}`)
    const report = output.join('\n')
    process.stdout.write(`${report}\n`)
    assert.match(report, /Bounded login response counts: 401=20, 429=1, 5xx=0/)
    assert.match(report, /Exceptional 24-way overload response counts:/)
    assert.match(report, /Valid-account 24-way overload response counts: 200=\d+, 429=\d+, 503=\d+, 500=0/)
    assert.match(report, /Valid-account 24-way overload diagnostics: 503=\d+, login-backpressure=\d+, unexpected-login-failures=0, persisted-sessions=\d+/)
  })
}
