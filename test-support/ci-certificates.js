import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const execute = promisify(execFile)
const directoryPattern = /^\/var\/lib\/postgresql\/data\/vinyl-test-tls\.[A-Za-z0-9]{8}$/
const createDirectory = `set -eu
base=/var/lib/postgresql/data
test -d "$base" && test ! -L "$base"
test "$(stat -c '%U:%a' "$base")" = 'postgres:700'
umask 077
mktemp -d "$base/vinyl-test-tls.XXXXXXXX"`
const verifyDirectory = `set -eu
test -d "$1" && test ! -L "$1"
test "$(stat -c '%U:%a' "$1")" = 'postgres:700'`
const verifyAbsent = `set -eu
test ! -e "$1" && test ! -L "$1"`
const verifyFile = `set -eu
test -f "$1" && test ! -L "$1"
test "$(stat -c '%U:%G:%a:%h' "$1")" = 'postgres:postgres:600:1'`

function verifyPrivateDirectory(run, container, directory) {
  return run('docker', ['exec', '-u', 'postgres', container, 'sh', '-c', verifyDirectory, 'verify-private-tls', directory])
}
async function copyCertificate(run, container, directory, source, name) {
  await verifyPrivateDirectory(run, container, directory)
  const destination = directory + '/' + name
  await run('docker', ['exec', '-u', 'postgres', container, 'sh', '-c', verifyAbsent, 'verify-new-tls-file', destination])
  await run('docker', ['cp', source, container + ':' + destination])
  await run('docker', ['exec', '-u', '0', container, 'chown', 'postgres:postgres', destination])
  await run('docker', ['exec', '-u', 'postgres', container, 'chmod', '600', destination])
  await run('docker', ['exec', '-u', 'postgres', container, 'sh', '-c', verifyFile, 'verify-private-tls-file', destination])
}
async function removePartialInstallation(run, container, directory) {
  await verifyPrivateDirectory(run, container, directory)
  // Fixed filenames only; rm does not follow a substituted file symlink.
  await run('docker', ['exec', '-u', '0', container, 'rm', '-f', '--', directory + '/server.pem', directory + '/server.key'])
  await run('docker', ['exec', '-u', 'postgres', container, 'rmdir', '--', directory])
}
export async function installContainerCertificates(container, certificates, run = execute) {
  if (!/^[a-f0-9]{12,64}$/.test(container)) throw new Error('Invalid disposable service identity')
  const created = await run('docker', ['exec', '-u', 'postgres', container, 'sh', '-c', createDirectory])
  const directory = created.stdout.trim()
  if (!directoryPattern.test(directory)) throw new Error('Unsafe container certificate directory')
  try {
    await verifyPrivateDirectory(run, container, directory)
    await copyCertificate(run, container, directory, certificates.serverCertFile, 'server.pem')
    await copyCertificate(run, container, directory, certificates.serverKeyFile, 'server.key')
    return directory
  } catch {
    try { await removePartialInstallation(run, container, directory) } catch { /* Refuse cleanup if ownership/path verification fails. */ }
    throw new Error('Disposable certificate installation failed')
  }
}
