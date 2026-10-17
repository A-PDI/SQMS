// SQMS cookie session boundary: never store a bearer credential in browser storage.
let user = null
let csrf = null
export function getUser() { return user }
export function getToken() { return user ? 'cookie-session' : null }
export function setAuth(_token, nextUser) { user = nextUser }
export function setSession(nextUser, token) { user = nextUser; csrf = token }
export function getCsrfToken() { return csrf }
export function clearAuth() {
  const token = csrf
  user = null
  csrf = null
  void fetch('/api/v1/auth/logout', {
    method: 'POST', credentials: 'same-origin', keepalive: true,
    headers: token ? { 'X-CSRF-Token': token } : {},
  }).catch(() => {})
}
export function isAuthenticated() { return !!getToken() }
