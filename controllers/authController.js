import { invalidateSession } from '../sessions/policy.js'
import { establishSession } from '../sessions/authentication.js'
import isEmail from 'validator/lib/isEmail.js'
import { getDatabase } from '../db/db.js'
import bcrypt from 'bcryptjs'
import { randomBytes } from 'node:crypto'
import { authenticationFailureClass } from '../sessions/failure-class.js'

const dummyPasswordHash = bcrypt.hashSync(randomBytes(32).toString('hex'), 10)
const bounded = (value, bytes) => typeof value === 'string' && Buffer.byteLength(value, 'utf8') <= bytes

export async function registerUser(req, res) {

  let { name, email, username, password } = req.body ?? {}

  if (![name, email, username, password].every(value => typeof value === 'string' && value.trim())) {

    return res.status(400).json({ error: 'All fields are required.' })

  }

  // bcrypt accepts only the first 72 UTF-8 bytes; new registrations must not silently truncate.
  if (!bounded(name, 1024) || !bounded(email, 254) || !bounded(password, 72)) {
    return res.status(400).json({ error: 'Registration fields exceed supported size limits.' })
  }

  name = name.trim()
  email = email.trim()
  username = username.trim()

  if (!/^[a-zA-Z0-9_-]{1,20}$/.test(username)) {

    return res.status(400).json(
      { error: 'Username must be 1–20 characters, using letters, numbers, _ or -.' }
    )
  }

  if (!isEmail(email)) {

    return res.status(400).json({ error: 'Invalid email format' })

  }

  try {

    const db = getDatabase()

    const existing = (await db.query('SELECT id FROM users WHERE email = $1 OR username = $2', [email, username])).rows[0]

    if (existing) {
      return res.status(400).json({ error: 'Email or username already in use.' })
    }

    const hashed = await bcrypt.hash(password, 10)

    const result = await db.query('INSERT INTO users (name, email, username, password) VALUES ($1, $2, $3, $4) RETURNING id', [name, email, username, hashed])

    await establishSession(req, res, result.rows[0].id, req.app.locals.sessionConfig)

    res.status(201).json({ message: 'User registered' })
  } catch (err) {
 
    if (err.code === '23505') return res.status(400).json({ error: 'Email or username already in use.' })
    console.error('Registration database operation failed')
    res.status(500).json({ error: 'Registration failed. Please try again.' })

  }

}

export async function loginUser(req, res) {

  let { username, password } = req.body ?? {}

  if (![username, password].every(value => typeof value === 'string' && value.trim())) {
    return res.status(400).json({ error: 'All fields are required' } )
  }

  if (!bounded(username, 1024) || !bounded(password, 8192)) {
    return res.status(400).json({ error: 'Login fields exceed supported size limits.' })
  }

  username = username.trim()

  let stage = 'postgres_user_lookup'
  try {
    const db = getDatabase()

    const user = (await db.query('SELECT * FROM users WHERE username = $1', [username])).rows[0]

    stage = 'bcrypt_compare'
    const isValid = await bcrypt.compare(password, user?.password ?? dummyPasswordHash)

    if (!user || !isValid) {

      return res.status(401).json({ error: 'Invalid credentials'})

    }

    stage = 'session_persistence'
    await establishSession(req, res, user.id, req.app.locals.sessionConfig)
    res.json({ message: 'Logged in' })

  } catch (err) {
    console.error(`Login failed (stage=${stage}, class=${authenticationFailureClass(err)})`)
    res.status(500).json({ error: 'Login failed. Please try again.' })
  }
}


export async function logoutUser(req, res) {
  try {
    await invalidateSession(req, res, req.app.locals.sessionConfig)
    res.json({ message: 'Logged out' })
  } catch {
    console.error('Logout session destruction failed')
    res.status(500).json({ error: 'Logout failed. Please try again.' })
  }
}
