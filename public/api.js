// ═══════════════════════════════════════════════
//   GAME GENESIS — API клиент
//   Подключи этот файл на все страницы:
//   <script src="/api.js"></script>
// ═══════════════════════════════════════════════

const API = {

  // ── БАЗОВЫЙ ЗАПРОС ──
  async request(method, path, body = null) {
    const token = localStorage.getItem('gg_token')
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' }
    }
    if (token) opts.headers['Authorization'] = `Bearer ${token}`
    if (body) opts.body = JSON.stringify(body)

    const res = await fetch('/api' + path, opts)
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Ошибка сервера')
    return data
  },

  get:    (path)        => API.request('GET',    path),
  post:   (path, body)  => API.request('POST',   path, body),
  put:    (path, body)  => API.request('PUT',    path, body),
  delete: (path)        => API.request('DELETE', path),

  // ── АВТОРИЗАЦИЯ ──
  auth: {
    async register(data) {
      const res = await API.post('/auth/register', data)
      localStorage.setItem('gg_token', res.token)
      localStorage.setItem('gg_user', JSON.stringify(res.user))
      return res
    },
    async login(login, password) {
      const res = await API.post('/auth/login', { login, password })
      localStorage.setItem('gg_token', res.token)
      localStorage.setItem('gg_user', JSON.stringify(res.user))
      return res
    },
    async verify(code) {
      return await API.post('/auth/verify', { code })
    },
    async resendCode() {
      return await API.post('/auth/resend-code')
    },
    async checkUsername(username) {
      return await API.get(`/auth/check-username/${username}`)
    },
    async me() {
      return await API.get('/auth/me')
    },
    logout() {
      localStorage.removeItem('gg_token')
      localStorage.removeItem('gg_user')
      location.href = '/auth.html'
    },
    getUser() {
      const u = localStorage.getItem('gg_user')
      return u ? JSON.parse(u) : null
    },
    isLoggedIn() {
      return !!localStorage.getItem('gg_token')
    },
    requireAuth() {
      if (!this.isLoggedIn()) {
        location.href = '/auth.html'
        return null
      }
      return this.getUser()
    }
  },

  // ── ПОЛЬЗОВАТЕЛИ ──
  users: {
    getProfile()       { return API.get('/users/profile') },
    updateProfile(d)   { return API.put('/users/profile', d) },
    getRatings()       { return API.get('/users/ratings') },
    getPublic(username){ return API.get(`/users/${username}`) },
    addClip(d)         { return API.post('/users/clips', d) },
    deleteClip(id)     { return API.delete(`/users/clips/${id}`) },
  },

  // ── ТУРНИРЫ ──
  tournaments: {
    getAll(filters)    { const q = new URLSearchParams(filters||{}).toString(); return API.get('/tournaments' + (q ? '?'+q : '')) },
    getOne(id)         { return API.get(`/tournaments/${id}`) },
    create(d)          { return API.post('/tournaments', d) },
    update(id, d)      { return API.put(`/tournaments/${id}`, d) },
    register(id, d)    { return API.post(`/tournaments/${id}/register`, d) },
    unregister(id)     { return API.delete(`/tournaments/${id}/register`) },
    getFinance(id)     { return API.get(`/tournaments/${id}/finance`) },
    addTransaction(id,d){ return API.post(`/tournaments/${id}/finance`, d) },
    delTransaction(tid,id){ return API.delete(`/tournaments/${tid}/finance/${id}`) },
    updateMatch(tid,mid,d){ return API.put(`/tournaments/${tid}/matches/${mid}`, d) },
  }
}

// ── УТИЛИТЫ ──

// Заполняет элементы страницы данными пользователя
function fillUserData(user) {
  const set = (id, val) => { const el = document.getElementById(id); if (el && val) el.textContent = val }
  set('display-username', user.username)
  set('display-fullname', user.full_name)
  set('display-email', user.email)
  set('display-phone', user.phone)
  set('display-game', user.game)
  set('display-uni', user.university)
  set('display-faceit', user.faceit_nick)
  set('display-bio', user.bio)
  set('info-username', user.username)
  set('info-email', user.email)
  set('info-phone', user.phone)
  set('info-faceit', user.faceit_nick)
  set('info-game', user.game)
  set('info-uni', user.university)

  // Аватар — инициалы
  const avatarEl = document.getElementById('avatar-initials')
  if (avatarEl && user.full_name) {
    avatarEl.textContent = user.full_name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0,2)
  }

  // Кнопка логина в header
  const headerUser = document.getElementById('header-username')
  if (headerUser) headerUser.textContent = user.username
}

// Показывает toast-уведомление
function showToast(msg, type = 'success') {
  let toast = document.getElementById('gg-toast')
  if (!toast) {
    toast = document.createElement('div')
    toast.id = 'gg-toast'
    toast.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;padding:12px 20px;border-radius:10px;font-family:Exo 2,sans-serif;font-size:14px;font-weight:500;transition:opacity .3s;max-width:320px;'
    document.body.appendChild(toast)
  }
  toast.style.background = type === 'success' ? '#0d2010' : '#200d0d'
  toast.style.border = type === 'success' ? '1px solid rgba(74,222,128,.3)' : '1px solid rgba(248,113,113,.3)'
  toast.style.color = type === 'success' ? '#4ade80' : '#f87171'
  toast.textContent = (type === 'success' ? '✓ ' : '✗ ') + msg
  toast.style.opacity = '1'
  clearTimeout(toast._timer)
  toast._timer = setTimeout(() => { toast.style.opacity = '0' }, 3500)
}

window.API = API
window.fillUserData = fillUserData
window.showToast = showToast
