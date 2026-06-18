const express = require('express')
const router = express.Router()
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')
const db = require('../db')
const authMiddleware = require('../middleware/auth')
const { sendVerificationCode } = require('../utils/mailer')

// Временное хранилище pending регистраций (в памяти, 10 мин)
const pendingRegistrations = new Map()

// ── ШАГИ РЕГИСТРАЦИИ ──
// Шаг 1: Проверяем данные и отправляем код на email
router.post('/register/send-code', async (req, res) => {
  const { username, email, phone, password, full_name, game } = req.body

  if (!username || !email || !password)
    return res.status(400).json({ error: 'Заполните все обязательные поля' })
  if (password.length < 8)
    return res.status(400).json({ error: 'Пароль минимум 8 символов' })
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username))
    return res.status(400).json({ error: 'Логин: только латиница, цифры и _, 3–20 символов' })

  try {
    // Проверяем что логин и email свободны
    const existing = await db.query(
      'SELECT id, username, email FROM users WHERE username=$1 OR email=$2',
      [username, email]
    )
    if (existing.rows.length > 0) {
      const taken = existing.rows[0]
      if (taken.username === username) return res.status(400).json({ error: 'Этот логин уже занят' })
      if (taken.email === email) return res.status(400).json({ error: 'Этот email уже зарегистрирован' })
    }

    // Генерируем код
    const code = Math.floor(100000 + Math.random() * 900000).toString()
    const expires = Date.now() + 10 * 60 * 1000

    // Сохраняем данные во временное хранилище
    const hash = await bcrypt.hash(password, 12)
    pendingRegistrations.set(email, {
      username, email, phone, hash, full_name, game, code, expires
    })

    // Очищаем через 10 минут
    setTimeout(() => pendingRegistrations.delete(email), 10 * 60 * 1000)

    // Отправляем код
    try {
      await sendVerificationCode(email, code, username)
      console.log(`📧 Код отправлен на ${email}`)
    } catch(mailErr) {
      console.error('Mail error:', mailErr.message)
      return res.status(500).json({ error: 'Не удалось отправить код. Проверьте email или попробуйте позже.' })
    }

    res.json({ success: true, message: 'Код отправлен на ' + email })
  } catch(e) {
    console.error('Send code error:', e)
    res.status(500).json({ error: 'Ошибка сервера' })
  }
})

// Шаг 2: Подтверждаем код и создаём аккаунт
router.post('/register/verify', async (req, res) => {
  const { email, code } = req.body
  if (!email || !code) return res.status(400).json({ error: 'Укажите email и код' })

  const pending = pendingRegistrations.get(email)
  if (!pending) return res.status(400).json({ error: 'Сессия истекла. Начните регистрацию заново.' })
  if (Date.now() > pending.expires) {
    pendingRegistrations.delete(email)
    return res.status(400).json({ error: 'Код истёк. Начните регистрацию заново.' })
  }
  if (pending.code !== code.trim()) return res.status(400).json({ error: 'Неверный код' })

  try {
    // Финальная проверка перед созданием
    const existing = await db.query('SELECT id FROM users WHERE username=$1 OR email=$2', [pending.username, email])
    if (existing.rows.length > 0) return res.status(400).json({ error: 'Логин или email уже заняты' })

    // Создаём аккаунт
    const result = await db.query(
      `INSERT INTO users (username, email, phone, password_hash, full_name, game, verified, rating)
       VALUES ($1,$2,$3,$4,$5,$6,true,1000) RETURNING id, username, email, full_name, game, role, verified`,
      [pending.username, email, pending.phone || null, pending.hash, pending.full_name || pending.username, pending.game || 'CS2']
    )
    pendingRegistrations.delete(email)

    const user = result.rows[0]
    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    )

    console.log(`✅ Новый пользователь: ${user.username} (${email})`)
    res.status(201).json({ token, user })
  } catch(e) {
    console.error('Register verify error:', e)
    res.status(500).json({ error: 'Ошибка создания аккаунта' })
  }
})

// Повторная отправка кода (для pending регистраций)
router.post('/register/resend', async (req, res) => {
  const { email } = req.body
  const pending = pendingRegistrations.get(email)
  if (!pending) return res.status(400).json({ error: 'Сессия истекла. Начните регистрацию заново.' })

  const code = Math.floor(100000 + Math.random() * 900000).toString()
  pending.code = code
  pending.expires = Date.now() + 10 * 60 * 1000

  try {
    await sendVerificationCode(email, code, pending.username)
    res.json({ success: true })
  } catch(e) {
    res.status(500).json({ error: 'Не удалось отправить код' })
  }
})

// ── СТАРЫЙ /register (оставляем для совместимости но редиректим) ──
router.post('/register', async (req, res) => {
  return res.status(400).json({ 
    error: 'Используйте /register/send-code и /register/verify',
    redirect: '/register/send-code'
  })
})

