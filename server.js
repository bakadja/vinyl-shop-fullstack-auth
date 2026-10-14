import { closeDatabase } from './db/db.js'
import express from 'express'
import { productsRouter } from './routes/products.js'
import { authRouter } from './routes/auth.js'
import { meRouter } from './routes/me.js'
import { cartRouter } from './routes/cart.js' 
import session from 'express-session'

const app = express() 
const PORT = Number(process.env.PORT ?? 8000)
const secret = process.env.SPIRAL_SESSION_SECRET || 'jellyfish-baskingshark'

app.use(express.json()) 

app.use(session({
  secret: secret,
  resave: false, 
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: false,
    sameSite: 'lax'
  }
}))

app.use(express.static('public'))

app.use('/api/products', productsRouter)

app.use('/api/auth/me', meRouter)

app.use('/api/auth', authRouter)

app.use('/api/cart', cartRouter)
 
// Keep API failures JSON and never return stack traces or database messages.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err)
  let status = 500
  let error = 'Internal server error'
  if (err.status === 400) {
    status = 400
    error = 'Invalid request body'
  } else if (err.status === 413) {
    status = 413
    error = 'Request body too large'
  }
  res.status(status).json({ error })
})

const server = app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${server.address().port}`)
}).on('error', (err) => {
  console.error('Failed to start server:', err)
})

let shuttingDown = false
function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  server.close(async () => {
    try { await closeDatabase() } catch {
      console.error('PostgreSQL shutdown failed')
      process.exitCode = 1
    }
  })
}
process.once('SIGTERM', shutdown)
process.once('SIGINT', shutdown)
