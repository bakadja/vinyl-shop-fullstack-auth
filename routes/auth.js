import { logoutPolicy } from '../sessions/policy.js'
import { asyncHandler } from '../middleware/asyncHandler.js'
import { registerUser, loginUser, logoutUser } from '../controllers/authController.js'
import express from 'express'

export const authRouter = express.Router()

authRouter.post('/register', asyncHandler(registerUser))
authRouter.post('/login', asyncHandler(loginUser))
authRouter.post('/logout', (req, res, next) => logoutPolicy(req.app.locals.sessionConfig)(req, res, next), asyncHandler(logoutUser))


export function logoutMethodGuard(req, res, next) {
  if (req.path !== '/' || !['GET', 'HEAD'].includes(req.method)) return next()
  res.status(405).set({ Allow: 'POST', 'Cache-Control': 'no-store' })
  if (req.method === 'HEAD') return res.end()
  res.json({ error: 'Method not allowed' })
}