// ── ВЕРИФИКАЦИЯ EMAIL (для уже зарегистрированных) ──
router.post('/verify', authMiddleware, async (req, res) => {
  const { code } = req.body
  try {
    const result = await db.query(
      'SELECT verify_code, verify_expires, verified FROM users WHERE id = $1',
      [req.user.id]
    )
    const user = result.rows[0]
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' })
    if (user.verified) return res.json({ success: true, message: 'Уже верифицирован' })
    if (user.verify_code !== code) return res.status(400).json({ error: 'Неверный код' })
    if (Date.now() > parseInt(user.verify_expires)) return res.status(400).json({ error: 'Код истёк' })
    await db.query('UPDATE users SET verified=true, verify_code=null WHERE id=$1', [req.user.id])
    res.json({ success: true })
  } catch(e) {
    res.status(500).json({ error: 'Ошибка сервера' })
  }
})

// ── ПОВТОРНАЯ ОТПРАВКА КОДА (авторизованный) ──
router.post('/resend-code', authMiddleware, async (req, res) => {
  const code = Math.floor(100000 + Math.random() * 900000).toString()
  const expires = Date.now() + 10 * 60 * 1000
  await db.query('UPDATE users SET verify_code=$1, verify_expires=$2 WHERE id=$3', [code, expires, req.user.id])
  const userRes = await db.query('SELECT email, username FROM users WHERE id=$1', [req.user.id])
  try {
    await sendVerificationCode(userRes.rows[0].email, code, userRes.rows[0].username)
  } catch(e) { console.error('Mail resend error:', e.message) }
  res.json({ success: true })
})

// ── ВХОД ──
router.post('/login', async (req, res) => {
  const { login, password } = req.body
  if (!login || !password) return res.status(400).json({ error: 'Введите логин и пароль' })
  try {
    const result = await db.query(
      'SELECT * FROM users WHERE email=$1 OR username=$1',
      [login.trim()]
    )
    const user = result.rows[0]
    if (!user) return res.status(401).json({ error: 'Пользователь не найден' })
    const ok = await bcrypt.compare(password, user.password_hash)
    if (!ok) return res.status(401).json({ error: 'Неверный пароль' })

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    )
    res.json({
      token,
      user: {
        id: user.id, username: user.username, email: user.email,
        full_name: user.full_name, game: user.game, university: user.university,
        faceit_nick: user.faceit_nick, bio: user.bio, phone: user.phone,
        role: user.role, verified: user.verified, rating: user.rating,
        wins: user.wins, losses: user.losses, created_at: user.created_at
      }
    })
  } catch(e) {
    console.error('Login error:', e)
    res.status(500).json({ error: 'Ошибка сервера' })
  }
})

// ── ПРОВЕРКА ЛОГИНА ──
router.get('/check-username/:username', async (req, res) => {
  const result = await db.query('SELECT id FROM users WHERE username=$1', [req.params.username])
  res.json({ available: result.rows.length === 0 })
})

// ── ТЕКУЩИЙ ПОЛЬЗОВАТЕЛЬ ──
router.get('/me', authMiddleware, async (req, res) => {
  const result = await db.query(
    'SELECT id, username, email, phone, full_name, game, university, faceit_nick, bio, role, verified, rating, wins, losses, created_at FROM users WHERE id=$1',
    [req.user.id]
  )
  if (!result.rows[0]) return res.status(404).json({ error: 'Не найден' })
  res.json(result.rows[0])
})

// ── ЗАБЫЛ ПАРОЛЬ ──
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body
  if (!email) return res.status(400).json({ error: 'Укажите email' })

  try {
    const result = await db.query('SELECT id, username FROM users WHERE email=$1', [email])
    // Всегда отвечаем успехом — не раскрываем существование email
    if (!result.rows[0]) return res.json({ success: true })

    const user = result.rows[0]
    const crypto = require('crypto')
    const token = crypto.randomBytes(32).toString('hex')
    const expires = new Date(Date.now() + 60 * 60 * 1000) // 1 час

    await db.query(
      'UPDATE users SET reset_token=$1, reset_token_expires=$2 WHERE id=$3',
      [token, expires, user.id]
    )

    const resetUrl = `${process.env.APP_URL}/reset-password.html?token=${token}`

    const { sendResetPassword } = require('../utils/mailer')
    await sendResetPassword(email, resetUrl, user.username)

    res.json({ success: true })
  } catch(e) {
    console.error('forgot-password error:', e)
    res.status(500).json({ error: 'Ошибка сервера' })
  }
})

// ── СБРОС ПАРОЛЯ ──
router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body
  if (!token || !password) return res.status(400).json({ error: 'Неверный запрос' })
  if (password.length < 8) return res.status(400).json({ error: 'Пароль минимум 8 символов' })

  try {
    const result = await db.query(
      'SELECT id FROM users WHERE reset_token=$1 AND reset_token_expires > NOW()',
      [token]
    )
    if (!result.rows[0]) return res.status(400).json({ error: 'Ссылка недействительна или истекла' })

    const hash = await bcrypt.hash(password, 10)
    await db.query(
      'UPDATE users SET password_hash=$1, reset_token=NULL, reset_token_expires=NULL WHERE id=$2',
      [hash, result.rows[0].id]
    )

    res.json({ success: true })
  } catch(e) {
    console.error('reset-password error:', e)
    res.status(500).json({ error: 'Ошибка сервера' })
  }
})

module.exports = router
