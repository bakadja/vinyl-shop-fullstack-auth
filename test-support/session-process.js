import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
const serverFile = fileURLToPath(new URL('../server.js', import.meta.url))
const allowed = new Set(['DATABASE_URL', 'DATABASE_SCHEMA', 'PGSSLMODE', 'PGSSLROOTCERT', 'NODE_ENV', 'PUBLIC_ORIGIN', 'SESSION_PROXY_MODE', 'TRUSTED_PROXY_CIDRS', 'SPIRAL_SESSION_PREVIOUS_SECRETS', 'SPIRAL_SESSION_SECRET'])
export async function startSessionProcess(t, { childEnv, cwd, secret = randomBytes(32).toString('hex'), overrides = {} }) {
  const env = { PORT: '0', SPIRAL_SESSION_SECRET: secret }
  for (const [name, value] of Object.entries({ ...childEnv, ...overrides })) if (allowed.has(name) && value !== undefined) env[name] = value
  const child = spawn(process.execPath, [serverFile], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let stopping
  function stop(signal = 'SIGTERM') {
    if (stopping) return stopping
    if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(child.exitCode)
    stopping = (async () => {
      const exited = once(child, 'exit')
      const timer = setTimeout(() => child.kill('SIGKILL'), 12000)
      child.kill(signal)
      try { return (await exited)[0] } finally { clearTimeout(timer) }
    })()
    return stopping
  }
  t.after(stop)
  const baseUrl = await new Promise((resolve, reject) => {
    let logs = ''
    const timer = setTimeout(() => reject(new Error('Server startup timed out')), 10000)
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('exit', () => { clearTimeout(timer); reject(new Error(`Server startup failed: ${logs}`)) })
    child.stderr.on('data', chunk => { logs = (logs + chunk).slice(-4000) })
    child.stdout.on('data', chunk => {
      const match = /localhost:(\d+)/.exec(String(chunk))
      if (match) { clearTimeout(timer); resolve(`http://127.0.0.1:${match[1]}`) }
    })
  })
  return { baseUrl, stop, async request(path, { method = 'GET', body, headers = {} } = {}) {
    const response = await fetch(baseUrl + path, { method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(5000) })
    const text = await response.text()
    return { status: response.status, body: text ? JSON.parse(text) : null, headers: response.headers, setCookies: response.headers.getSetCookie() }
  } }
}
