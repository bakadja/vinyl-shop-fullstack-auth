import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { test } from 'node:test'
import { promisify } from 'node:util'

const run = promisify(execFile)
const scriptUrl = new URL('../scripts/configure-ci-test-tls.js', import.meta.url).href

// Evaluate the real entry point with isolated external dependencies. A child
// process enables VM modules without changing the normal npm test command.
async function inspectEndpoint(scriptUrl, databaseUrl) {
  const { readFile } = await import('node:fs/promises')
  const { promisify } = await import('node:util')
  const vm = await import('node:vm')
  const { testTarget } = await import(new URL('../test-support/postgresql.js', scriptUrl))
  const calls = [], messages = []
  const processState = { env: {
    GITHUB_ACTIONS: 'true', POSTGRES_SERVICE_ID: 'a'.repeat(64),
    GITHUB_ENV: '/synthetic/github-env', TEST_DATABASE_URL: databaseUrl,
    PGPASSWORD: 'synthetic-admin-secret'
  }, exitCode: 0 }
  const block = operation => {
    calls.push(operation)
    throw new Error('External operation blocked by test adapter')
  }
  const execFile = () => block('docker')
  execFile[promisify.custom] = async () => block('docker')
  class Client { constructor() { block('database') } }
  const dependencies = {
    '../test-support/postgresql.js': { testTarget, verifyTestServer: async () => block('database-guard') },
    'node:child_process': { execFile },
    'node:util': { promisify },
    'node:fs/promises': { readFile: async () => block('read-file'), appendFile: async () => block('append-file') },
    '../test-support/certificates.js': { createTestCertificates: async () => block('generate-certificates') },
    '../test-support/ci-certificates.js': { installContainerCertificates: async () => block('install-certificates') },
    pg: { default: { Client } }
  }
  const context = vm.createContext({ process: processState, console: { error: message => messages.push(message) }, setTimeout })
  const entry = new vm.SourceTextModule(await readFile(new URL(scriptUrl), 'utf8'), { context })
  await entry.link(async name => {
    const exports = dependencies[name]
    if (!exports) throw new Error('Unexpected dependency: ' + name)
    return new vm.SyntheticModule(Object.keys(exports), function () {
      for (const [key, value] of Object.entries(exports)) this.setExport(key, value)
    }, { context })
  })
  await entry.evaluate()
  console.log(JSON.stringify({ calls, messages, exitCode: processState.exitCode }))
}

async function inspectHost(host) {
  const databaseUrl = `postgresql://vinyl_shop_test:synthetic-test-secret@${host}:5432/vinyl_shop_test`
  const { stdout } = await run(process.execPath, [
    '--experimental-vm-modules', '--input-type=module', '-e',
    `(${inspectEndpoint.toString()})(process.argv[1], process.argv[2])`, scriptUrl, databaseUrl
  ], { timeout: 10_000 })
  return JSON.parse(stdout)
}

test('CI TLS rejects IPv6 before any Docker, database or certificate operation', async () => {
  const result = await inspectHost('[::1]')
  assert.equal(result.exitCode, 1)
  assert.deepEqual(result.calls, [])
  assert.equal(result.messages.length, 1)
  assert.doesNotMatch(result.messages.join(' '), /synthetic-(?:test|admin)-secret|postgresql:\/\//)
})

test('CI TLS endpoint adapter observes Docker verification for the exact IPv4 service', async () => {
  const result = await inspectHost('127.0.0.1')
  assert.deepEqual(result.calls, ['docker'])
})
