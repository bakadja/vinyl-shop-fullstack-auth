import assert from 'node:assert/strict'
import { test } from 'node:test'
import sqlite3 from 'sqlite3'
import { open } from 'sqlite'
import { join } from 'node:path'
import bcrypt from 'bcryptjs'
import { fixture, account, register } from '../test-support/http.js'

function apiTest(name, run) {
  test(name, { timeout: 20000 }, async t => run(await fixture(t)))
}

apiTest('registration creates a session and stores a hashed password', async ({ client, directory }) => {
  const request = client()
  const user = account()
  const response = await request('/api/auth/register', { method: 'POST', body: user })
  assert.equal(response.status, 201)
  assert.match(response.cookie, /connect\.sid=/)
  assert.match(response.cookie, /HttpOnly/i)
  assert.deepEqual(await request('/api/auth/me'), {
    status: 200, body: { isLoggedIn: true, name: user.name }, cookie: null
  })
  const db = await open({ filename: join(directory, 'database.db'), driver: sqlite3.Database })
  try {
    const row = await db.get('SELECT password FROM users WHERE username = ?', [user.username])
    assert.notEqual(row.password, user.password)
    assert.equal(await bcrypt.compare(user.password, row.password), true)
  } finally { await db.close() }
})

apiTest('registration rejects missing fields, invalid email and invalid username', async ({ client }) => {
  const request = client()
  for (const body of [{}, { ...account(), email: 'invalid' }, { ...account(), username: 'invalid space' }]) {
    const response = await request('/api/auth/register', { method: 'POST', body })
    assert.equal(response.status, 400)
    assert.ok(response.body.error)
  }
  assert.deepEqual((await request('/api/auth/me')).body, { isLoggedIn: false })
  await register(request)
})

apiTest('duplicate email and username are rejected without authenticating the caller', async ({ client }) => {
  await register(client())
  const request = client()
  for (const body of [{ ...account('other-user'), email: account().email }, { ...account(), email: 'other@example.com' }]) {
    assert.equal((await request('/api/auth/register', { method: 'POST', body })).status, 400)
  }
  assert.deepEqual((await request('/api/auth/me')).body, { isLoggedIn: false })
})

apiTest('login authenticates an existing user with a fresh client', async ({ client }) => {
  const user = await register(client())
  const request = client()
  assert.deepEqual((await request('/api/auth/me')).body, { isLoggedIn: false })
  const response = await request('/api/auth/login', { method: 'POST', body: { username: user.username, password: user.password } })
  assert.equal(response.status, 200)
  assert.match(response.cookie, /connect\.sid=/)
  assert.deepEqual((await request('/api/auth/me')).body, { isLoggedIn: true, name: user.name })
  assert.equal((await request('/api/cart')).status, 200)
})

apiTest('login rejects missing and incorrect credentials without creating a session', async ({ client }) => {
  await register(client())
  const request = client()
  for (const [body, status] of [
    [{}, 400],
    [{ username: 'unknown', password: account().password }, 401],
    [{ username: account().username, password: 'wrong-password' }, 401]
  ]) {
    assert.equal((await request('/api/auth/login', { method: 'POST', body })).status, status)
    assert.deepEqual((await request('/api/auth/me')).body, { isLoggedIn: false })
    assert.equal((await request('/api/cart')).status, 401)
  }
})

apiTest('logout invalidates the old session cookie', async ({ client }) => {
  const request = client()
  await register(request)
  assert.equal((await request('/api/auth/logout')).status, 200)
  // The client retains the original cookie: the server must invalidate it.
  assert.deepEqual((await request('/api/auth/me')).body, { isLoggedIn: false })
  assert.equal((await request('/api/cart')).status, 401)
})

apiTest('all cart endpoints reject anonymous clients', async ({ client }) => {
  const request = client()
  for (const [path, method, body] of [
    ['/api/cart', 'GET'], ['/api/cart/cart-count', 'GET'],
    ['/api/cart/add', 'POST', { productId: 1 }],
    ['/api/cart/1', 'DELETE'], ['/api/cart/all', 'DELETE']
  ]) {
    const response = await request(path, { method, body })
    assert.equal(response.status, 401)
    assert.deepEqual(response.body, { error: 'Unauthorized' })
  }
  await register(request)
  assert.deepEqual((await request('/api/cart')).body, { items: [] })
})

apiTest('public catalogue returns fictional product details and genres', async ({ client }) => {
  const request = client()
  const products = await request('/api/products')
  assert.equal(products.status, 200)
  assert.equal(products.body.length, 10)
  assert.deepEqual(products.body.find(row => row.id === 1), {
    id: 1, title: 'Selling Dogma', artist: 'The Clouds', price: 44.99,
    image: 'vinyl1.png', year: 2003, genre: 'rock', stock: 12
  })
  const genres = await request('/api/products/genres')
  assert.equal(genres.status, 200)
  assert.deepEqual(genres.body.sort(), ['ambient', 'folk', 'indie', 'punk', 'rock'])
})

