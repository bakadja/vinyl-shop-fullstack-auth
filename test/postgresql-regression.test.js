import assert from 'node:assert/strict'
import { test } from 'node:test'
import { postgresFixture } from '../test-support/postgresql.js'
import { initializeDatabase } from '../scripts/init-db.js'

test('parallel initialization preserves catalogue and generated identities', async t => {
  const { database } = await postgresFixture(t)
  await Promise.all([initializeDatabase(database), initializeDatabase(database), initializeDatabase(database)])
  assert.equal((await database.query('SELECT COUNT(*) AS n FROM products')).rows[0].n, '10')
  const inserted = await database.query("INSERT INTO products(title,artist,price,image) VALUES ('Synthetic','Synthetic',1,'synthetic.png') RETURNING id")
  assert.equal(inserted.rows[0].id, 11)
  await initializeDatabase(database)
  assert.equal((await database.query("INSERT INTO products(title,artist,price,image) VALUES ('Synthetic','Synthetic',1,'synthetic.png') RETURNING id")).rows[0].id, 12)
})

test('transaction rollback preserves data and releases a usable client', async t => {
  const { database } = await postgresFixture(t)
  await initializeDatabase(database)
  await assert.rejects(database.transaction(async client => {
    await client.query('DELETE FROM products')
    throw new Error('synthetic failure')
  }), /synthetic failure/)
  assert.equal((await database.query('SELECT COUNT(*) AS n FROM products')).rows[0].n, '10')
  assert.equal(await database.transaction(async client => (await client.query('SELECT 1 AS n')).rows[0].n), 1)
})

test('incompatible existing schema fails without partially initialized tables', async t => {
  const { database } = await postgresFixture(t)
  await database.query('CREATE TABLE products(id integer PRIMARY KEY, title text)')
  await assert.rejects(initializeDatabase(database))
  assert.deepEqual((await database.query("SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() ORDER BY table_name")).rows.map(row => row.table_name), ['products'])
})

test('PostgreSQL foreign keys and account/cart uniqueness are enforced', async t => {
  const { database } = await postgresFixture(t)
  await initializeDatabase(database)
  const user = (await database.query("INSERT INTO users(email, username, password) VALUES ('fixture@example.invalid', 'fixture', 'synthetic') RETURNING id")).rows[0].id
  await assert.rejects(database.query("INSERT INTO users(email, username, password) VALUES ('fixture@example.invalid', 'other', 'synthetic')"), { code: '23505' })
  await assert.rejects(database.query("INSERT INTO users(email, username, password) VALUES ('other@example.invalid', 'fixture', 'synthetic')"), { code: '23505' })
  await assert.rejects(database.query('INSERT INTO cart_items(user_id, product_id) VALUES ($1, 99999)', [user]), { code: '23503' })
  await assert.rejects(database.query('INSERT INTO cart_items(user_id, product_id) VALUES (99999, 1)'), { code: '23503' })
  await database.query('INSERT INTO cart_items(user_id, product_id) VALUES ($1, 1)', [user])
  await assert.rejects(database.query('INSERT INTO cart_items(user_id, product_id) VALUES ($1, 1)', [user]), { code: '23505' })
  await assert.rejects(database.query('DELETE FROM users WHERE id = $1', [user]), { code: '23503' })
})
