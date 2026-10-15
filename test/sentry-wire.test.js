import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
const release = 'b'.repeat(40)

async function receiver(t, hang = false) {
  const requests = []
  const server = createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    requests.push({ url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString() })
    if (!hang) res.writeHead(200).end('{}')
  }).listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => { server.closeAllConnections(); server.close() })
  return { requests, dsn: `http://local@127.0.0.1:${server.address().port}/1` }
}
async function run(mode, dsn = '') {
  const args = mode === 'probe' ? [new URL('../scripts/sentry-probe.js', import.meta.url).pathname] :
    ['--import', new URL('../instrument.js', import.meta.url).pathname, new URL('../test-support/sentry-process.js', import.meta.url).pathname, mode]
  const child = spawn(process.execPath, args, {
    env: { SENTRY_DSN: dsn, SENTRY_ENVIRONMENT: 'test', SENTRY_RELEASE: release,
      ...(mode === 'probe' ? { SENTRY_PROBE_APPROVED: 'yes', SENTRY_PRIVACY_REVIEWED: 'yes', SENTRY_QUOTA_REVIEWED: 'yes',
        SENTRY_ZERO_SPEND_CONFIRMED: 'yes', SENTRY_PROBE_PROJECT: 'baki-dev/vinyl-shop-api' } : {}),
      SENTRY_DEBUG: 'true', SENTRY_TRACES_SAMPLE_RATE: '1', SENTRY_SPOTLIGHT: 'http://127.0.0.1:1' },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let stdout = '', stderr = ''
  child.stdout.on('data', chunk => { stdout += chunk })
  child.stderr.on('data', chunk => { stderr += chunk })
  const timer = setTimeout(() => child.kill('SIGKILL'), 10000)
  try { const [code] = await once(child, 'exit'); return { code, stdout, stderr } }
  finally { clearTimeout(timer) }
}
function events(requests) {
  return requests.map(request => {
    assert.equal(new URL(request.url, 'http://localhost').pathname, '/api/1/envelope/')
    assert.doesNotMatch(JSON.stringify(request), /fictional-private|192\.0\.2\.1|attachment|breadcrumb|stacktrace|contexts|sentry-trace|baggage|\/Users\/|password|sql/i)
    const lines = request.body.trim().split('\n')
    assert.equal(lines.length, 3, 'only one error item is allowed per envelope')
    assert.deepEqual(JSON.parse(lines[1]), { type: 'event' })
    const event = JSON.parse(lines[2])
    assert.equal(event.environment, 'test')
    assert.equal(event.release, release)
    assert.equal(event.exception.values[0].type, 'BackendFailure')
    return event
  })
}

test('real SDK wire envelopes contain one sanitized event per 5xx, including caught failures', async t => {
  const r = await receiver(t)
  const result = await run('requests', r.dsn)
  assert.equal(result.code, 0, result.stderr)
  assert.equal(result.stderr, '')
  assert.equal(JSON.parse(result.stdout).status, 200)
  assert.equal(events(r.requests).length, 2)
})
test('automatic fatal handlers sanitize exceptions and rejections before the actual transport', async t => {
  const r = await receiver(t)
  for (const mode of ['uncaught', 'rejection']) {
    const result = await run(mode, r.dsn)
    assert.equal(result.code, 1)
    assert.doesNotMatch(result.stdout + result.stderr, /fictional-private/)
  }
  assert.equal(events(r.requests).length, 2)
})
test('scope, direct SDK calls, attachments, logging and metrics cannot bypass the envelope filter', async t => {
  const r = await receiver(t)
  const result = await run('hostile', r.dsn)
  assert.equal(result.code, 0, result.stderr)
  assert.equal(result.stderr, '')
  assert.equal(events(r.requests).length, 4)
})
test('controlled synthetic probe sends exactly one event with correct release and environment', async t => {
  const r = await receiver(t)
  const result = await run('synthetic', r.dsn)
  assert.equal(result.code, 0, result.stderr)
  assert.equal(result.stderr, '')
  const sent = events(r.requests)
  assert.equal(sent.length, 1)
  assert.equal(sent[0].tags.operation, 'synthetic')
})
test('missing or malformed DSN leaves the app functional; endpoint failures do not block requests', async t => {
  for (const dsn of ['', 'invalid', 'http://local@127.0.0.1:1/1']) {
    const result = await run('requests', dsn)
    assert.equal(result.code, 0, result.stderr)
    assert.equal(result.stderr, '')
    assert.equal(JSON.parse(result.stdout).status, 200)
  }
  const r = await receiver(t, true)
  const result = await run('requests', r.dsn)
  assert.equal(result.code, 0, result.stderr)
  assert.equal(result.stderr, '')
  assert.equal(JSON.parse(result.stdout).status, 200)
})

test('a second uncaught failure during fatal flush cannot reveal raw errors or duplicate the fatal incident', async t => {
  const r = await receiver(t, true)
  const result = await run('double-uncaught', r.dsn)
  assert.equal(result.code, 1)
  assert.doesNotMatch(result.stdout + result.stderr, /fictional-private|Error:| at /)
  assert.equal(events(r.requests).length, 1)
})

test('operator CLI sends one synthetic event and prints the ID actually received on the wire', async t => {
  const r = await receiver(t)
  const result = await run('probe', r.dsn)
  assert.equal(result.code, 0, result.stderr)
  assert.equal(result.stderr, '')
  const sent = events(r.requests)
  assert.equal(sent.length, 1)
  assert.equal(sent[0].tags.operation, 'synthetic')
  assert.ok(result.stdout.includes(sent[0].event_id))
})
