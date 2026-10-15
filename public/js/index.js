import { logout } from './logout.js'
import { checkAuth, renderGreeting, showHideMenuItems } from './authUI.js'
import { populateGenreSelect } from './productService.js'
import { applySearchFilter } from './productUI.js'
import { updateCartIcon } from './cartService.js'

document.getElementById('logout-btn').addEventListener('click', logout)

// ===== Initial Load =====

async function init() {
  try {
    await Promise.all([populateGenreSelect(), applySearchFilter()])
    const name = await checkAuth()
    renderGreeting(name)
    showHideMenuItems(name)
    if (name) {
      await updateCartIcon()
    }
  } catch (error) {
    console.error('Catalogue initialization failed:', error)
    document.getElementById('catalog-message').textContent = 'Unable to initialize the catalogue. Please try again.'
  }
}

function reportSearchFailure(error) {
  console.error('Search failed:', error)
  document.getElementById('catalog-message').textContent = 'Unable to load products. Please try again.'
}

async function handleSearch(event) {
  event.preventDefault()
  try {
    await applySearchFilter()
  } catch (error) {
    reportSearchFailure(error)
  }
}

// Register listeners before loading data, so an early search is never lost.
document.getElementById('search-input').addEventListener('input', handleSearch)
document.querySelector('form').addEventListener('submit', handleSearch)
document.getElementById('genre-select').addEventListener('change', handleSearch)

// Do not block module evaluation: users may search while the initial request is pending.
void init()
