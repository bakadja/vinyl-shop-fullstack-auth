import { Router } from 'express'

// Registered after productionTransport and before session middleware.
export function healthRouter(database) {
  const router = Router()
  router.use('/health', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next() })
  router.get('/health/live', (_req, res) => res.json({ status: 'ok' }))
  router.get('/health/ready', async (_req, res) => {
    try {
      await database.query({ text: 'SELECT 1', query_timeout: 1000 })
      res.json({ status: 'ok' })
    } catch {
      res.status(503).json({ status: 'unavailable' })
    }
  })
  return router
}
