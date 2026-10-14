import assert from 'node:assert/strict'
import { test } from 'node:test'
import sqlite3 from 'sqlite3'
import { open } from 'sqlite'
import { join } from 'node:path'
import { fixture, register } from '../test-support/http.js'

function apiTest(name, run) {
  test(name, { timeout: 20000 }, async t => run(await fixture(t)))
}
async function database(directory, run) {
  const db = await open({ filename: join(directory, 'database.db'), driver: sqlite3.Database })
  try { return await run(db) } finally { await db.close() }
}

apiTest('invalid product IDs never create hidden cart records', async ({ client, directory }) => {
  const request = client()
  await register(request)
  for (const productId of [undefined, null, '', ' ', 0, -1, 1.5, '1.5', '1x', '1e0', '+1', '0x1', true, [1], {}, Number.MAX_SAFE_INTEGER + 1]) {
    const response = await request('/api/cart/add', { method: 'POST', body: { productId } })
    assert.equal(response.status, 400, JSON.stringify(productId))
  }
  assert.equal(await database(directory, db => db.get('SELECT COUNT(*) AS count FROM cart_items').then(row => row.count)), 0)
  assert.deepEqual((await request('/api/cart/cart-count')).body, { totalItems: 0 })
})

apiTest('missing products return 404 without leaving cart records', async ({ client, directory }) => {
  const request = client()
  await register(request)
  assert.equal((await request('/api/cart/add', { method: 'POST', body: { productId: 99999 } })).status, 404)
  assert.equal(await database(directory, db => db.get('SELECT COUNT(*) AS count FROM cart_items').then(row => row.count)), 0)
})

apiTest('concurrent numeric and string product additions keep one line and every increment', async ({ client }) => {
  const request = client()
  await register(request)
  const results = await Promise.all(Array.from({ length: 12 }, (_, i) => request('/api/cart/add', { method: 'POST', body: { productId: i % 2 ? '1' : 1 } })))
  assert.ok(results.every(row => row.status === 200))
  const items = (await request('/api/cart')).body.items
  assert.equal(items.length, 1)
  assert.equal(items[0].quantity, 12)
  assert.equal((await request('/api/cart/cart-count')).body.totalItems, 12)
})

apiTest('malformed cart item IDs cannot delete a valid line', async ({ client }) => {
  const request = client()
  await register(request)
  await request('/api/cart/add', { method: 'POST', body: { productId: 1 } })
  const before = (await request('/api/cart')).body
  const id = before.items[0].cartItemId
  for (const invalid of ['0', '-1', `${id}x`, `${id}.5`, `${id}e0`, '9007199254740992']) {
    assert.equal((await request(`/api/cart/${invalid}`, { method: 'DELETE' })).status, 400)
    assert.deepEqual((await request('/api/cart')).body, before)
  }
})

apiTest('search intersects genre and clearing filters restores the catalogue', async ({ client }) => {
  const request = client()
  for (const [query, ids] of [['genre=rock&search=Dogma', [1]], ['genre=indie&search=Dogma', []], ['genre=indie&search=Silver', [2]], ['genre=ambient&search=ambient', [3, 6]], ['', [1,2,3,4,5,6,7,8,9,10]]]) {
    const response = await request(`/api/products?${query}`)
    assert.equal(response.status, 200)
    assert.deepEqual(response.body.map(row => row.id).sort((a,b) => a-b), ids)
  }
  for (const query of ['genre=x&genre=y', 'search[x]=y']) {
    assert.equal((await request(`/api/products?${query}`)).status, 400)
  }
})

apiTest('non-string authentication fields return JSON 400 and leave the server usable', async ({ client }) => {
  const request = client()
  for (const path of ['register', 'login']) {
    assert.equal((await request(`/api/auth/${path}`, { method: 'POST', body: { name: {}, email: [], username: 1, password: {} } })).status, 400)
  }
  await register(request)
})

apiTest('database rejections yield sanitized JSON errors and the server stays alive', async ({ client, directory }) => {
  const request = client()
  await register(request)
  await database(directory, db => db.exec('DROP TABLE cart_items; DROP TABLE products'))
  for (const [path, method, body] of [['/api/cart','GET'], ['/api/cart/cart-count','GET'], ['/api/cart/add','POST',{ productId: 1 }], ['/api/cart/1','DELETE'], ['/api/cart/all','DELETE'], ['/api/products','GET'], ['/api/products/genres','GET']]) {
    const result = await request(path, { method, body })
    assert.equal(result.status, 500)
    assert.equal(typeof result.body.error, 'string')
    assert.equal(Object.hasOwn(result.body, 'details'), false)
    assert.doesNotMatch(JSON.stringify(result.body), /SQLITE|no such table|stack|SELECT|DELETE/i)
  }
  assert.equal((await request('/api/auth/me')).status, 200)
})
