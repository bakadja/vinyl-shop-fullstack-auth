import { logout } from './logout.js'
import { checkAuth, renderGreeting, showHideMenuItems } from './authUI.js'
import { loadCart, removeItem, removeAll } from './cartService.js'

const dom = {
  checkoutBtn: document.getElementById('checkout-btn'),
  userMessage: document.getElementById('user-message'),
  cartList: document.getElementById('cart-list'),
  cartTotal: document.getElementById('cart-total')
}

document.getElementById('logout-btn').addEventListener('click', logout)

dom.cartList.addEventListener('click', async event => {
  if (!event.target.matches('.remove-btn')) return
  try {
    await removeItem(event.target.dataset.id, dom)
  } catch (error) {
    console.error('Unexpected cart removal error:', error)
    dom.userMessage.textContent = 'Unable to remove item. Please try again.'
  }
})

dom.checkoutBtn.addEventListener('click', async () => {
  try {
    await removeAll(dom)
  } catch (error) {
    console.error('Unexpected cart clearing error:', error)
    dom.userMessage.textContent = 'Unable to clear cart. Please try again.'
  }
})

async function init() {
  try {
    await loadCart(dom)
    const name = await checkAuth()
    renderGreeting(name)
    showHideMenuItems(name)
  } catch (error) {
    console.error('Cart initialization failed:', error)
    dom.userMessage.textContent = 'Unable to load cart data.'
    dom.checkoutBtn.disabled = true
  }
}

// Let cart actions remain responsive even while the first fetch is pending.
void init()
