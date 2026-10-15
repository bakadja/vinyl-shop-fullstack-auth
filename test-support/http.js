import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { initializeSessions } from '../sessions/schema.js'
import { initializeDatabase } from '../scripts/init-db.js'
import { postgresFixture } from './postgresql.js'

export async function fixture(t) {
  let child
  // Register child shutdown before schema cleanup: node:test runs after hooks in order.
  t.after(async () => {
    if (child?.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit')
      child.kill('SIGTERM')
      const timer = setTimeout(() => child.kill('SIGKILL'), 3000)
      try { await exited } finally { clearTimeout(timer) }
    }
  })
  const { database, schema, directory, childEnv } = await postgresFixture(t)
  await initializeDatabase(database)
  await initializeSessions(database)
  child = spawn(process.execPath, [fileURLToPath(new URL('../server.js', import.meta.url))], {
    cwd: directory,
    env: { ...childEnv, PORT: '0', SPIRAL_SESSION_SECRET: randomBytes(32).toString('hex') },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  const baseUrl = await new Promise((resolve, reject) => {
    let output = ''
    let settled = false
    const timer = setTimeout(() => finish(new Error(`Server startup timed out: ${output}`)), 10000)
    const finish = (error, url) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.removeListener('error', onError)
      child.removeListener('exit', onExit)
      error ? reject(error) : resolve(url)
    }
    const onError = error => finish(error)
    const onExit = code => finish(new Error(`Server exited (${code}): ${output}`))
    child.once('error', onError)
    child.once('exit', onExit)
    child.stderr.on('data', chunk => { output = (output + chunk).slice(-8192) })
    child.stdout.on('data', chunk => {
      output = (output + chunk).slice(-8192)
      const match = /Server running at http:\/\/localhost:(\d+)/.exec(output)
      if (match) {
        const port = Number(match[1])
        if (port === 8000 || port === 0) {
          finish(new Error('Test server must use an OS-assigned port, not port 8000 or 0'))
        } else {
          finish(null, `http://127.0.0.1:${port}`)
        }
      }
    })
  })

  function client() {
    let cookie
    return async (path, { method = 'GET', body, headers: suppliedHeaders = {} } = {}) => {
      const headers = {}
      if (cookie) headers.Cookie = cookie
      if (body !== undefined) headers['Content-Type'] = 'application/json'
      Object.assign(headers, suppliedHeaders)
      const response = await fetch(`${baseUrl}${path}`, {
        method, headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(5000)
      })
      const setCookie = response.headers.get('set-cookie')
      if (setCookie) cookie = setCookie.split(';')[0]
      const text = await response.text()
      return { status: response.status, body: text ? JSON.parse(text) : null, cookie: setCookie }
    }
  }
  return { client, directory, database, schema, childEnv,
    shutdown: () => { const exited = once(child, 'exit'); child.kill('SIGTERM'); return exited } }
}

export function account(username = 'test-user') {
  return { name: `Fictional ${username}`, email: `${username}@example.com`, username, password: 'Fictional-password-123' }
}

export async function register(request, user = account()) {
  const response = await request('/api/auth/register', { method: 'POST', body: user })
  assert.equal(response.status, 201)
  return user
}
