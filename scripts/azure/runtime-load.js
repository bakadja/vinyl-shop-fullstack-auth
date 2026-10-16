import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { assembleRuntime } from './package.js'
import { counterKeys, peerIdentity } from '../../sessions/abuse.js'

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const caddyPlatform = process.arch === 'arm64' ? 'linux/arm64' : 'linux/amd64'
const images = {
  node: 'node@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5',
  postgres: 'postgres@sha256:2d2b8998d31037bf721cfdf764d76ba74171b4fab3431b7f72c27c56ddbdf9e3',
  caddy: 'caddy@sha256:685ae3d7c34d9b5f8caeddc5d14051db7bbd88ff1f5a2fa0c16bd8ca328fb7af'
}

function command(program, args, { env = {}, input, allowFailure = false } = {}) {
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(program, args, { cwd: root, env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.once('error', () => rejectCommand(new Error('Local runtime command failed')))
    child.once('close', code => {
      if (code !== 0 && !allowFailure) return rejectCommand(new Error('Local runtime command failed'))
      resolveCommand({ code, stdout: stdout.trim(), stderr: stderr.trim() })
    })
    child.stdin.end(input)
  })
}

const docker = (args, options) => command('docker', args, options)
const delay = milliseconds => new Promise(resolveDelay => setTimeout(resolveDelay, milliseconds))
const responseCounts = responses => Object.fromEntries([...new Set(responses.map(response => response.status))]
  .sort((left, right) => Number(left) - Number(right))
  .map(status => [status, responses.filter(response => response.status === status).length]))
