const express = require('express')
const router = express.Router()
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')
const db = require('../db')
const authMiddleware = require('../middleware/auth')
const { sendVerificationCode, sendPasswordReset } = require('../utils/mailer')

// ── РЕГИСТРАЦИЯ ──
router.post('/register', async (req, res) => {
  const { username, email, phone, password, full_name, game } = req.body

  if (!username || !email || !password) {
    return res.status(400).json({ error: 'Заполните все обязательные поля' })
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Пароль минимум 8 символов' })
  }
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
    return res.status(400).json({ error: 'Логин: только латиница, цифры и _, 3–20 символов' })
  }

  try {
    const hash = await bcrypt.hash(password, 12)

    // Генерируем 6-значный код верификации
    const code = Math.floor(100000 + Math.random() * 900000).toString()
    const expires = Date.now() + 10 * 60 * 1000 // 10 минут

    const result = await db.query(
      `INSERT INTO users (username, email, phone, password_hash, full_name, game, verify_code, verify_expires)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, username, email, full_name, game, role, verified`,
      [username, email, phone || null, hash, full_name || username, game || 'CS2', code, expires]
    )

    const user = result.rows[0]

    // Отправляем код на email
    try {
      await sendVerificationCode(email, code, username)
      console.log(`📧 Код отправлен на ${email}`)
    } catch(mailErr) {
      console.error('Mail error:', mailErr.message)
      // Не блокируем регистрацию если почта не отправилась
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    )

    res.status(201).json({
      token,
      user: { id: user.id, username: user.username, email: user.email, full_name: user.full_name, game: user.game, role: user.role, verified: user.verified },
      // dev_code только для разработки
      dev_code: process.env.NODE_ENV === 'development' ? code : undefined
    })
  } catch (e) {
    if (e.code === '23505') {
      if (e.detail.includes('username')) return res.status(400).json({ error: 'Этот логин уже занят' })
      if (e.detail.includes('email')) return res.status(400).json({ error: 'Этот email уже зарегистрирован' })
    }
    console.error('Register error:', e)
    res.status(500).json({ error: 'Ошибка сервера' })
  }
})

// ── ВЕРИФИКАЦИЯ EMAIL ──
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
    if (Date.now() > parseInt(user.verify_expires)) return res.status(400).json({ error: 'Код истёк, запросите новый' })

    await db.query('UPDATE users SET verified = true, verify_code = null WHERE id = $1', [req.user.id])
    res.json({ success: true })
  } catch (e) {
    res.status(500).json({ error: 'Ошибка сервера' })
  }
})

// ── ПОВТОРНАЯ ОТПРАВКА КОДА ──
router.post('/resend-code', authMiddleware, async (req, res) => {
  const code = Math.floor(100000 + Math.random() * 900000).toString()
  const expires = Date.now() + 10 * 60 * 1000
  await db.query('UPDATE users SET verify_code=$1, verify_expires=$2 WHERE id=$3', [code, expires, req.user.id])
  const userRes = await db.query('SELECT email FROM users WHERE id=$1', [req.user.id])
  try {
    const uData = await db.query('SELECT username FROM users WHERE id=$1', [req.user.id])
    await sendVerificationCode(userRes.rows[0].email, code, uData.rows[0]?.username || 'Игрок')
  } catch(e) { console.error('Mail resend error:', e.message) }
  res.json({ success: true, dev_code: process.env.NODE_ENV !== 'production' ? code : undefined })
})

// ── ВХОД ──
router.post('/login', async (req, res) => {
  const { login, password } = req.body
  if (!login || !password) return res.status(400).json({ error: 'Введите логин и пароль' })

  try {
    const result = await db.query(
      'SELECT * FROM users WHERE email = $1 OR username = $1',
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
  } catch (e) {
    console.error('Login error:', e)
    res.status(500).json({ error: 'Ошибка сервера' })
  }
})

// ── ПРОВЕРКА ЛОГИНА ──
router.get('/check-username/:username', async (req, res) => {
  const result = await db.query('SELECT id FROM users WHERE username = $1', [req.params.username])
  res.json({ available: result.rows.length === 0 })
})

// ── ТЕКУЩИЙ ПОЛЬЗОВАТЕЛЬ ──
router.get('/me', authMiddleware, async (req, res) => {
  const result = await db.query(
    'SELECT id, username, email, phone, full_name, game, university, faceit_nick, bio, role, verified, rating, wins, losses, created_at FROM users WHERE id = $1',
    [req.user.id]
  )
  if (!result.rows[0]) return res.status(404).json({ error: 'Не найден' })
  res.json(result.rows[0])
})

module.exports = router
