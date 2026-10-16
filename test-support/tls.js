export { createTestCertificates } from './certificates.js'
import { readFile } from 'node:fs/promises'
import https from 'node:https'
import http from 'node:http'
export async function startTlsProxy(t, { targetUrl, certificates, overwriteProtocol = true }) {
  const server = https.createServer({ key: await readFile(certificates.serverKeyFile), cert: await readFile(certificates.serverCertFile) }, (req, res) => {
    const headers = { ...req.headers }
    if (overwriteProtocol) { headers['x-forwarded-proto'] = 'https'; delete headers['x-forwarded-host']; headers['x-forwarded-for'] = req.socket.remoteAddress }
    const upstream = http.request(new URL(req.url, typeof targetUrl === 'function' ? targetUrl() : targetUrl), { method: req.method, headers }, response => {
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
