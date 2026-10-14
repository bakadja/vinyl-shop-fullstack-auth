import assert from 'node:assert/strict'
import { test } from 'node:test'
import { access } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { initializeDatabase } from '../scripts/init-db.js'
import { postgresFixture } from '../test-support/postgresql.js'
import { priceNumber, countNumber } from '../db/values.js'

async function fixture(t) {
  const fixture = await postgresFixture(t)
  await initializeDatabase(fixture.database)
  return fixture
}

test('fresh database has the existing schema but no accounts or carts', async t => {
  const { database: db } = await fixture(t)
  const tables = await db.query("SELECT table_name AS name FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE' ORDER BY name")
  assert.deepEqual(tables.rows.map(row => row.name), ['cart_items', 'products', 'users'])
  assert.equal(countNumber((await db.query('SELECT COUNT(*) AS count FROM users')).rows[0].count), 0)
  assert.equal(countNumber((await db.query('SELECT COUNT(*) AS count FROM cart_items')).rows[0].count), 0)
  const constraints = await db.query("SELECT convalidated FROM pg_constraint WHERE connamespace = current_schema()::regnamespace")
  assert.ok(constraints.rows.length >= 8)
  assert.ok(constraints.rows.every(row => row.convalidated))
})

test('demo catalogue retains ten usable products, images and genre filtering', async t => {
  const { database: db } = await fixture(t)
  const products = (await db.query('SELECT * FROM products ORDER BY id')).rows
  assert.equal(products.length, 10)
  assert.deepEqual(products.map(row => row.id), Array.from({ length: 10 }, (_, i) => i + 1))
  for (const product of products) {
    assert.ok(product.title && product.artist)
    assert.ok(Number.isFinite(priceNumber(product.price)) && priceNumber(product.price) > 0)
    assert.equal(product.image, `vinyl${product.id}.png`)
    await access(new URL(`../public/images/${product.image}`, import.meta.url))
  }
  assert.equal((await db.query('SELECT * FROM products WHERE genre = $1', ['indie'])).rows.length, 4)
  assert.equal((await db.query('SELECT * FROM products WHERE title ILIKE $1', ['%Dogma%'])).rows.length, 1)
})

test('fresh schema supports new users and the existing cart queries', async t => {
  const { database: db } = await fixture(t)
  const user = (await db.query('INSERT INTO users (name, email, username, password) VALUES ($1, $2, $3, $4) RETURNING id',
    ['Synthetic demo', 'demo@example.invalid', 'test-user', 'synthetic-test-value'])).rows[0]
  await db.query('INSERT INTO cart_items (user_id, product_id, quantity) VALUES ($1, $2, 1)', [user.id, 1])
  await db.query('UPDATE cart_items SET quantity = quantity + 1 WHERE user_id = $1', [user.id])
  assert.equal(countNumber((await db.query('SELECT SUM(quantity) AS "totalItems" FROM cart_items WHERE user_id = $1', [user.id])).rows[0].totalItems), 2)
  const item = (await db.query('SELECT ci.id AS "cartItemId", ci.quantity, p.price FROM cart_items ci JOIN products p ON p.id = ci.product_id WHERE ci.user_id = $1', [user.id])).rows[0]
  assert.ok(item.cartItemId)
  assert.equal(priceNumber(item.price), 44.99)
  assert.equal(item.quantity, 2)
  await assert.rejects(db.query('INSERT INTO cart_items (user_id, product_id) VALUES ($1, $2)', [user.id, 9999]), { code: '23503' })
  await db.query('DELETE FROM cart_items WHERE user_id = $1', [user.id])
  assert.equal(countNumber((await db.query('SELECT COUNT(*) AS count FROM cart_items')).rows[0].count), 0)
})

test('reinitialization preserves local data without overwriting it', async t => {
  const { database: db } = await fixture(t)
  await db.query('UPDATE products SET stock = 7 WHERE id = 1')
  await db.query("INSERT INTO users(email, username, password) VALUES ('synthetic@example.invalid', 'synthetic', 'unchanged-hash')")
  await db.query('INSERT INTO cart_items(user_id, product_id) SELECT id, 1 FROM users')
  const snapshot = async () => Promise.all(['products', 'users', 'cart_items'].map(async table => (await db.query(`SELECT * FROM ${table} ORDER BY id`)).rows))
  const before = await snapshot()
  await initializeDatabase(db)
  assert.deepEqual(await snapshot(), before)
})

test('documented CLI initializes a new developer directory', async t => {
  const fixture = await postgresFixture(t)
  const output = execFileSync(process.execPath, [fileURLToPath(new URL('../scripts/init-db.js', import.meta.url))], { cwd: fixture.directory, env: fixture.childEnv, encoding: 'utf8' })
  assert.match(output, /catalogue only, no users or carts/)
  for (const [table, expected] of [['products', 10], ['users', 0], ['cart_items', 0]]) {
    assert.equal(countNumber((await fixture.database.query(`SELECT COUNT(*) AS count FROM ${table}`)).rows[0].count), expected)
  }
})
