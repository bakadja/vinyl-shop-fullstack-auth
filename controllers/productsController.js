import { getDatabase } from '../db/db.js'
import { priceNumber } from '../db/values.js'

export async function getGenres(req, res) {
  const { rows } = await getDatabase().query('SELECT DISTINCT genre FROM products')
  res.json(rows.map(row => row.genre))
}

export async function getProducts(req, res) {
  const { genre, search } = req.query
  if ([genre, search].some(value => value !== undefined && typeof value !== 'string')) {
    return res.status(400).json({ error: 'Invalid product filters' })
  }
  const conditions = []
  const params = []
  if (genre) {
    params.push(genre)
    conditions.push(`genre = $${params.length}`)
  }
  if (search) {
    params.push(`%${search}%`)
    const placeholder = `$${params.length}`
    conditions.push(`(title ILIKE ${placeholder} OR artist ILIKE ${placeholder} OR genre ILIKE ${placeholder})`)
  }
  const query = 'SELECT * FROM products' + (conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '')
  const { rows } = await getDatabase().query(query, params)
  res.json(rows.map(row => ({ ...row, price: priceNumber(row.price) })))
}
