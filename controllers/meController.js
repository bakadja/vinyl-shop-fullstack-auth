import { invalidateSession } from '../sessions/policy.js'
import { getDatabase } from '../db/db.js'

export async function getCurrentUser(req, res) {
  try {
    const db = getDatabase()

    if (!req.session?.userId) {

      return res.json({ isLoggedIn: false })
      
    }

    const user = (await db.query('SELECT name FROM users WHERE id = $1', [req.session.userId])).rows[0]

    if (!user) {
      await invalidateSession(req, res, req.app.locals.sessionConfig)
      return res.json({ isLoggedIn: false })
    }
    res.json({ isLoggedIn: true, name: user.name})

  } catch (err) {
    if (err?.code === 'ECONNREFUSED') console.error('Current user database connection refused')
    else console.error('Current user database operation failed')
    res.status(500).json({ error: 'Internal server error' })
  }
} 