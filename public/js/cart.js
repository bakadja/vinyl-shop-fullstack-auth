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

dom.cartList.addEventListener('click', event => {
  if (event.target.matches('.remove-btn')) {
    removeItem(event.target.dataset.id, dom)
  }
})

dom.checkoutBtn.addEventListener('click', async () => {
  await removeAll(dom)
})

async function init() {
  await loadCart(dom)
  const name = await checkAuth()
  renderGreeting(name)
  showHideMenuItems(name)
} 
 
init()
