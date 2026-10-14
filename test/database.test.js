import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import sqlite3 from 'sqlite3'
import { open } from 'sqlite'
import { initializeDatabase } from '../scripts/init-db.js'

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'vinyl-db-test-'))
  const filename = join(directory, 'database.db')
  await initializeDatabase(filename)
  const db = await open({ filename, driver: sqlite3.Database })
  t.after(async () => {
    await db.close()
    await rm(directory, { recursive: true, force: true })
  })
  return { directory, filename, db }
}

test('fresh database has the existing schema but no accounts or carts', async t => {
  const { db } = await fixture(t)
  const tables = await db.all("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
  assert.deepEqual(tables.map(row => row.name), ['cart_items', 'products', 'users'])
  assert.equal((await db.get('SELECT COUNT(*) AS count FROM users')).count, 0)
  assert.equal((await db.get('SELECT COUNT(*) AS count FROM cart_items')).count, 0)
  assert.equal((await db.get('PRAGMA integrity_check')).integrity_check, 'ok')
  assert.deepEqual(await db.all('PRAGMA foreign_key_check'), [])
})

test('demo catalogue retains ten usable products, images and genre filtering', async t => {
  const { db } = await fixture(t)
  const products = await db.all('SELECT * FROM products ORDER BY id')
  assert.equal(products.length, 10)
  assert.deepEqual(products.map(row => row.id), Array.from({ length: 10 }, (_, i) => i + 1))
  for (const product of products) {
    assert.ok(product.title && product.artist)
    assert.ok(Number.isFinite(product.price) && product.price > 0)
    assert.equal(product.image, `vinyl${product.id}.png`)
    await access(new URL(`../public/images/${product.image}`, import.meta.url))
  }
  assert.equal((await db.all('SELECT * FROM products WHERE genre = ?', ['indie'])).length, 4)
  assert.equal((await db.all('SELECT * FROM products WHERE title LIKE ?', ['%Dogma%'])).length, 1)
})

test('fresh schema supports new users and the existing cart queries', async t => {
  const { db } = await fixture(t)
  await db.exec('PRAGMA foreign_keys = ON')
  const user = await db.run('INSERT INTO users (name, email, username, password) VALUES (?, ?, ?, ?)',
    ['Synthetic demo', 'demo@example.invalid', 'test-user', 'synthetic-test-value'])
  await db.run('INSERT INTO cart_items (user_id, product_id, quantity) VALUES (?, ?, 1)', [user.lastID, 1])
  await db.run('UPDATE cart_items SET quantity = quantity + 1 WHERE user_id = ?', [user.lastID])
  assert.equal((await db.get('SELECT SUM(quantity) AS totalItems FROM cart_items WHERE user_id = ?', [user.lastID])).totalItems, 2)
  const item = await db.get('SELECT ci.id AS cartItemId, ci.quantity, p.price FROM cart_items ci JOIN products p ON p.id = ci.product_id WHERE ci.user_id = ?', [user.lastID])
  assert.ok(item.cartItemId)
  assert.equal(item.price, 44.99)
  assert.equal(item.quantity, 2)
  await assert.rejects(db.run('INSERT INTO cart_items (user_id, product_id) VALUES (?, ?)', [user.lastID, 9999]))
  await db.run('DELETE FROM cart_items WHERE user_id = ?', [user.lastID])
  assert.equal((await db.get('SELECT COUNT(*) AS count FROM cart_items')).count, 0)
})

test('reinitialization refuses to overwrite local data', async t => {
  const { filename, db } = await fixture(t)
  await db.run('UPDATE products SET stock = 7 WHERE id = 1')
  const before = await readFile(filename)
  await assert.rejects(initializeDatabase(filename), { code: 'EEXIST' })
  assert.throws(() => execFileSync(process.execPath,
    [fileURLToPath(new URL('../scripts/init-db.js', import.meta.url))],
    { cwd: join(filename, '..'), encoding: 'utf8', stdio: 'pipe' }), error => {
    assert.equal(error.status, 1)
    assert.match(error.stderr, /already exists/)
    return true
  })
  assert.deepEqual(await readFile(filename), before)
})

test('documented CLI initializes a new developer directory', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'vinyl-cli-test-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const script = new URL('../scripts/init-db.js', import.meta.url)
  const output = execFileSync(process.execPath, [fileURLToPath(script)], { cwd: directory, encoding: 'utf8' })
  assert.match(output, /catalogue only, no users or carts/)
  const db = await open({ filename: join(directory, 'database.db'), driver: sqlite3.Database })
  try {
    assert.equal((await db.get('SELECT COUNT(*) AS count FROM products')).count, 10)
    assert.equal((await db.get('SELECT COUNT(*) AS count FROM users')).count, 0)
    assert.equal((await db.get('SELECT COUNT(*) AS count FROM cart_items')).count, 0)
  } finally {
    await db.close()
  }
})
