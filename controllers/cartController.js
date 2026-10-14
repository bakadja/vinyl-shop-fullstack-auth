import { getDBConnection } from '../db/db.js'

function positiveId(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  if (typeof value === 'string' && !/^[1-9]\d*$/.test(value)) return null
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

export async function addToCart(req, res) {
  const productId = positiveId(req.body?.productId)
  if (productId === null) return res.status(400).json({ error: 'Invalid product ID' })

  const db = await getDBConnection()
  try {
    // One SQLite statement makes lookup/increment/insert atomic across requests.
    // The SELECT produces no row for an unknown product, so no orphan is inserted.
    const result = await db.run(`
      INSERT INTO cart_items (id, user_id, product_id, quantity)
      SELECT (SELECT id FROM cart_items WHERE user_id = $userId AND product_id = $productId),
             $userId, id, 1
      FROM products WHERE id = $productId
      ON CONFLICT(id) DO UPDATE SET quantity = cart_items.quantity + 1
    `, { $userId: req.session.userId, $productId: productId })
    if (!result.changes) return res.status(404).json({ error: 'Product not found' })
    res.json({ message: 'Added to cart' })
  } finally {
    await db.close()
  }
}

export async function getCartCount(req, res) {
  const db = await getDBConnection()
  try {
    const result = await db.get('SELECT SUM(quantity) AS totalItems FROM cart_items WHERE user_id = ?', [req.session.userId])
    res.json({ totalItems: result.totalItems || 0 })
  } finally { await db.close() }
}

export async function getAll(req, res) {
  const db = await getDBConnection()
  try {
    const items = await db.all('SELECT ci.id AS cartItemId, ci.quantity, p.title, p.artist, p.price FROM cart_items ci JOIN products p ON p.id = ci.product_id WHERE ci.user_id = ?', [req.session.userId])
    res.json({ items })
  } finally { await db.close() }
}

export async function deleteItem(req, res) {
  const itemId = positiveId(req.params.itemId)
  if (itemId === null) return res.status(400).json({ error: 'Invalid item ID' })
  const db = await getDBConnection()
  try {
    const result = await db.run('DELETE FROM cart_items WHERE id = ? AND user_id = ?', [itemId, req.session.userId])
    // Preserve the existing missing/foreign-item response without disclosing ownership.
    if (!result.changes) return res.status(400).json({ error: 'Item not found' })
    res.status(204).send()
  } finally { await db.close() }
}

export async function deleteAll(req, res) {
  const db = await getDBConnection()
  try {
    await db.run('DELETE FROM cart_items WHERE user_id = ?', [req.session.userId])
    res.status(204).send()
  } finally { await db.close() }
}
