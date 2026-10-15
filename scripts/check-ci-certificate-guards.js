// Runs real Linux filesystem predicates inside the disposable CI service.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { installContainerCertificates } from '../test-support/ci-certificates.js'
const run = promisify(execFile)
const container = process.env.POSTGRES_SERVICE_ID
if (process.env.GITHUB_ACTIONS !== 'true' || !/^[a-f0-9]{12,64}$/.test(container ?? '')) throw new Error('Disposable CI service required')
const image = await run('docker', ['inspect', '--format', '{{.Config.Image}}', container])
if (image.stdout.trim() !== 'postgres:17') throw new Error('Unexpected service')
const root = (...args) => run('docker', ['exec', '-u', '0', container, ...args])
async function rejectUnsafe(kind) {
  let directory, copies = 0, injected = false
  try {
    await assert.rejects(installContainerCertificates(container, {}, async (file, args) => {
      if (args[0] === 'cp') copies++
      if (!directory) {
        const result = await run(file, args)
        directory = result.stdout.trim()
        assert.match(directory, /^\/run\/vinyl-test-tls\.[A-Za-z0-9]{8}$/)
        if (kind === 'permissions') await root('chmod', '777', directory)
        if (kind === 'ownership') await root('chown', 'postgres:postgres', directory)
        return result
      }
      if (!injected && args.includes('verify-new-tls-file')) {
        injected = true
        if (kind === 'existing') await root('touch', directory + '/server.pem')
        if (kind === 'symlink') await root('ln', '-s', '/dev/null', directory + '/server.pem')
      }
      return run(file, args)
    }))
    assert.equal(copies, 0)
  } finally {
    // Only the newly allocated root-owned-parent path, with fixed leaf names.
    if (directory && /^\/run\/vinyl-test-tls\.[A-Za-z0-9]{8}$/.test(directory)) {
      await root('rm', '-f', '--', directory + '/server.pem', directory + '/server.key')
      await root('rmdir', '--', directory).catch(error => { if (!String(error.stderr).includes('No such file')) throw error })
    }
  }
}
await rejectUnsafe('permissions')
await rejectUnsafe('ownership')
await rejectUnsafe('existing')
await rejectUnsafe('symlink')
console.log('Four real container filesystem guard cases passed')