apiTest('catalogue supports genre filtering, title/artist search and empty results', async ({ client }) => {
  const request = client()
  for (const [query, ids] of [
    ['genre=indie', [2, 7, 8, 10]], ['search=Dogma', [1]],
    ['search=Silver', [2]], ['search=ambient', [3, 6]],
    ['genre=nonexistent', []], ['search=nonexistent', []]
  ]) {
    const response = await request(`/api/products?${query}`)
    assert.equal(response.status, 200)
    assert.deepEqual(response.body.map(row => row.id).sort((a, b) => a - b), ids)
  }
})

apiTest('cart addition increments quantities and counts across products', async ({ client }) => {
  const request = client()
  await register(request)
  assert.deepEqual((await request('/api/cart')).body, { items: [] })
  assert.deepEqual((await request('/api/cart/cart-count')).body, { totalItems: 0 })
  for (const productId of [1, 1, 2]) {
    assert.equal((await request('/api/cart/add', { method: 'POST', body: { productId } })).status, 200)
  }
  const items = (await request('/api/cart')).body.items
  assert.equal(items.length, 2)
  assert.deepEqual(items.map(({ title, artist, price, quantity }) => ({ title, artist, price, quantity })).sort((a, b) => a.title.localeCompare(b.title)), [
    { title: 'Echoes in Transit', artist: 'Silver Meadow', price: 38.59, quantity: 1 },
    { title: 'Selling Dogma', artist: 'The Clouds', price: 44.99, quantity: 2 }
  ])
  assert.ok(items.every(item => Number.isInteger(item.cartItemId)))
  assert.deepEqual((await request('/api/cart/cart-count')).body, { totalItems: 3 })
})

apiTest('cart deletion removes a line and clearing removes the remaining lines', async ({ client }) => {
  const request = client()
  await register(request)
  for (const productId of [1, 1, 2]) await request('/api/cart/add', { method: 'POST', body: { productId } })
  const item = (await request('/api/cart')).body.items.find(row => row.title === 'Selling Dogma')
  const deleted = await request(`/api/cart/${item.cartItemId}`, { method: 'DELETE' })
  assert.equal(deleted.status, 204)
  assert.equal(deleted.body, null)
  assert.equal((await request('/api/cart/cart-count')).body.totalItems, 1)
  assert.equal((await request('/api/cart')).body.items[0].title, 'Echoes in Transit')
  assert.equal((await request('/api/cart/all', { method: 'DELETE' })).status, 204)
  assert.deepEqual((await request('/api/cart')).body, { items: [] })
  assert.equal((await request('/api/cart/cart-count')).body.totalItems, 0)
})

apiTest('cart rejects nonnumeric IDs and deletion of a missing item', async ({ client }) => {
  const request = client()
  await register(request)
  assert.equal((await request('/api/cart/add', { method: 'POST', body: { productId: 'invalid' } })).status, 400)
  assert.equal((await request('/api/cart/invalid', { method: 'DELETE' })).status, 400)
  assert.equal((await request('/api/cart/9999', { method: 'DELETE' })).status, 400)
  assert.deepEqual((await request('/api/cart')).body, { items: [] })
  assert.equal((await request('/api/cart/cart-count')).body.totalItems, 0)
})

apiTest('users cannot read, increment, delete or clear each other\'s cart', async ({ client }) => {
  const alice = client()
  const bob = client()
  await register(alice, account('alice'))
  await register(bob, account('bob'))
  await alice('/api/cart/add', { method: 'POST', body: { productId: 1 } })
  assert.deepEqual((await bob('/api/cart')).body, { items: [] })
  assert.equal((await bob('/api/cart/cart-count')).body.totalItems, 0)
  for (let i = 0; i < 2; i++) await bob('/api/cart/add', { method: 'POST', body: { productId: 1 } })
  const aliceItem = (await alice('/api/cart')).body.items[0]
  const bobItem = (await bob('/api/cart')).body.items[0]
  assert.notEqual(aliceItem.cartItemId, bobItem.cartItemId)
  assert.equal(aliceItem.quantity, 1)
  assert.equal(bobItem.quantity, 2)
  assert.equal((await bob(`/api/cart/${aliceItem.cartItemId}`, { method: 'DELETE' })).status, 400)
  assert.equal((await alice(`/api/cart/${bobItem.cartItemId}`, { method: 'DELETE' })).status, 400)
  assert.deepEqual((await alice('/api/cart')).body.items, [aliceItem])
  assert.deepEqual((await bob('/api/cart')).body.items, [bobItem])
  assert.equal((await bob('/api/cart/all', { method: 'DELETE' })).status, 204)
  assert.deepEqual((await alice('/api/cart')).body.items, [aliceItem])
  assert.equal((await alice('/api/cart/cart-count')).body.totalItems, 1)
  assert.deepEqual((await bob('/api/cart')).body, { items: [] })
})

apiTest('cart survives logout and login for the same user', async ({ client }) => {
  const request = client()
  const user = await register(request)
  await request('/api/cart/add', { method: 'POST', body: { productId: 2 } })
  const before = (await request('/api/cart')).body
  await request('/api/auth/logout')
  assert.equal((await request('/api/cart')).status, 401)
  const fresh = client()
  assert.equal((await fresh('/api/auth/login', { method: 'POST', body: user })).status, 200)
  assert.deepEqual((await fresh('/api/cart')).body, before)
  assert.equal((await fresh('/api/cart/cart-count')).body.totalItems, 1)
})
