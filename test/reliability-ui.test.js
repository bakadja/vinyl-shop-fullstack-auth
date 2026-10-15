import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setImmediate } from 'node:timers/promises'
import { domFixture } from '../test-support/dom.js'
import { loadCart, removeAll, updateCartIcon, addBtnListeners } from '../public/js/cartService.js'
import { applySearchFilter, renderProducts } from '../public/js/productUI.js'
import { getProducts, populateGenreSelect } from '../public/js/productService.js'
import { logout } from '../public/js/logout.js'

const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) })
const album = { id: 1, title: 'Selling Dogma', artist: 'The Clouds', price: 44.99, genre: 'rock', image: 'vinyl1.png' }
const items = [{ ...album, cartItemId: 1, quantity: 1 }]
const deferred = () => { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
function setup(t) {
  const document = domFixture(t)
  t.mock.method(console, 'error', () => {})
  const dom = Object.fromEntries(['checkoutBtn','userMessage','cartList','cartTotal'].map(key => [key, document.getElementById(key)]))
  return { document, dom }
}

for (const failure of ['http', 'network']) {
  test(`failed cart clearing (${failure}) preserves visible items and reports failure`, async t => {
    const { dom } = setup(t)
    t.mock.method(globalThis, 'fetch', async () => response({ items }))
    await loadCart(dom)
    const before = dom.cartList.textContent
    t.mock.method(globalThis, 'fetch', async () => { if (failure === 'network') throw new Error('offline'); return response({ error: 'internal' }, 500) })
    assert.equal(await removeAll(dom), false)
    assert.equal(dom.cartList.textContent, before)
    assert.equal(dom.cartTotal.textContent, 'Total: $44.99')
    assert.equal(dom.checkoutBtn.disabled, false)
    assert.match(dom.userMessage.textContent, /Unable to clear/i)
    assert.doesNotMatch(dom.userMessage.textContent, /order.*processing/i)
  })
}

test('clear waits for confirmation, suppresses duplicate calls and then clears', async t => {
  const { dom } = setup(t)
  t.mock.method(globalThis, 'fetch', async () => response({ items }))
  await loadCart(dom)
  const pending = deferred()
  let deletes = 0
  t.mock.method(globalThis, 'fetch', async (_, options) => { if (options?.method === 'DELETE') { deletes++; return pending.promise }; return response({ items: [] }) })
  const first = removeAll(dom)
  const second = removeAll(dom)
  pending.resolve(response(null, 204))
  assert.equal(deletes, 1)
  assert.equal(dom.checkoutBtn.disabled, true)
  assert.match(dom.cartList.textContent, /Selling Dogma/)
  assert.doesNotMatch(dom.userMessage.textContent, /cleared|processing/i)
  pending.resolve(response(null, 204))
  assert.equal(await first, true)
  await second
  assert.equal(dom.cartList.children.length, 0)
  assert.equal(dom.cartTotal.textContent, 'Total: $0.00')
  assert.match(dom.userMessage.textContent, /cart cleared/i)
})

test('confirmed clear remains truthful when the follow-up reload fails', async t => {
  const { dom } = setup(t)
  t.mock.method(globalThis, 'fetch', async (_, options) => { if (options?.method === 'DELETE') return response(null, 204); throw new Error('offline') })
  assert.equal(await removeAll(dom), true)
  assert.equal(dom.cartList.children.length, 0)
  assert.match(dom.userMessage.textContent, /cart cleared/i)
})

test('cart HTTP failure is not treated as an empty cart or an authentication redirect', async t => {
  const { dom } = setup(t)
  t.mock.method(globalThis, 'fetch', async () => response({ error: 'internal' }, 500))
  await loadCart(dom)
  assert.equal(window.location.href, '')
  assert.match(dom.cartList.textContent, /Error loading/)
  assert.equal(dom.checkoutBtn.disabled, true)
})

test('refilling an empty cart re-enables its action', async t => {
  const { dom } = setup(t)
  t.mock.method(globalThis, 'fetch', async () => response({ items: [] }))
  await loadCart(dom)
  t.mock.method(globalThis, 'fetch', async () => response({ items }))
  await loadCart(dom)
  assert.equal(dom.checkoutBtn.disabled, false)
})

test('search sends both filters and clearing them restores the catalogue', async t => {
  const { document } = setup(t)
  document.getElementById('search-input').value = ' Dogma '
  document.getElementById('genre-select').value = 'rock'
  const queries = []
  t.mock.method(globalThis, 'fetch', async url => { queries.push(new URL(url, 'http://localhost').searchParams); return response([album]) })
  await applySearchFilter()
  assert.equal(queries[0].get('search'), 'Dogma')
  assert.equal(queries[0].get('genre'), 'rock')
  assert.match(document.getElementById('products-container').textContent, /Selling Dogma/)
  document.getElementById('search-input').value = ''
  document.getElementById('genre-select').value = ''
  await applySearchFilter()
  assert.equal(queries[1].toString(), '')
})

for (const staleFailure of [false, true]) {
  test(`newest search wins over an older ${staleFailure ? 'rejection' : 'response'}`, async t => {
    const { document } = setup(t)
    document.getElementById('search-input').value = ''
    const older = deferred()
    let count = 0
    t.mock.method(globalThis, 'fetch', async () => ++count === 1 ? older.promise : response([album]))
    const first = applySearchFilter()
    await applySearchFilter()
    if (staleFailure) older.reject(new Error('offline')); else older.resolve(response([]))
    await first
    assert.match(document.getElementById('products-container').textContent, /Selling Dogma/)
  })
}

for (const failure of ['http', 'network']) {
  test(`catalogue ${failure} failures are handled and allow a later empty result`, async t => {
    const { document } = setup(t)
    document.getElementById('search-input').value = ''
    t.mock.method(globalThis, 'fetch', async () => { if (failure === 'network') throw new Error('offline'); return response({ error: 'internal' }, 500) })
    await applySearchFilter()
    assert.match(document.getElementById('products-container').textContent, /Unable to load products/i)
    t.mock.method(globalThis, 'fetch', async () => response([]))
    await applySearchFilter()
    assert.equal(document.getElementById('products-container').children.length, 0)
  })
}

test('catalogue service rejects HTTP errors before rendering and genre failures resolve safely', async t => {
  setup(t)
  t.mock.method(globalThis, 'fetch', async () => response({ error: 'internal' }, 500))
  await assert.rejects(getProducts(), /products/i)
  assert.equal(await populateGenreSelect(), false)
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('offline') })
  assert.equal(await populateGenreSelect(), false)
})

