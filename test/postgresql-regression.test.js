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

// HTTP regression fixtures use the same verified test-only server and private schemas.
import { fixture, account, register } from '../test-support/http.js'

test('case-insensitive combined search and literal SQL-looking input preserve catalogue contracts', async t => {
  const { client } = await fixture(t)
  const request = client()
  const response = await request('/api/products?genre=rock&search=dogma')
  assert.equal(response.status, 200)
  assert.deepEqual(response.body.map(row => row.id), [1])
  assert.equal(response.body[0].price, 44.99)
  assert.equal(typeof response.body[0].price, 'number')
  assert.equal((await request('/api/products?search=%27%20OR%201%3D1--')).body.length, 0)
})

test('racing duplicate registrations preserve 400 response and unauthenticated loser', async t => {
  const { client, database } = await fixture(t)
  const clients = [client(), client()]
  const responses = await Promise.all(clients.map(request => request('/api/auth/register', { method: 'POST', body: account('racing') })))
  assert.deepEqual(responses.map(row => row.status).sort(), [201, 400])
  const loser = clients[responses.findIndex(row => row.status === 400)]
  assert.deepEqual((await loser('/api/auth/me')).body, { isLoggedIn: false })
  assert.equal((await database.query('SELECT COUNT(*) AS n FROM users')).rows[0].n, '1')
})
