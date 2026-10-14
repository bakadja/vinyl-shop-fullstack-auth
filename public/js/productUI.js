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

export async function applySearchFilter() {
  const search = document.getElementById('search-input').value.trim()
  const filters = {}
  if (search) filters.search = search
  const products = await getProducts(filters)
  renderProducts(products)
}