test('cart count HTTP errors preserve the existing icon', async t => {
  const { document } = setup(t)
  const banner = document.getElementById('cart-banner')
  banner.textContent = '3'
  t.mock.method(globalThis, 'fetch', async () => response({ error: 'internal' }, 500))
  await updateCartIcon()
  assert.equal(banner.textContent, '3')
})

test('add-to-cart server failure does not redirect a signed-in user to login', async t => {
  const { document } = setup(t)
  renderProducts([album])
  addBtnListeners()
  t.mock.method(globalThis, 'fetch', async () => response({ error: 'internal' }, 500))
  const button = document.querySelectorAll('.add-btn')[0]
  await button.listeners.click({ currentTarget: button })
  assert.equal(window.location.href, '')
  assert.equal(button.disabled, false)
  assert.match(document.getElementById('catalog-message').textContent, /Unable to add/i)
})

for (const failure of ['http','network']) {
  test(`logout ${failure} error resolves without redirect or secondary rejection`, async t => {
    const { document } = setup(t)
    t.mock.method(globalThis, 'fetch', async () => { if (failure === 'network') throw new Error('offline'); return response({}, 500) })
    await logout()
    assert.equal(window.location.href, '')
    assert.match(document.getElementById('logout-btn').textContent, /try again/i)
  })
}

