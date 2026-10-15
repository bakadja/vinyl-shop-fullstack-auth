import assert from 'node:assert/strict'
import { test } from 'node:test'
import { domFixture } from '../test-support/dom.js'
import { renderProducts } from '../public/js/productUI.js'
import { loadCart, updateCartIcon, removeItem, removeAll } from '../public/js/cartService.js'
import { renderGreeting } from '../public/js/authUI.js'
import { populateGenreSelect } from '../public/js/productService.js'

const html = '<img src=x onerror="globalThis.xss=1"><script>globalThis.xss=1</script>&'
const attribute = '1" onclick="globalThis.xss=1'
const album = { id: attribute, title: html, artist: html, price: html, genre: html, image: 'x" onerror="globalThis.xss=1' }
const response = body => ({ ok: true, json: async () => body })
function cartDom(document) {
  return Object.fromEntries(['checkoutBtn', 'userMessage', 'cartList', 'cartTotal'].map(key => [key, document.getElementById(key)]))
}

test('product fields remain literal text and attributes; add-to-cart retains the ID', async t => {
  const document = domFixture(t)
  renderProducts([album])
  const container = document.getElementById('products-container')
  assert.equal(container.children.length, 1)
  const card = container.children[0]
  assert.equal(card.className, 'product-card')
  const [image, title, artist, price, button, genre] = card.children
  assert.equal(image.src, './images/x" onerror="globalThis.xss=1')
  assert.equal(image.alt, html)
  for (const element of [title, artist, genre]) assert.equal(element.textContent, html)
  assert.equal(price.textContent, `$${html}`)
  assert.equal(button.dataset.id, attribute)
  assert.equal(button.className, 'main-btn add-btn')
  const requests = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push([url, options])
    return response({ totalItems: 1 })
  })
  await button.listeners.click({ currentTarget: button })
  assert.equal(requests[0][0], '/api/cart/add')
  assert.deepEqual(JSON.parse(requests[0][1].body), { productId: attribute })
  assert.equal(document.getElementById('cart-banner').textContent, '1')
  renderProducts([])
  assert.equal(container.children.length, 0)
})

test('cart title and removal ID remain literal while totals and controls are preserved', async t => {
  const document = domFixture(t)
  const dom = cartDom(document)
  t.mock.method(globalThis, 'fetch', async () => response({ items: [{ title: html, cartItemId: attribute, quantity: 2, price: 12.5 }] }))
  await loadCart(dom)
  assert.equal(dom.cartList.children.length, 1)
  const row = dom.cartList.children[0]
  assert.equal(row.className, 'cart-item')
  assert.equal(row.children[0].children[0].textContent, `${html}: `)
  const button = row.children[0].children.find(child => child.tagName === 'BUTTON')
  assert.equal(button.dataset.id, attribute)
  assert.equal(button.className, 'remove-btn')
  assert.equal(row.children[1].textContent, '× 2 = $25.00')
  assert.equal(dom.cartTotal.textContent, 'Total: $25.00')
})

test('untrusted cart quantities remain text even when numeric calculation returns NaN', async t => {
  const document = domFixture(t)
  const dom = cartDom(document)
  t.mock.method(globalThis, 'fetch', async () => response({ items: [{ title: 'Album', cartItemId: 1, quantity: html, price: 10 }] }))
  await loadCart(dom)
  assert.equal(dom.cartList.children[0].children[1].textContent, `× ${html} = $NaN`)
})

test('cart count coercible to a positive number cannot inject HTML', async t => {
  const document = domFixture(t)
  // Normal JSON strings containing markup do not pass > 0. This object also
  // exercises the rendering boundary independently of that numeric condition.
  const count = { valueOf: () => 1, toString: () => html }
  t.mock.method(globalThis, 'fetch', async () => response({ totalItems: count }))
  await updateCartIcon()
  assert.equal(document.getElementById('cart-banner').textContent, html)
})

test('cart icon preserves navigation/image and clears stale content for zero or HTML counts', async t => {
  const document = domFixture(t)
  const banner = document.getElementById('cart-banner')
  for (const count of [3, 0, html]) {
    t.mock.method(globalThis, 'fetch', async () => response({ totalItems: count }))
    await updateCartIcon()
    if (count === 3) {
      assert.equal(banner.children[0].href, '/cart.html')
      assert.equal(banner.children[0].children[0].src, 'images/cart.png')
      assert.equal(banner.children[0].children[0].alt, 'cart')
      assert.equal(banner.textContent, '3')
    } else assert.equal(banner.children.length, 0)
  }
})

test('empty cart clears old rows and disables checkout', async t => {
  const document = domFixture(t)
  const dom = cartDom(document)
  dom.cartList.textContent = 'stale'
  t.mock.method(globalThis, 'fetch', async () => response({ items: [] }))
  await loadCart(dom)
  assert.equal(dom.cartList.children.length, 0)
  assert.equal(dom.cartTotal.textContent, 'Total: $0.00')
  assert.equal(dom.checkoutBtn.disabled, true)
})

test('unauthorized cart retains login link and redirect', async t => {
  const document = domFixture(t)
  const dom = cartDom(document)
  t.mock.method(globalThis, 'fetch', async () => ({ ok: false, status: 401 }))
  await loadCart(dom)
  assert.equal(window.location.href, '/')
  assert.equal(dom.checkoutBtn.disabled, true)
  assert.equal(dom.userMessage.textContent, 'Please log in.')
  assert.equal(dom.userMessage.children[1].href, 'login.html')
})

test('cart loading failure renders the existing error message as text', async t => {
  const document = domFixture(t)
  const dom = cartDom(document)
  t.mock.method(console, 'error', () => {})
  await loadCart(dom)
  assert.equal(dom.cartList.children[0].tagName, 'LI')
  assert.equal(dom.cartList.textContent, 'Error loading cart data.')
})

test('remove and checkout continue to reload the cart after successful DELETE', async t => {
  const document = domFixture(t)
  const dom = cartDom(document)
  const requests = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push([url, options?.method])
    return options?.method === 'DELETE' ? { status: 204 } : response({ items: [] })
  })
  await removeItem(7, dom)
  await removeAll(dom)
  assert.deepEqual(requests, [['/api/cart/7', 'DELETE'], ['/api/cart/', undefined], ['/api/cart/all', 'DELETE'], ['/api/cart/', undefined]])
})

test('greeting and genre options already keep untrusted API text literal', async t => {
  const document = domFixture(t)
  renderGreeting(html)
  assert.equal(document.getElementById('greeting').textContent, `Welcome, ${html}!`)
  t.mock.method(globalThis, 'fetch', async () => response([html]))
  await populateGenreSelect()
  const option = document.getElementById('genre-select').children[0]
  assert.equal(option.textContent, html)
  assert.equal(option.value, html)
})

for (const name of [undefined, false, null, '', 'Ada', 0, NaN]) {
  test(`greeting preserves the existing fallback for ${String(name)}`, t => {
    const document = domFixture(t)
    renderGreeting(name)
    assert.equal(document.getElementById('greeting').textContent, `Welcome, ${name ? name : 'Guest'}!`)
  })
}
