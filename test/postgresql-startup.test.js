import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

test('native PostgreSQL startup failure exits before tests and cleans temporary paths containing spaces', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'vinyl startup failure '))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const result = spawnSync('bash', [fileURLToPath(new URL('../scripts/start-test-postgres.sh', import.meta.url)), process.execPath, '-e', 'console.log("TEST_COMMAND_RAN")'], {
    env: { PATH: process.env.PATH, TMPDIR: directory, PG_TEST_BIN: join(directory, 'missing PostgreSQL binaries') },
    encoding: 'utf8', timeout: 5000
  })
  assert.ok(Number.isInteger(result.status) && result.status !== 0, 'Startup must fail with a nonzero exit code before the test command runs')
  assert.doesNotMatch(result.stdout, /TEST_COMMAND_RAN/)
  assert.deepEqual(await readdir(directory), [])
})