test('cart page click waits for DELETE and never announces order processing', async t => {
  const { document } = setup(t)
  const pending = deferred()
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (options?.method === 'DELETE') return pending.promise
    return response(url === '/api/auth/me' ? { isLoggedIn: false } : { items })
  })
  await import(`../public/js/cart.js?test=${Date.now()}`)
  await setImmediate()
  const button = document.getElementById('checkout-btn')
  const click = button.listeners.click()
  assert.doesNotMatch(document.getElementById('user-message').textContent, /order.*processing/i)
  pending.resolve(response({}, 500))
  await click
  await setImmediate()
  assert.match(document.getElementById('cart-list').textContent, /Selling Dogma/)
  assert.match(document.getElementById('user-message').textContent, /Unable to clear/i)
})

test('a successful add retry clears its earlier failure message', async t => {
  const { document } = setup(t)
  renderProducts([album])
  const button = document.querySelectorAll('.add-btn')[0]
  t.mock.method(globalThis, 'fetch', async () => response({}, 500))
  await button.listeners.click({ currentTarget: button })
  assert.match(document.getElementById('catalog-message').textContent, /Unable to add/)
  t.mock.method(globalThis, 'fetch', async () => response({ totalItems: 1 }))
  await button.listeners.click({ currentTarget: button })
  assert.equal(document.getElementById('catalog-message').textContent, '')
  document.getElementById('catalog-message').textContent = 'Unable to load genres. You can still search the catalog.'
  await button.listeners.click({ currentTarget: button })
  assert.match(document.getElementById('catalog-message').textContent, /Unable to load genres/)
})

test('catalog bootstrap cannot overwrite a search made during initial loading', async t => {
  const { document } = setup(t)
  document.getElementById('search-input').value = ''
  const form = document.createElement('form')
  document.querySelector = selector => selector === 'form' ? form : null
  const initial = deferred()
  let products = 0
  t.mock.method(globalThis, 'fetch', async url => {
    if (url === '/api/products/genres') return response([])
    if (url === '/api/auth/me') return response({ isLoggedIn: false })
    if (url.startsWith('/api/products?')) return ++products === 1 ? initial.promise : response([album])
    throw new Error(`Unexpected URL ${url}`)
  })
  const moduleReady = import(`../public/js/index.js?test=${Date.now()}`)
  // Module evaluation waits for the initial request, but listeners must work now.
  const input = document.getElementById('search-input')
  for (let attempt = 0; attempt < 100 && !input.listeners.input; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  assert.equal(typeof input.listeners.input, 'function')
  input.value = 'Dogma'
  await input.listeners.input({ preventDefault() {} })
  assert.match(document.getElementById('products-container').textContent, /Selling Dogma/)
  initial.resolve(response([]))
  await moduleReady
  assert.match(document.getElementById('products-container').textContent, /Selling Dogma/)
})

test('logout uses POST JSON and redirects only after successful confirmation', async t => {
  setup(t)
  let calls = 0
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls++
    assert.equal(url, '/api/auth/logout/')
    assert.deepEqual(options, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    return response({ message: 'Logged out' })
  })
  await logout()
  assert.equal(calls, 1)
  assert.equal(window.location.href, '/')
})

