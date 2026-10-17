import axios from 'axios'
import { getCsrfToken, setSession } from './auth'

export function presentUser(me) {
  const role = me.roles.includes('SYSTEM_ADMIN') ? 'admin'
    : me.roles.includes('QUALITY_MANAGER') ? 'qc_manager' : 'inspector'
  const tabs=Object.entries({ dashboard:'inspection:read',my_inspections:'inspection:read',inspections:'inspection:read',new_inspection:'inspection:write',ncrs:'ncr:read',quality_alerts:'inspection:read',drawings:'document:read' }).filter(([,permission]) => me.permissions.includes(permission)).map(([tab]) => tab)
  return { ...me, name: me.displayName, role, active: 1, sqmsPermissions: me.permissions, sqmsRoles: me.roles,
    permissions: me.legacyPermissions ? JSON.stringify(me.legacyPermissions) : role === 'inspector' ? JSON.stringify({tabs}) : null }
}
export async function hydrateSession() {
  const { data: me } = await axios.get('/api/v1/auth/me', { withCredentials: true })
  const user = presentUser(me)
  setSession(user, me.csrfToken)
  return user
}
const api = axios.create({ baseURL: '/api/v1/qms', withCredentials: true })
api.interceptors.request.use(config => {
  if (config.url === '/auth/login') { config.baseURL = '/api/v1'; config.url = '/auth/login' }
  const csrf = getCsrfToken()
  if (csrf && !['get', 'head', 'options'].includes(config.method)) config.headers['X-CSRF-Token'] = csrf
  return config
})
api.interceptors.response.use(async response => {
  if (response.config.url === '/auth/login') {
    response.data = { token: 'cookie-session', user: await hydrateSession() }
  }
  return response
}, async error => {
  const data=error.response?.data
  const flatten=body => body?.error?.message ? { ...body,code:body.error.code,error:body.error.message } : body
  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    try { error.response.data=new Blob([JSON.stringify(flatten(JSON.parse(await data.text())))],{ type:'application/json' }) } catch {}
  } else if (data) error.response.data=flatten(data)
  if (error.response?.status === 401 && error.config?.url !== '/auth/login') {
    setSession(null, null)
    setTimeout(() => { window.location.href = '/login' }, 0)
  }
  return Promise.reject(error)
})
export default api
