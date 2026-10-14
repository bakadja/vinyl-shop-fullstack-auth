export async function logout() {
  const button = document.getElementById('logout-btn')
  if (button.disabled) return
  button.disabled = true
  try {
    const res = await fetch('/api/auth/logout/')
    if (!res.ok) throw new Error('Logout failed')
    window.location.href = '/'
  } catch {
    button.textContent = 'Unable to log out. Please try again.'
  } finally {
    button.disabled = false
  }
}
