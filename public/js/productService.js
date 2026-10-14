// Service errors are handled by the catalog UI at the event boundary.
export async function getProducts(filters = {}) {
  const queryParams = new URLSearchParams(filters)
  const res = await fetch(`/api/products?${queryParams}`)
  if (!res.ok) throw new Error('Unable to load products')
  const products = await res.json()
  if (!Array.isArray(products)) throw new Error('Invalid products response')
  return products
}

export async function populateGenreSelect() {
  const select = document.getElementById('genre-select')
  try {
    const res = await fetch('/api/products/genres')
    if (!res.ok) throw new Error('Unable to load genres')
    const genres = await res.json()
    if (!Array.isArray(genres)) throw new Error('Invalid genres response')
    genres.forEach(genre => {
      const option = document.createElement('option')
      option.value = genre
      option.textContent = genre
      select.appendChild(option)
    })
    select.disabled = false
    return true
  } catch {
    select.disabled = true
    document.getElementById('catalog-message').textContent = 'Unable to load genres. You can still search the catalog.'
    return false
  }
}
