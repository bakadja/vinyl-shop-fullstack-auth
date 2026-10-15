// Test-only Express application. Never included in the Azure runtime artifact.
import express from 'express'
import * as Sentry from '@sentry/node'
import { requestTelemetry, flushTelemetry, captureFailure } from '../telemetry/sentry.js'
const marker = 'fictional-private-value@example.invalid'
const mode = process.argv[2]
const dirty = () => Object.assign(new Error(marker, { cause: new Error(marker) }), {
  detail: marker, query: marker, parameters: [marker], code: marker,
  stack: `Error: ${marker}\n at ${marker} (https://example.invalid/${marker}:1:2)`
})
Sentry.setUser({ email: marker, username: marker, ip_address: '192.0.2.1' })
Sentry.setContext('private', { marker })
Sentry.setExtra('sql', marker)
Sentry.addBreadcrumb({ message: marker, data: { marker } })
Sentry.setTag(marker, marker)
if (mode === 'double-uncaught') {
  setImmediate(() => { throw dirty() })
  setTimeout(() => { throw dirty() }, 20)
}
else if (mode === 'uncaught') setImmediate(() => { throw dirty() })
else if (mode === 'rejection') setImmediate(() => { void Promise.reject(dirty()) })
else {
  const app = express()
  app.disable('x-powered-by')
  app.use(requestTelemetry)
  app.use(express.json())
  app.all('/failure', (_req, _res, next) => next(dirty()))
  app.get('/caught', (_req, res) => { try { throw dirty() } catch { res.status(500).json({ error: 'Sanitized' }) } })
  app.get('/expected/:status', (req, res) => res.status(Number(req.params.status)).end())
  app.use((err, _req, res, _next) => res.status(500).json({ error: 'Internal server error' }))
  const server = app.listen(0, '127.0.0.1', async () => {
    const origin = `http://127.0.0.1:${server.address().port}`
    await Promise.all([400, 401, 403, 429].map(async status => {
      await fetch(`${origin}/expected/${status}`)
      Sentry.captureException(Object.assign(dirty(), { status }))
    }))
    // SDK APIs and attachments must still pass the wire-level allowlist.
    if (mode === 'hostile') {
      Sentry.getCurrentScope().addAttachment({ filename: marker, data: marker })
      Sentry.captureException(dirty())
      Sentry.captureEvent({ message: marker, request: { url: marker }, contexts: { private: { marker } } })
      Sentry.captureMessage(marker)
      Sentry.logger.error(marker)
      Sentry.metrics.count(marker, 1)
      await Sentry.getClient().getTransport().send([{ trace: { marker }, marker }, [
        [{ type: 'event' }, { message: marker, exception: { values: [{ value: marker }] }, extra: { marker } }],
        [{ type: 'attachment', filename: marker }, marker], [{ type: 'transaction' }, { marker }]
      ]])
    }
    if (mode === 'synthetic') captureFailure('synthetic')
    else if (mode !== 'hostile') {
      const response = await fetch(`${origin}/failure?private=${marker}`, { method: 'POST', headers: {
        'content-type': 'application/json', cookie: marker, authorization: marker,
        'sentry-trace': 'a'.repeat(32) + '-' + 'b'.repeat(16) + '-1', baggage: `sentry-user_id=${marker}`
      }, body: JSON.stringify({ password: marker, email: marker }) })
      if (response.headers.has('x-powered-by')) throw new Error('Unexpected framework disclosure')
      if (response.status !== 500 || (await response.json()).error !== 'Internal server error') throw new Error('Response changed')
      const caught = await fetch(`${origin}/caught`)
      if (caught.status !== 500) throw new Error('Response changed')
    }
    const healthy = await fetch(`${origin}/expected/200`)
    const flushed = await flushTelemetry()
    server.close()
    console.log(JSON.stringify({ status: healthy.status, flushed }))
  })
}
