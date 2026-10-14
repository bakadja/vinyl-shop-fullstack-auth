// Optional browser check, isolated from the application and database.
// Run: node test-support/dom-xss-browser-server.js; open the printed URL.
import http from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
const server = http.createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname
  let file = null
  if (path === '/') file = new URL('./dom-xss-browser.html', import.meta.url)
  else if (/^\/js\/[a-zA-Z]+\.js$/.test(path)) file = new URL(`../public${path}`, import.meta.url)
  if (!file) { res.writeHead(404).end(); return }
  try {
    const body = await readFile(fileURLToPath(file))
    res.writeHead(200, { 'Content-Type': path === '/' ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8' })
    res.end(body)
  } catch { res.writeHead(404).end() }
})
server.listen(0, '127.0.0.1', () => console.log(`http://127.0.0.1:${server.address().port}/`))
