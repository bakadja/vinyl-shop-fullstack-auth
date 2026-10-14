import { getDatabase } from '../db/db.js'
import { priceNumber, integerNumber, countNumber } from '../db/values.js'

function positiveId(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  if (typeof value === 'string' && !/^[1-9]\d*$/.test(value)) return null
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

export async function addToCart(req, res) {
  const productId = positiveId(req.body?.productId)
  if (productId === null) return res.status(400).json({ error: 'Invalid product ID' })
  // A valid safe ID beyond the schema's integer range cannot identify a product.
  if (productId > 2147483647) return res.status(404).json({ error: 'Product not found' })
  const result = await getDatabase().query(`
    INSERT INTO cart_items (user_id, product_id, quantity)
    SELECT $1, id, 1 FROM products WHERE id = $2
    ON CONFLICT (user_id, product_id) DO UPDATE SET quantity = cart_items.quantity + 1
  `, [req.session.userId, productId])
  if (!result.rowCount) return res.status(404).json({ error: 'Product not found' })
  res.json({ message: 'Added to cart' })
}

export async function getCartCount(req, res) {
  const { rows } = await getDatabase().query('SELECT SUM(quantity) AS "totalItems" FROM cart_items WHERE user_id = $1', [req.session.userId])
  res.json({ totalItems: countNumber(rows[0].totalItems) })
}

export async function getAll(req, res) {
  const { rows } = await getDatabase().query('SELECT ci.id AS "cartItemId", ci.quantity, p.title, p.artist, p.price FROM cart_items ci JOIN products p ON p.id = ci.product_id WHERE ci.user_id = $1', [req.session.userId])
  res.json({ items: rows.map(item => ({ ...item, cartItemId: integerNumber(item.cartItemId), quantity: integerNumber(item.quantity), price: priceNumber(item.price) })) })
}

export async function deleteItem(req, res) {
  const itemId = positiveId(req.params.itemId)
  if (itemId === null) return res.status(400).json({ error: 'Invalid item ID' })
  if (itemId > 2147483647) return res.status(400).json({ error: 'Item not found' })
  const result = await getDatabase().query('DELETE FROM cart_items WHERE id = $1 AND user_id = $2', [itemId, req.session.userId])
  if (!result.rowCount) return res.status(400).json({ error: 'Item not found' })
  res.status(204).send()
}

export async function deleteAll(req, res) {
  await getDatabase().query('DELETE FROM cart_items WHERE user_id = $1', [req.session.userId])
  res.status(204).send()
}