const controlledAuthenticationFailureClasses = new Set([
  'postgres_lock_timeout', 'postgres_statement_timeout', 'postgres_connection_limit',
  'postgres_connection_refused', 'postgres_connection_error', 'postgres_pool_acquire_timeout'
])
function isControlledAuthenticationFailure(line) {
  const match = line.match(/(?:Login failed \(stage=[a-z_]+, class=|Authentication admission failed \(class=)([a-z_]+)\)/)
  return Boolean(match && controlledAuthenticationFailureClasses.has(match[1]))
}
async function safeAuthDiagnostics(name) {
  const logs = await docker(['logs', '--since', '2m', name], { allowFailure: true })
  return `${logs.stdout}\n${logs.stderr}`.split('\n')
    .map(line => line.match(/(?:Login failed \(stage=[a-z_]+, class=[a-z_]+\)|Authentication admission failed \(class=[a-z_]+\))/)?.[0])
    .filter(Boolean)
}

async function overloadFailureDiagnostics(appName, caddyName, pgName, peaks) {
  const state = async name => {
    const result = await docker(['inspect', '--format', '{{.State.Status}}|{{.State.ExitCode}}|{{.State.OOMKilled}}|{{.RestartCount}}', name], { allowFailure: true })
    return result.code === 0 ? result.stdout : 'unavailable'
  }
  const caddyLogs = await docker(['logs', '--since', '2m', caddyName], { allowFailure: true })
  const caddyLines = `${caddyLogs.stdout}\n${caddyLogs.stderr}`.split('\n')
  const caddyFailures = caddyLines.map(line => {
    if (line.includes('connect: connection refused')) return 'upstream_connection_refused'
    if (line.includes('no such host')) return 'upstream_dns_failure'
    if (line.includes('i/o timeout')) return 'upstream_timeout'
    if (line.includes('panic:')) return 'caddy_panic'
    return null
  }).filter(Boolean)
  const appLogs = await docker(['logs', '--since', '2m', appName], { allowFailure: true })
  const appLines = `${appLogs.stdout}\n${appLogs.stderr}`.split('\n')
  const appFailures = appLines.map(line => {
    const safeEvent = line.match(/(?:Login failed \(stage=[a-z_]+, class=[a-z_]+\)|Authentication admission failed \(class=[a-z_]+\)|Server running at http:\/\/localhost:\d+|PostgreSQL idle connection failed|Session server shutdown timed out|Session server shutdown failed|Session invalidation failed|Reached heap limit|FATAL ERROR:|uncaughtException|uncaught exception)/i)?.[0]
    if (safeEvent) return safeEvent
    const frame = line.match(/^\s+at (?:async )?.*?\(?\/app\/([^():]+):(\d+):(\d+)\)?$/)
    if (frame) return `node_stack_frame ${frame[1]}:${frame[2]}`
    const failure = line.match(/^(Error|TypeError|RangeError|ReferenceError|SyntaxError)(?: \[([A-Z0-9_]+)\])?:/)
    if (failure) return `node_uncaught_${failure[1].toLowerCase()}${failure[2] ? `_${failure[2].toLowerCase()}` : ''}`
    const code = line.match(/\bcode:\s*['"]([A-Z0-9_]+)['"]/)
    if (code && ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ENOMEM', 'EMFILE', '53300', '55P03', '57014'].includes(code[1])) return `node_error_code_${code[1]}`
    return null
  })
    .filter(Boolean)
  const appErrorClasses = appLines.map(line => {
    if (/canceling statement due to statement timeout/i.test(line)) return 'postgres_statement_timeout'
    if (/canceling statement due to lock timeout/i.test(line)) return 'postgres_lock_timeout'
    if (/Connection terminated unexpectedly/i.test(line)) return 'postgres_connection_terminated'
    if (/terminating connection due to administrator command/i.test(line)) return 'postgres_admin_termination'
    if (/timeout exceeded when trying to connect/i.test(line)) return 'postgres_pool_acquire_timeout'
    return null
  }).filter(Boolean)
  const pgLogs = await docker(['logs', '--since', '2m', pgName], { allowFailure: true })
  const pgLines = `${pgLogs.stdout}\n${pgLogs.stderr}`.split('\n')
  const pgFailures = pgLines.map(line => {
    if (/out of memory|could not allocate memory/i.test(line)) return 'postgres_out_of_memory'
    if (/server process .* was terminated by signal/i.test(line)) return 'postgres_backend_terminated'
    if (/database system is shutting down/i.test(line)) return 'postgres_shutting_down'
    if (/canceling statement due to statement timeout/i.test(line)) return 'postgres_statement_timeout'
    if (/canceling statement due to lock timeout/i.test(line)) return 'postgres_lock_timeout'
    if (/FATAL:/i.test(line)) return 'postgres_fatal'
    return null
  }).filter(Boolean)
  return `app=${await state(appName)}, PostgreSQL=${await state(pgName)}, Caddy=${await state(caddyName)}, sampled-memory-MiB=${JSON.stringify({ app: peaks[appName] ?? null, caddy: peaks[caddyName] ?? null })}, Caddy failures=${JSON.stringify([...new Set(caddyFailures)])}, app error classes=${JSON.stringify([...new Set(appErrorClasses)])}, safe app diagnostics=${JSON.stringify(appFailures.slice(-20))}, PostgreSQL failures=${JSON.stringify([...new Set(pgFailures)])}`
}

function memoryMiB(value) {
  const match = /^(\d+(?:\.\d+)?)(B|kB|KB|MiB|GiB)$/.exec(value)
  if (!match) return 0
  const scale = { B: 1 / 1048576, kB: 1000 / 1048576, KB: 1000 / 1048576, MiB: 1, GiB: 1024 }[match[2]]
  return Number(match[1]) * scale
}

async function waitForDatabase(name) {
  for (let attempt = 0; attempt < 120; attempt++) {
    const result = await docker(['exec', name, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'vinyl_shop'], { env: { PGPASSWORD: postgresAdminPassword }, allowFailure: true })
    if (result.code === 0) return
    await delay(500)
  }
  throw new Error('Disposable PostgreSQL did not become ready')
}

async function psql(name, sql, { env = {}, execArgs = [], psqlArgs = [] } = {}) {
  const result = await docker(['exec', '-i', '--env', 'PGPASSWORD', ...execArgs, name, 'psql', '-X', '--set', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'vinyl_shop', ...psqlArgs], { input: sql, env: { PGPASSWORD: postgresAdminPassword, ...env }, allowFailure: true })
  if (result.code !== 0) {
    const diagnostic = result.stderr.split('\n').find(line => /^psql: (?:error|warning):|^ERROR:/i.test(line))
    throw new Error(diagnostic ? `PostgreSQL command failed: ${diagnostic.slice(0, 180)}` : 'PostgreSQL command failed')
  }
  return result
}

async function request(url, { method = 'GET', body, cookie, headers = {}, duplicateForwarded = false } = {}) {
  if (duplicateForwarded) {
    return new Promise((resolveRequest, rejectRequest) => {
      const child = spawn(process.execPath, ['-e', `
        const http = require('node:http')
        const request = http.request(process.env.URL, { method: process.env.METHOD, headers: [
          'Content-Type', 'application/json', 'X-Forwarded-For', '203.0.113.9', 'x-forwarded-for', '198.51.100.19'
        ] }, response => {
          let text = ''
          response.setEncoding('utf8')
          response.on('data', value => text += value)
          response.on('end', () => process.stdout.write(JSON.stringify({ status: response.statusCode, headers: response.headers, body: text })))
        })
        request.on('error', () => process.exit(1))
        request.end(process.env.BODY)
      `], { env: { ...process.env, URL: url, METHOD: method, BODY: JSON.stringify(body) }, stdio: ['ignore', 'pipe', 'ignore'] })
      let output = ''
      child.stdout.on('data', chunk => { output += chunk })
      child.once('error', () => rejectRequest(new Error('Local proxy request failed')))
      child.once('close', code => {
        if (code !== 0) return rejectRequest(new Error('Local proxy request failed'))
        try {
          const parsed = JSON.parse(output)
          let responseBody = parsed.body || null
          if (responseBody) {
            try { responseBody = JSON.parse(responseBody) } catch {}
          }
          resolveRequest({ ...parsed, headers: new Headers(parsed.headers), body: responseBody })
        } catch { rejectRequest(new Error('Local proxy response was invalid')) }
      })
    })
  }
  const response = await fetch(url, {
    method,
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000)
  })
  const text = await response.text()
  return { status: response.status, headers: response.headers, body: text ? JSON.parse(text) : null }
}

let workspace
let network
let currentStage = 'setup'
let postgresAdminPassword
const containers = []
let samplerStop = false
let samplerPromise

async function cleanup() {
  samplerStop = true
  if (samplerPromise) await samplerPromise.catch(() => {})
  for (const name of containers.reverse()) await docker(['rm', '--force', '--volumes', name], { allowFailure: true })
  if (network) await docker(['network', 'rm', network], { allowFailure: true })
  if (workspace) await rm(workspace, { recursive: true, force: true })
}

async function sampleMemory(appName, caddyName, peaks) {
  while (!samplerStop) {
    const result = await docker(['stats', '--no-stream', '--format', '{{.Name}}|{{.MemUsage}}', appName, caddyName], { allowFailure: true })
    if (result.code === 0) {
      for (const line of result.stdout.split('\n')) {
        const [name, usage] = line.split('|')
        const actual = usage?.split('/')[0].trim()
        if (name && actual) peaks[name] = Math.max(peaks[name] ?? 0, memoryMiB(actual))
      }
    }
    await delay(500)
  }
}

async function run() {
  currentStage = 'workspace preparation'
  workspace = await mkdtemp(join(process.platform === 'darwin' ? resolve(root, '..') : tmpdir(), 'vinyl-runtime-load-'))
  const runtime = join(workspace, 'runtime')
  const caFile = join(workspace, 'postgres-root.pem')
  const caddyFile = join(workspace, 'Caddyfile')
  const suffix = randomBytes(6).toString('hex')
  const pgName = `vinyl-runtime-pg-${suffix}`
  const appName = `vinyl-runtime-app-${suffix}`
  const caddyName = `vinyl-runtime-caddy-${suffix}`
  network = `vinyl-runtime-${suffix}`
  postgresAdminPassword = randomBytes(24).toString('hex')
  const runtimePassword = randomBytes(24).toString('hex')
  const sessionSecret = randomBytes(32).toString('hex')
  const abuseSecret = randomBytes(32).toString('hex')

  currentStage = 'revision lookup'
  const release = (await command('git', ['rev-parse', 'HEAD'])).stdout
  currentStage = 'runtime allowlist assembly'
  await assembleRuntime(root, runtime, { release })
  currentStage = 'Linux/amd64 production dependency installation'
  await docker(['run', '--rm', '--platform', 'linux/amd64', '--user', `${process.getuid()}:${process.getgid()}`, '--env', 'HOME=/tmp', '--env', 'npm_config_cache=/tmp/npm-cache', '--mount', `type=bind,src=${runtime},dst=/app`, '--workdir', '/app', images.node, 'npm', 'ci', '--omit=dev', '--ignore-scripts'])
  currentStage = 'isolated Docker network'
  await docker(['network', 'create', network])

  const postgresCommand = "openssl req -x509 -newkey rsa:2048 -nodes -sha256 -keyout /tmp/runtime.key -out /tmp/runtime.crt -days 2 -subj /CN=postgres -addext 'subjectAltName=DNS:postgres' && chown postgres:postgres /tmp/runtime.key /tmp/runtime.crt && chmod 0600 /tmp/runtime.key && exec /usr/local/bin/docker-entrypoint.sh postgres -c ssl=on -c ssl_cert_file=/tmp/runtime.crt -c ssl_key_file=/tmp/runtime.key"
  currentStage = 'disposable PostgreSQL startup'
  await docker(['run', '--detach', '--platform', 'linux/amd64', '--name', pgName, '--network', network, '--network-alias', 'postgres', '--memory', '512m', '--memory-swap', '512m', '--tmpfs', '/var/lib/postgresql/data:rw,size=192m', '--env', 'POSTGRES_USER', '--env', 'POSTGRES_PASSWORD', '--env', 'POSTGRES_DB', images.postgres, 'sh', '-c', postgresCommand], {
    env: { POSTGRES_USER: 'postgres', POSTGRES_PASSWORD: postgresAdminPassword, POSTGRES_DB: 'vinyl_shop' }
  })
  containers.push(pgName)
  currentStage = 'PostgreSQL readiness'
  await waitForDatabase(pgName)
  currentStage = 'PostgreSQL TLS root export'
  await docker(['cp', `${pgName}:/tmp/runtime.crt`, caFile])
  for (const filename of ['init.sql', 'sessions.sql', 'abuse.sql']) {
    currentStage = `PostgreSQL ${filename} initialization`
    const path = filename === 'init.sql' ? 'db/init.sql' : `db/${filename}`
    await psql(pgName, await readFile(join(root, path), 'utf8'))
  }
  currentStage = 'runtime database role creation'
  const createRole = `\\getenv runtime_password RUNTIME_PASSWORD\nCREATE ROLE vinyl_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'runtime_password';\n`
  await psql(pgName, createRole, { env: { RUNTIME_PASSWORD: runtimePassword }, psqlArgs: ['--no-password'], execArgs: ['--env', 'RUNTIME_PASSWORD'] })
  currentStage = 'runtime database grants'
  await psql(pgName, await readFile(join(root, 'infra/azure/runtime-grants.sql'), 'utf8'), { psqlArgs: ['--set', 'runtime_role=vinyl_runtime'] })

  currentStage = 'Caddy proxy startup'
  await writeFile(caddyFile, `:80 {\n  reverse_proxy app:8000 {\n    header_up X-Forwarded-For {remote_host}\n    header_up X-Forwarded-Proto https\n    header_down X-Observed-Remote {remote_host}\n  }\n}\n`, { mode: 0o600, flag: 'wx' })
  await docker(['run', '--detach', '--platform', caddyPlatform, '--name', caddyName, '--network', network, '--memory', '64m', '--memory-swap', '64m', '--publish', '127.0.0.1::80', '--mount', `type=bind,src=${caddyFile},dst=/etc/caddy/Caddyfile,readonly`, images.caddy])
  containers.push(caddyName)
  const caddyNetworks = JSON.parse((await docker(['inspect', '--format', '{{json .NetworkSettings.Networks}}', caddyName])).stdout)
  const caddyIp = Object.values(caddyNetworks)[0].IPAddress
  const published = (await docker(['port', caddyName, '80/tcp'])).stdout.match(/127\.0\.0\.1:(\d+)/)
  assert.ok(published, 'Caddy test listener must bind only to host loopback')
  const baseUrl = `http://127.0.0.1:${published[1]}`

  const appEnvironment = {
    NODE_ENV: 'production', PORT: '8000', PUBLIC_ORIGIN: 'https://runtime.example.test', DATABASE_URL: `postgresql://vinyl_runtime:${runtimePassword}@postgres:5432/vinyl_shop`,
    PGSSLMODE: 'verify-full', PGSSLROOTCERT: '/run/secrets/postgres-root.pem',
    SESSION_PROXY_MODE: 'verified-proxy', TRUSTED_PROXY_CIDRS: `${caddyIp}/32`,
    SPIRAL_SESSION_SECRET: sessionSecret, AUTH_ABUSE_HMAC_KEY: abuseSecret
  }
  currentStage = '1-GiB-candidate app startup'
  await docker(['run', '--detach', '--platform', 'linux/amd64', '--name', appName, '--network', network, '--network-alias', 'app', '--memory', '704m', '--memory-swap', '704m', '--read-only', '--tmpfs', '/tmp:rw,nosuid,size=32m', '--user', 'node', '--mount', `type=bind,src=${runtime},dst=/app,readonly`, '--mount', `type=bind,src=${caFile},dst=/run/secrets/postgres-root.pem,readonly`, '--workdir', '/app', ...Object.keys(appEnvironment).flatMap(name => ['--env', name]), images.node, 'node', '--import', './instrument.js', 'server.js'], { env: appEnvironment })
  containers.push(appName)

  const peaks = {}
  samplerPromise = sampleMemory(appName, caddyName, peaks)
  let live
  let lastReadinessFailure = 'none'
  for (let attempt = 0; attempt < 120; attempt++) {
    try { live = await request(`${baseUrl}/health/ready`); if (live.status === 200) break } catch (error) {
      const code = error?.cause?.code
      lastReadinessFailure = code && /^[A-Z0-9_]+$/.test(code) ? code : error?.name === 'TimeoutError' ? 'fetch_timeout' : 'fetch_error'
    }
    await delay(500)
  }
  if (live?.status !== 200) {
    const state = await docker(['inspect', '--format', '{{.State.Status}}|{{.State.ExitCode}}|{{.State.OOMKilled}}', appName], { allowFailure: true })
    const appLogs = await docker(['logs', '--tail', '20', appName], { allowFailure: true })
    const caddyState = await docker(['inspect', '--format', '{{.State.Status}}|{{.State.ExitCode}}|{{.State.OOMKilled}}', caddyName], { allowFailure: true })
    const caddyLogs = await docker(['logs', '--tail', '120', caddyName], { allowFailure: true })
    const safeStartupLogs = `${appLogs.stdout}\n${appLogs.stderr}`.split('\n')
      .map(line => line.match(/(?:Server running at http:\/\/localhost:\d+|Session server startup failed\. Check configuration, connectivity and schema compatibility\.|PostgreSQL idle connection failed)/)?.[0])
      .filter(Boolean)
    const caddyLogLines = `${caddyLogs.stdout}\n${caddyLogs.stderr}`.split('\n')
    const panicLine = caddyLogLines.findIndex(line => line.includes('panic:'))
    const caddyFailure = (panicLine >= 0 ? caddyLogLines.slice(panicLine, panicLine + 40) : caddyLogLines).map(line => {
      if (line.includes('connect: connection refused')) return 'upstream_connection_refused'
      if (line.includes('no such host')) return 'upstream_dns_failure'
      if (line.includes('i/o timeout')) return 'upstream_timeout'
      if (/error|failed|panic:|goroutine \d+|runtime\.|caddyserver|\.go:\d+/i.test(line)) return line.trim().slice(-240)
      return null
    }).filter(Boolean).slice(-12)
    throw new Error(`PostgreSQL-backed readiness failed (HTTP ${live?.status ?? 'no response'}, last fetch=${lastReadinessFailure}, app=${state.code === 0 ? state.stdout : 'unavailable'}, Caddy=${caddyState.code === 0 ? caddyState.stdout : 'unavailable'}, Caddy failures=${JSON.stringify(caddyFailure)}, safe app logs=${JSON.stringify(safeStartupLogs)})`)
  }
  const observed = live.headers.get('x-observed-remote')
  assert.ok(observed, 'Caddy must expose its direct peer to the local test assertion')
  assert.equal(live.headers.has('set-cookie'), false, 'Health must not create a session')

  currentStage = 'Caddy forwarding-header spoof checks'
  const spoofUsername = `spoof-${suffix}`
  const spoofed = await request(`${baseUrl}/api/auth/login`, { method: 'POST', body: { username: spoofUsername, password: 'Fictional-wrong-password-123' }, headers: { 'X-Forwarded-For': '203.0.113.250, 198.51.100.250' } })
  assert.equal(spoofed.status, 401)
  const duplicate = await request(`${baseUrl}/api/auth/login`, { method: 'POST', body: { username: spoofUsername, password: 'Fictional-wrong-password-123' }, duplicateForwarded: true })
  assert.ok([400, 401].includes(duplicate.status), 'Duplicate client forwarding headers must be rejected or normalized by the proxy path')
  const hmacKey = Buffer.from(abuseSecret, 'hex')
  const trustedKeys = counterKeys(hmacKey, 'login', peerIdentity(observed), spoofUsername).slice(2).map(counter => counter.key)
  const spoofKeys = counterKeys(hmacKey, 'login', '203.0.113.250', spoofUsername).slice(2).map(counter => counter.key)
  const countFor = async keys => Number((await psql(pgName, `SELECT count(*) FROM auth_abuse_counters WHERE key IN (${keys.map(key => `'${key}'`).join(',')});`, { psqlArgs: ['-t', '-A'] })).stdout)
  assert.equal(await countFor(trustedKeys), 2, 'The accepted request must charge the Caddy-observed peer identity across both limiter windows')
  assert.equal(await countFor(spoofKeys), 0, 'Client-supplied forwarding identities must not create peer counters')

  currentStage = 'registration, product browsing, and cart flow'
  const user = { name: 'Fictional runtime user', email: `runtime-${suffix}@example.test`, username: `runtime-${suffix}`, password: 'Fictional-password-123' }
  const registered = await request(`${baseUrl}/api/auth/register`, { method: 'POST', body: user })
  assert.equal(registered.status, 201)
  const registrationCookie = registered.headers.get('set-cookie')?.split(';')[0]
  assert.ok(registrationCookie, 'Registration must create its persisted session')
  const loggedIn = await request(`${baseUrl}/api/auth/login`, { method: 'POST', body: { username: user.username, password: user.password } })
  assert.equal(loggedIn.status, 200)
  const cookie = loggedIn.headers.get('set-cookie')?.split(';')[0]
  assert.ok(cookie, 'Successful login must create its persisted session')
  assert.equal((await request(`${baseUrl}/api/products`)).body.length, 10)
  const add = await request(`${baseUrl}/api/cart/add`, { method: 'POST', body: { productId: 1 }, cookie })
  assert.equal(add.status, 200)

  const parallel = await Promise.all(Array.from({ length: 32 }, (_, index) => index % 2
    ? request(`${baseUrl}/api/products/genres`)
    : request(`${baseUrl}/api/cart`, { cookie })))
  assert.ok(parallel.every(response => response.status === 200), 'Concurrent browsing and cart reads must complete')

  currentStage = 'concurrent request and auth-abuse workload'
  await psql(pgName, 'DELETE FROM auth_abuse_counters;')
  const boundedDiagnosticsBefore = await safeAuthDiagnostics(appName)
  const failures = []
  for (let index = 0; index < 20; index += 2) {
    failures.push(...await Promise.all([0, 1].map(offset => request(`${baseUrl}/api/auth/login`, {
      method: 'POST', body: { username: `fictional-burst-${index + offset}-${suffix}`, password: 'Fictional-wrong-password-123' }
    }))))
  }
  const limitedLegitimateLogin = await request(`${baseUrl}/api/auth/login`, { method: 'POST', body: { username: user.username, password: user.password } })
  failures.push(limitedLegitimateLogin)
  const failureCounts = responseCounts(failures)
  const bounded429 = failureCounts[429] ?? 0
  const bounded401 = failureCounts[401] ?? 0
  const bounded5xx = failures.filter(response => response.status >= 500).length
  const boundedDiagnostics = (await safeAuthDiagnostics(appName)).slice(boundedDiagnosticsBefore.length)
  console.log(`Bounded login response counts: 401=${bounded401}, 429=${bounded429}, 5xx=${bounded5xx}`)
  console.log(`Bounded login safe diagnostics: ${JSON.stringify(boundedDiagnostics)}`)
  assert.deepEqual(failureCounts, { 401: 20, 429: 1 }, 'Bounded login attempts must be limited without any server errors')
  assert.equal(limitedLegitimateLogin.headers.has('set-cookie'), false, 'An authenticated account must not bypass the exhausted global burst limit')
  const recoveryDelay = Number(limitedLegitimateLogin.headers.get('retry-after'))
  assert.ok(Number.isInteger(recoveryDelay) && recoveryDelay > 0 && recoveryDelay <= 30, 'Limiter retry window must remain bounded')
  assert.equal((await request(`${baseUrl}/health/ready`)).status, 200, 'The app must remain ready after the bounded authentication limit')
  await delay((recoveryDelay + 1) * 1000)
  const recoveredLogin = await request(`${baseUrl}/api/auth/login`, { method: 'POST', body: { username: user.username, password: user.password } })
  assert.equal(recoveredLogin.status, 200, 'Authentication must recover after the burst window expires')

  currentStage = 'exceptional 24-way auth-abuse workload'
  const exceptionalTrials = []
  for (let trial = 0; trial < 5; trial++) {
    const previousDiagnostics = await safeAuthDiagnostics(appName)
    await psql(pgName, 'DELETE FROM auth_abuse_counters;')
    const responses = await Promise.all(Array.from({ length: 24 }, (_, index) => request(`${baseUrl}/api/auth/login`, {
      method: 'POST', body: { username: `fictional-exception-${trial}-${index}-${suffix}`, password: 'Fictional-wrong-password-123' }
    })))
    const diagnostics = (await safeAuthDiagnostics(appName)).slice(previousDiagnostics.length)
    const result = { counts: responseCounts(responses), diagnostics }
    exceptionalTrials.push(result)
    console.log(`Exceptional 24-way overload trial ${trial + 1}/5: ${JSON.stringify(result)}`)
    if (Object.keys(result.counts).some(status => Number(status) >= 500 && status !== '503')) {
      console.log(`Exceptional overload component diagnostics: ${await overloadFailureDiagnostics(appName, caddyName, pgName, peaks)}`)
    }
    assert.equal(Object.values(result.counts).reduce((sum, count) => sum + count, 0), 24, 'Every exceptional request must return a response')
    assert.ok(Object.keys(result.counts).every(status => ['401', '429', '503'].includes(status)), 'Exceptional overload must not produce HTTP 5xx beyond controlled 503 back-pressure')
    assert.equal(result.counts[503] ?? 0, result.diagnostics.filter(isControlledAuthenticationFailure).length, 'Each controlled 503 must have one safe transient authentication diagnostic')
    assert.ok(result.diagnostics.every(isControlledAuthenticationFailure), 'Every authentication failure diagnostic must use an allowlisted transient PostgreSQL class')
  }
  const exceptionalTotal = exceptionalTrials.reduce((sum, trial) => sum + Object.values(trial.counts).reduce((total, count) => total + count, 0), 0)
  console.log(`Exceptional 24-way overload response counts: ${JSON.stringify(exceptionalTrials.map(trial => trial.counts))}; safe diagnostics=${JSON.stringify(exceptionalTrials.map(trial => trial.diagnostics))}`)
  assert.equal(exceptionalTotal, 120, 'Each exceptional overload trial must return one response per request')
  currentStage = 'valid-account 24-way auth-abuse workload'
  const secondUser = { name: 'Fictional runtime second user', email: `runtime-second-${suffix}@example.test`, username: `rtb-${suffix}`, password: 'Fictional-password-456' }
  const secondRegistered = await request(`${baseUrl}/api/auth/register`, { method: 'POST', body: secondUser })
  assert.equal(secondRegistered.status, 201)
  const validAccounts = [user, secondUser]
  const usernames = validAccounts.map(account => `'${account.username}'`).join(',')
  const sessionCount = async () => Number((await psql(pgName, `SELECT count(*) FROM user_sessions WHERE sess->>'userId' IN
    (SELECT id::text FROM users WHERE username IN (${usernames}));`, { psqlArgs: ['-t', '-A'] })).stdout)
  let persistedBefore
  try { persistedBefore = await sessionCount() } catch (error) {
    console.log(`Valid-account setup component diagnostics: ${await overloadFailureDiagnostics(appName, caddyName, pgName, peaks)}`)
    throw error
  }
  await psql(pgName, 'DELETE FROM auth_abuse_counters;')
  const previousValidDiagnostics = await safeAuthDiagnostics(appName)
  const validResponses = await Promise.all(Array.from({ length: 24 }, (_, index) => {
    const account = validAccounts[index % validAccounts.length]
    return request(`${baseUrl}/api/auth/login`, { method: 'POST', body: { username: account.username, password: account.password } })
  }))
  const validCounts = responseCounts(validResponses)
  const validDiagnostics = (await safeAuthDiagnostics(appName)).slice(previousValidDiagnostics.length)
  const validLogins = validResponses.filter(response => response.status === 200)
  const valid429 = validCounts[429] ?? 0
  const valid503 = validCounts[503] ?? 0
  const valid500 = validResponses.filter(response => response.status === 500).length
  const loginFailures = validDiagnostics.filter(line => line.startsWith('Login failed '))
  const controlledLoginBackpressure = loginFailures.filter(isControlledAuthenticationFailure).length
  const admissionFailures = validDiagnostics.filter(line => line.startsWith('Authentication admission failed '))
  assert.equal(validResponses.length, 24, 'Every concurrent valid-account request must return a response')
  assert.ok(Object.keys(validCounts).every(status => ['200', '429', '503'].includes(status)), 'Valid-account overload may only succeed or fail closed with bounded admission responses')
  for (let accountIndex = 0; accountIndex < validAccounts.length; accountIndex++) {
    const successfulForAccount = validResponses.filter((response, index) => index % validAccounts.length === accountIndex && response.status === 200).length
    assert.ok(successfulForAccount <= 10, 'Concurrent authentication must preserve the per-account attempt limit')
  }
  assert.equal(valid500, 0, 'Valid-account overload must not produce HTTP 500')
  assert.equal(valid503, admissionFailures.length + controlledLoginBackpressure, 'Each valid-account 503 must have one safe transient database diagnostic')
  assert.ok([...admissionFailures, ...loginFailures].every(isControlledAuthenticationFailure), 'Valid-account back-pressure must use an allowlisted transient PostgreSQL class')
  assert.equal(loginFailures.length, controlledLoginBackpressure, 'Valid-account overload must not produce unexpected lookup, bcrypt or session-persistence failures')
  const sessionCookies = validLogins.map(response => response.headers.get('set-cookie')?.split(';')[0]).filter(Boolean)
  assert.equal(sessionCookies.length, validLogins.length, 'Each successful login must return a session cookie')
  assert.equal(new Set(sessionCookies).size, sessionCookies.length, 'Concurrent successful logins must receive distinct session IDs')
  for (const response of validResponses.filter(result => result.status !== 200)) {
    assert.equal(response.headers.has('set-cookie'), false, 'Rejected authentication must not create a session')
  }
  for (const cookie of sessionCookies) {
    assert.equal((await request(`${baseUrl}/api/auth/me`, { cookie })).body.isLoggedIn, true, 'Every successful login session must persist in PostgreSQL')
  }
  const persistedAfter = await sessionCount()
  const persistedLogins = persistedAfter - persistedBefore
  assert.equal(persistedLogins, validLogins.length, 'PostgreSQL must contain each successful login session')
  console.log(`Valid-account 24-way overload response counts: 200=${validLogins.length}, 429=${valid429}, 503=${valid503}, 500=${valid500}`)
  console.log(`Valid-account 24-way overload diagnostics: 503=${admissionFailures.length + controlledLoginBackpressure}, login-backpressure=${controlledLoginBackpressure}, unexpected-login-failures=${loginFailures.length - controlledLoginBackpressure}, persisted-sessions=${persistedLogins}`)
  assert.equal((await request(`${baseUrl}/health/ready`)).status, 200, 'Readiness must remain healthy after valid-account overload')
  assert.equal((await request(`${baseUrl}/api/products`)).status, 200, 'Normal product browsing must remain available after valid-account overload')

  currentStage = 'app restart and persisted-state recovery'
  await docker(['restart', appName])
  let recovered
  for (let attempt = 0; attempt < 120; attempt++) {
    try { recovered = await request(`${baseUrl}/health/ready`); if (recovered.status === 200) break } catch {}
    await delay(500)
  }
  assert.equal(recovered?.status, 200, 'App must recover after process restart')
  assert.equal((await request(`${baseUrl}/api/auth/me`, { cookie })).body.isLoggedIn, true, 'PostgreSQL session must survive app restart')
  assert.equal((await request(`${baseUrl}/api/cart`, { cookie })).body.items.length, 1, 'Cart data must survive app restart')

  samplerStop = true
  await samplerPromise
  samplerPromise = undefined
  const appOom = (await docker(['inspect', '--format', '{{.State.OOMKilled}}', appName])).stdout === 'true'
  const caddyOom = (await docker(['inspect', '--format', '{{.State.OOMKilled}}', caddyName])).stdout === 'true'
  const postgresOom = (await docker(['inspect', '--format', '{{.State.OOMKilled}}', pgName])).stdout === 'true'
  assert.equal(appOom || caddyOom || postgresOom, false, 'App, Caddy and disposable PostgreSQL must not be OOM-killed')
  assert.ok(peaks[appName] > 0 && peaks[caddyName] > 0, 'Memory must be sampled during the workload')

  console.log(`Runtime workload passed on Docker Linux/amd64 app/PostgreSQL with ${caddyPlatform} Caddy and PostgreSQL TLS verify-full.`)
  console.log(`Caddy header spoof checks: a spoofed single header did not change the charged peer; duplicate headers received HTTP ${duplicate.status}; peer=${peerIdentity(observed)}.`)
  console.log(`Requests: 32 concurrent product/cart reads; bounded 20 invalid logins in two-request waves plus one valid-account rate-limit check; separate five 24-way invalid-login overload trials.`)
  console.log(`Recovery: registration, PostgreSQL session, cart and readiness survived an app container restart.`)
  console.log(`Memory caps: app 704 MiB + Caddy 64 MiB = 768 MiB; PostgreSQL fixture 512 MiB is outside the target VM budget; measured app/Caddy peaks ${peaks[appName].toFixed(1)} MiB and ${peaks[caddyName].toFixed(1)} MiB; no OOM.`)
  console.log(`The remaining 256 MiB of the 1-GiB VM budget is reserved for the guest OS and agents; the local Docker VM has separate overhead.`)
}

try {
  await run()
} catch (error) {
  console.error(`Isolated Azure VM runtime workload failed during ${currentStage}: ${error.message}; no cloud resource was accessed.`)
  process.exitCode = 1
} finally {
  await cleanup()
}