test('cart page removal handles both the normal path and an unexpected control failure', async t => {
  const { document } = setup(t)
  let deletes = 0
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (options?.method === 'DELETE') { deletes++; return response(null, 204) }
    if (url === '/api/cart/') return response({ items: deletes ? [] : items })
    if (url === '/api/auth/me') return response({ isLoggedIn: false })
    throw new Error('Unexpected URL')
  })
  await import('../public/js/cart.js?coverage=remove-event')
  await setImmediate()
  const list = document.getElementById('cart-list')
  const click = { target: { matches: selector => selector === '.remove-btn', dataset: { id: '1' } } }
  await list.listeners.click(click)
  assert.equal(deletes, 1)
  assert.equal(list.children.length, 0)

  // A DOM control can become unusable while an event is dispatched.
  const button = document.getElementById('checkout-btn')
  Object.defineProperty(button, 'disabled', {
    configurable: true,
    get: () => false,
    set: () => { throw new Error('Detached checkout control') }
  })
  await list.listeners.click(click)
  assert.match(document.getElementById('user-message').textContent, /Unable to remove item/i)
})

test('cart checkout reports an unexpected failure without leaving a rejected listener promise', async t => {
  const { document } = setup(t)
  t.mock.method(globalThis, 'fetch', async url => response(url === '/api/auth/me' ? { isLoggedIn: false } : { items: [] }))
  await import('../public/js/cart.js?coverage=checkout-event')
  await setImmediate()
  const button = document.getElementById('checkout-btn')
  Object.defineProperty(button, 'disabled', {
    configurable: true,
    get: () => false,
    set: () => { throw new Error('Detached checkout control') }
  })
  await button.listeners.click()
  assert.match(document.getElementById('user-message').textContent, /Unable to clear cart/i)
})

test('cart startup failure keeps checkout disabled and shows an accessible message', async t => {
  const { document } = setup(t)
  t.mock.method(globalThis, 'fetch', async url => response(url === '/api/auth/me' ? { isLoggedIn: false } : { items: [] }))
  const getElementById = document.getElementById
  document.getElementById = id => id === 'greeting' ? null : getElementById(id)
  await import('../public/js/cart.js?coverage=cart-startup')
  await setImmediate()
  assert.match(document.getElementById('user-message').textContent, /Unable to load cart/i)
  assert.equal(document.getElementById('checkout-btn').disabled, true)
})

test('catalogue event handler reports an unexpected search error and keeps events responsive', async t => {
  const { document } = setup(t)
  const input = document.getElementById('search-input')
  input.value = ''
  document.getElementById('genre-select').value = ''
  const form = document.createElement('form')
  document.querySelector = selector => selector === 'form' ? form : null
  t.mock.method(globalThis, 'fetch', async url => {
    if (url === '/api/products/genres') return response([])
    if (url === '/api/auth/me') return response({ isLoggedIn: false })
    if (url.startsWith('/api/products?')) return response([])
    throw new Error('Unexpected URL')
  })
  await import('../public/js/index.js?coverage=search-error')
  await setImmediate()
  await form.listeners.submit({ preventDefault() {} })
  await document.getElementById('genre-select').listeners.change({ preventDefault() {} })
  Object.defineProperty(input, 'value', {
    configurable: true,
    get: () => { throw new Error('Unexpected search field failure') }
  })
  await input.listeners.input({ preventDefault() {} })
  assert.match(document.getElementById('catalog-message').textContent, /Unable to load products/i)
})

test('catalogue startup failure reports the problem after registering search listeners', async t => {
  const { document } = setup(t)
  document.getElementById('search-input').value = ''
  document.getElementById('genre-select').value = ''
  const form = document.createElement('form')
  document.querySelector = selector => selector === 'form' ? form : null
  t.mock.method(globalThis, 'fetch', async url => {
    if (url === '/api/products/genres') return response([])
    if (url === '/api/auth/me') return response({ isLoggedIn: false })
    if (url.startsWith('/api/products?')) return response([])
    throw new Error('Unexpected URL')
  })
  const getElementById = document.getElementById
  document.getElementById = id => id === 'greeting' ? null : getElementById(id)
  await import('../public/js/index.js?coverage=startup-error')
  await setImmediate()
  assert.equal(typeof document.getElementById('search-input').listeners.input, 'function')
  assert.match(document.getElementById('catalog-message').textContent, /Unable to initialize the catalogue/i)
})
