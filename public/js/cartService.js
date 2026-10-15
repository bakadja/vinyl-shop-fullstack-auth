export function addBtnListeners() {
  document.querySelectorAll('.add-btn').forEach(button => {
    button.addEventListener('click', async (event) => {
      const button = event.currentTarget
      if (button.disabled) return
      button.disabled = true
      const albumId = button.dataset.id

      try {
        const res = await fetch('/api/cart/add', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ productId: albumId })
        })

        if (res.status === 401) {
          window.location.href = '/login.html'
          return
        }
        if (!res.ok) throw new Error('Add failed')

        const message = document.getElementById('catalog-message')
        if (message.textContent === 'Unable to add to cart. Please try again.') message.textContent = ''
        await updateCartIcon()
      } catch (err) {
        console.error('Error adding to cart:', err)
        document.getElementById('catalog-message').textContent = 'Unable to add to cart. Please try again.'
      } finally {
        button.disabled = false
      }
    })
  })
}

export async function updateCartIcon() {
  try {
    const res = await fetch('/api/cart/cart-count')
    if (!res.ok) throw new Error('Cart count failed')
    const obj = await res.json()
    const totalItems = obj.totalItems

    const banner = document.getElementById('cart-banner')
    banner.replaceChildren()
    if (totalItems > 0) {
      const link = document.createElement('a')
      link.href = '/cart.html'
      const image = document.createElement('img')
      image.src = 'images/cart.png'
      image.alt = 'cart'
      link.append(image, String(totalItems))
      banner.appendChild(link)
    }
  } catch (err) {
    console.error('Error updating cart icon:', err)
  }
}

export async function loadCart(dom) {
  const { checkoutBtn, cartList, cartTotal } = dom

  try {
    const items = await fetchCartItems(dom)
    if (items === null) return false
    renderCartItems(items, cartList)
    updateCartTotal(items, cartTotal, checkoutBtn)
    return true
  } catch (err) {
    console.error('Error loading cart:', err)
    const message = document.createElement('li')
    message.textContent = 'Error loading cart data.'
    cartList.replaceChildren(message)
    checkoutBtn.disabled = true
    return false
  }
}

async function fetchCartItems({ userMessage, checkoutBtn }) {
  const res = await fetch('/api/cart/', { credentials: 'include' })

  if (res.status === 401) {
    window.location.href = '/'
    checkoutBtn.disabled = true
    checkoutBtn.classList.add('disabled')
    const loginLink = document.createElement('a')
    loginLink.href = 'login.html'
    loginLink.textContent = 'log in'
    userMessage.replaceChildren('Please ', loginLink, '.')
    return null
  }
  if (!res.ok) throw new Error('Cart load failed')

  const { items } = await res.json()
  if (!Array.isArray(items)) throw new Error('Invalid cart response')
  return items
}

function renderCartItems(items, cartList) {
  cartList.replaceChildren()

  items.forEach(item => {
    const li = document.createElement('li')
    li.className = 'cart-item'

    const itemTotal = item.price * item.quantity

    const details = document.createElement('div')
    const title = document.createElement('strong')
    title.textContent = `${item.title}: `
    const removeButton = document.createElement('button')
    removeButton.dataset.id = item.cartItemId
    removeButton.className = 'remove-btn'
    removeButton.textContent = '🗑️'
    details.append(title, ' ', removeButton)

    const subtotal = document.createElement('span')
    subtotal.textContent = `× ${item.quantity} = $${itemTotal.toFixed(2)}`
    li.append(details, subtotal)

    cartList.appendChild(li)
  })
}

function updateCartTotal(items, cartTotal, checkoutBtn) {
  const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0)
  cartTotal.textContent = `Total: $${total.toFixed(2)}`

  checkoutBtn.disabled = items.length === 0
  if (checkoutBtn.disabled) checkoutBtn.classList.add('disabled')
  else checkoutBtn.classList.remove('disabled')
}

const pendingChanges = new WeakSet()


export async function removeItem(itemId, dom) {
  if (pendingChanges.has(dom)) return false
  pendingChanges.add(dom)
  dom.checkoutBtn.disabled = true
  try {
    const res = await fetch(`/api/cart/${encodeURIComponent(itemId)}`, {
      method: 'DELETE', credentials: 'include'
    })
    if (res.status !== 204) throw new Error('Remove failed')
    await loadCart(dom)
    return true
  } catch {
    dom.userMessage.textContent = 'Unable to remove item. Please try again.'
    dom.checkoutBtn.disabled = dom.cartList.children.length === 0
    return false
  } finally {
    pendingChanges.delete(dom)
  }
}

export async function removeAll(dom) {
  if (pendingChanges.has(dom)) return false
  pendingChanges.add(dom)
  dom.checkoutBtn.disabled = true
  dom.userMessage.textContent = 'Clearing cart…'
  try {
    const res = await fetch('/api/cart/all', {
      method: 'DELETE', credentials: 'include'
    })
    if (res.status !== 204) throw new Error('Clear failed')
    // DELETE is authoritative even if refreshing the cart subsequently fails.
    const loaded = await loadCart(dom)
    if (!loaded) {
      renderCartItems([], dom.cartList)
      updateCartTotal([], dom.cartTotal, dom.checkoutBtn)
    }
    dom.userMessage.textContent = 'Cart cleared. No order has been placed.'
    return true
  } catch {
    dom.userMessage.textContent = 'Unable to clear cart. Please try again.'
    dom.checkoutBtn.disabled = dom.cartList.children.length === 0
    return false
  } finally {
    pendingChanges.delete(dom)
  }
}
