import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import https from 'node:https'
import http from 'node:http'
const run = promisify(execFile)
export async function createTestCertificates(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const caFile = join(directory, 'ca.pem'), caKey = join(directory, 'ca.key')
  const serverCertFile = join(directory, 'server.pem'), serverKeyFile = join(directory, 'server.key')
  const csr = join(directory, 'server.csr'), extensions = join(directory, 'extensions.cnf')
  await writeFile(extensions, 'subjectAltName=DNS:localhost,IP:127.0.0.1,IP:::1\nextendedKeyUsage=serverAuth\n')
  await run('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', caKey, '-out', caFile, '-days', '2', '-subj', '/CN=Disposable Vinyl Test CA'])
  await run('openssl', ['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', serverKeyFile, '-out', csr, '-subj', '/CN=localhost'])
  await run('openssl', ['x509', '-req', '-in', csr, '-CA', caFile, '-CAkey', caKey, '-CAcreateserial', '-out', serverCertFile, '-days', '2', '-extfile', extensions])
  await Promise.all([chmod(caKey, 0o600), chmod(serverKeyFile, 0o600)])
  return { caFile, serverCertFile, serverKeyFile }
}
export async function startTlsProxy(t, { targetUrl, certificates, overwriteProtocol = true }) {
  const server = https.createServer({ key: await readFile(certificates.serverKeyFile), cert: await readFile(certificates.serverCertFile) }, (req, res) => {
    const headers = { ...req.headers }
    if (overwriteProtocol) { headers['x-forwarded-proto'] = 'https'; delete headers['x-forwarded-host']; delete headers['x-forwarded-for'] }
    const upstream = http.request(new URL(req.url, targetUrl), { method: req.method, headers }, response => {
      res.writeHead(response.statusCode, response.headers); response.pipe(res)
    })
    upstream.on('error', () => { res.writeHead(502); res.end() })
    req.pipe(upstream)
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const close = () => new Promise(resolve => { server.close(resolve); server.closeAllConnections() })
  t.after(close)
  return { origin: `https://localhost:${server.address().port}`, close }
}
