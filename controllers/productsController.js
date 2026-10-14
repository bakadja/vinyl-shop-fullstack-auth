import { getDBConnection } from '../db/db.js'

export async function getGenres(req, res) {
  const db = await getDBConnection()
  try {
    const rows = await db.all('SELECT DISTINCT genre FROM products')
    res.json(rows.map(row => row.genre))
  } finally { await db.close() }
}

export async function getProducts(req, res) {
  const { genre, search } = req.query
  if ([genre, search].some(value => value !== undefined && typeof value !== 'string')) {
    return res.status(400).json({ error: 'Invalid product filters' })
  }
  const conditions = []
  const params = []
  if (genre) {
    conditions.push('genre = ?')
    params.push(genre)
  }
  if (search) {
    conditions.push('(title LIKE ? OR artist LIKE ? OR genre LIKE ?)')
    const pattern = `%${search}%`
    params.push(pattern, pattern, pattern)
  }
  const query = 'SELECT * FROM products' + (conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '')
  const db = await getDBConnection()
  try { res.json(await db.all(query, params)) } finally { await db.close() }
}
