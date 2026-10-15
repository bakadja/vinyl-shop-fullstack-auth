import { constants } from 'node:fs'
import { lstat, mkdtemp, open, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const run = promisify(execFile)
const names = ['ca.pem', 'ca.key', 'server.pem', 'server.key', 'server.csr', 'extensions.cnf', 'ca.srl']

async function privateTemporaryDirectory() {
  // Deliberately ignore caller paths and TMPDIR: only the fixed OS temp root
  // may contain our atomically created, owner-only directory.
  const root = process.platform === 'darwin' ? '/private/tmp' : '/tmp'
  const metadata = await lstat(root)
  if (!metadata.isDirectory() || metadata.uid !== 0 || !(metadata.mode & 0o1000)) throw new Error('Unsafe system temporary directory')
  return mkdtemp(join(root, 'vinyl-certificates-'))
}

async function validateDirectory(directory, identity) {
  const current = await lstat(directory)
  if (!current.isDirectory() || current.uid !== process.getuid() || (current.mode & 0o777) !== 0o700 || current.ino !== identity.ino || current.dev !== identity.dev) throw new Error('Certificate directory identity changed')
}

async function validateFiles(directory) {
  const entries = await readdir(directory)
  await Promise.all(entries.map(async name => {
    if (!names.includes(name)) throw new Error('Unexpected certificate entry')
    const metadata = await lstat(join(directory, name))
    if (!metadata.isFile() || metadata.uid !== process.getuid() || metadata.nlink !== 1) throw new Error('Unsafe certificate entry')
  }))
}

async function reserveFile(directory, name, contents = '') {
  const file = await open(join(directory, name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
  try { await file.writeFile(contents) } finally { await file.close() }
}

export async function createTestCertificates(...inputs) {
  if (inputs.length) throw new Error('Certificate output paths are not accepted')
  const directory = await privateTemporaryDirectory()
  const identity = await lstat(directory)
  let cleaned = false
  async function cleanup() {
    if (cleaned) return
    await validateDirectory(directory, identity)
    await validateFiles(directory)
    await rm(directory, { recursive: true })
    cleaned = true
  }
  async function openssl(args) {
    await validateDirectory(directory, identity)
    await validateFiles(directory)
    // Every output is a fixed relative name in our private working directory.
    await run('openssl', args, { cwd: directory })
  }
  try {
    await Promise.all(names.map(name => reserveFile(directory, name, name === 'ca.srl' ? '01\n' : '')))
    // Write through an exclusively reserved regular file, never a caller path.
    const extensions = await open(join(directory, 'extensions.cnf'), constants.O_WRONLY | constants.O_NOFOLLOW)
    try { await extensions.writeFile('subjectAltName=DNS:localhost,IP:127.0.0.1,IP:::1\nextendedKeyUsage=serverAuth\n') } finally { await extensions.close() }
    await openssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key', '-out', 'ca.pem', '-days', '2', '-subj', '/CN=Disposable Vinyl Test CA'])
    await openssl(['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'server.key', '-out', 'server.csr', '-subj', '/CN=localhost'])
    await openssl(['x509', '-req', '-in', 'server.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAserial', 'ca.srl', '-out', 'server.pem', '-days', '2', '-extfile', 'extensions.cnf'])
    await validateDirectory(directory, identity)
    await validateFiles(directory)
    return { directory, caFile: join(directory, 'ca.pem'), serverCertFile: join(directory, 'server.pem'), serverKeyFile: join(directory, 'server.key'), cleanup }
  } catch {
    await cleanup()
    throw new Error('Disposable certificate generation failed')
  }
}
