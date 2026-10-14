import { getProducts } from './productService.js'
import { addBtnListeners } from './cartService.js'

// ===== Rendering products =====

export function renderProducts(products) {
  const albumsContainer = document.getElementById('products-container')
  albumsContainer.replaceChildren()
  products.forEach(album => {
    const card = document.createElement('div')
    card.className = 'product-card'

    const image = document.createElement('img')
    image.src = `./images/${album.image}`
    image.alt = album.title
    const title = document.createElement('h2')
    title.textContent = album.title
    const artist = document.createElement('h3')
    artist.textContent = album.artist
    const price = document.createElement('p')
    price.textContent = `$${album.price}`
    const button = document.createElement('button')
    button.className = 'main-btn add-btn'
    button.dataset.id = album.id
    button.textContent = 'Add to Cart'
    const genre = document.createElement('p')
    genre.className = 'genre-label'
    genre.textContent = album.genre

    card.append(image, title, artist, price, button, genre)
    albumsContainer.appendChild(card)
  })

  addBtnListeners()
}

// ===== Handling filtering =====

let latestRequest = 0

export async function applySearchFilter() {
  const request = ++latestRequest
  const search = document.getElementById('search-input').value.trim()
  const genre = document.getElementById('genre-select').value
  const filters = {}
  if (search) filters.search = search
  if (genre) filters.genre = genre
  try {
    const products = await getProducts(filters)
    if (request !== latestRequest) return
    renderProducts(products)
  } catch {
    if (request !== latestRequest) return
    const message = document.createElement('p')
    message.textContent = 'Unable to load products. Please try again.'
    document.getElementById('products-container').replaceChildren(message)
  }
}
