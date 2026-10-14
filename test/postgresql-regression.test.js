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

test('larger concurrent cart additions stay atomic and isolated for each user', async t => {
  const { client, database } = await fixture(t)
  const alice = client()
  const bob = client()
  await register(alice, account('parallel-alice'))
  await register(bob, account('parallel-bob'))
  const responses = await Promise.all(Array.from({ length: 40 }, (_, index) => (index % 2 ? alice : bob)('/api/cart/add', { method: 'POST', body: { productId: index % 3 ? '1' : 1 } })))
  assert.ok(responses.every(response => response.status === 200))
  for (const request of [alice, bob]) {
    const items = (await request('/api/cart')).body.items
    assert.equal(items.length, 1)
    assert.equal(items[0].quantity, 20)
    assert.equal(typeof items[0].cartItemId, 'number')
    assert.equal(typeof items[0].price, 'number')
    assert.deepEqual((await request('/api/cart/cart-count')).body, { totalItems: 20 })
  }
  assert.equal((await database.query('SELECT COUNT(*) AS n FROM cart_items')).rows[0].n, '2')
})

test('valid safe IDs above PostgreSQL integer range preserve missing-item responses', async t => {
  const { client } = await fixture(t)
  const request = client()
  await register(request)
  for (const id of [2147483648, Number.MAX_SAFE_INTEGER]) {
    assert.equal((await request('/api/cart/add', { method: 'POST', body: { productId: id } })).status, 404)
    assert.equal((await request(`/api/cart/${id}`, { method: 'DELETE' })).status, 400)
  }
})

test('unsafe aggregate values fail with sanitized JSON instead of rounded counts', async t => {
  const { client, database } = await fixture(t)
  const request = client()
  await register(request)
  // Simulate an incompatible externally modified column only inside this disposable schema.
  await database.query('ALTER TABLE cart_items ALTER COLUMN quantity TYPE bigint')
  await database.query('INSERT INTO cart_items(user_id, product_id, quantity) SELECT id, 1, 9007199254740991 FROM users')
  await database.query('INSERT INTO cart_items(user_id, product_id, quantity) SELECT id, 2, 1 FROM users')
  const response = await request('/api/cart/cart-count')
  assert.equal(response.status, 500)
  assert.deepEqual(response.body, { error: 'Internal server error' })
})

test('graceful shutdown finishes an in-flight cart request and closes database sessions', async t => {
  const { client, database, shutdown } = await fixture(t)
  const request = client()
  await register(request)
  await request('/api/cart/add', { method: 'POST', body: { productId: 1 } })
  let release
  let locked
  const lockReady = new Promise(resolve => { locked = resolve })
  const gate = new Promise(resolve => { release = resolve })
  const transaction = database.transaction(async connection => {
    await connection.query('LOCK TABLE cart_items IN ACCESS EXCLUSIVE MODE')
    locked()
    await gate
  })
  await lockReady
  const pending = request('/api/cart/add', { method: 'POST', body: { productId: 1 } })
  // Attach an error handler immediately while checking server-side blocked activity.
  pending.catch(() => {})
  let waiting = false
  for (let i = 0; i < 100; i++) {
    waiting = (await database.query("SELECT 1 FROM pg_stat_activity WHERE application_name = 'vinyl-shop' AND wait_event_type = 'Lock'")).rows.length > 0
    if (waiting) break
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  try {
    assert.ok(waiting, 'HTTP query must be waiting on the database lock')
    const exited = shutdown()
    release()
    await transaction
    assert.equal((await pending).status, 200)
    assert.equal((await exited)[0], 0)
  } finally { release(); await transaction }
})
