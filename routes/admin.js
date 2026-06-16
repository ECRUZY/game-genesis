const express = require('express')
const router = express.Router()
const db = require('../db')
const jwt = require('jsonwebtoken')

// Middleware - только admin
async function adminAuth(req, res, next) {
  try {
    const token = (req.headers.authorization || '').replace('Bearer ', '')
    if (!token) return res.status(401).json({ error: 'Нет токена' })
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    const user = await db.query('SELECT id, role FROM users WHERE id=$1', [decoded.id])
    if (!user.rows[0] || user.rows[0].role !== 'admin') return res.status(403).json({ error: 'Нет доступа' })
    req.user = decoded
    next()
  } catch(e) {
    res.status(401).json({ error: 'Неверный токен' })
  }
}

// ── ПОЛЬЗОВАТЕЛИ ──
router.get('/users', adminAuth, async (req, res) => {
  const result = await db.query(
    `SELECT id, username, email, full_name, role, verified, rating, wins, losses, created_at
     FROM users ORDER BY created_at DESC`
  )
  res.json(result.rows)
})

router.post('/users/:id/ban', adminAuth, async (req, res) => {
  await db.query('UPDATE users SET verified=false WHERE id=$1', [req.params.id])
  res.json({ success: true })
})

router.put('/users/:id/role', adminAuth, async (req, res) => {
  const { role } = req.body
  if (!['admin','organizer','player'].includes(role)) return res.status(400).json({ error: 'Неверная роль' })
  await db.query('UPDATE users SET role=$1 WHERE id=$2', [role, req.params.id])
  res.json({ success: true })
})

// ── FEATURED ТУРНИР ──
router.post('/featured', adminAuth, async (req, res) => {
  const { tournament_id } = req.body
  try {
    await db.query(
      `INSERT INTO site_config (key, value, updated_at) VALUES ('featured_tournament_id', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET value=$1, updated_at=NOW()`,
      [String(tournament_id)]
    )
    res.json({ success: true })
  } catch(e) {
    console.error(e)
    res.status(500).json({ error: 'Ошибка сервера' })
  }
})

router.get('/featured', async (req, res) => {
  try {
    const result = await db.query("SELECT value FROM site_config WHERE key='featured_tournament_id'")
    res.json({ tournament_id: result.rows[0]?.value || null })
  } catch(e) {
    res.json({ tournament_id: null })
  }
})

// ── ВСЕ ЗАЯВКИ КОМАНД ──
router.get('/teams', adminAuth, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT t.*, tr.name as tournament_name
       FROM teams t
       LEFT JOIN tournaments tr ON t.tournament_id = tr.id
       ORDER BY t.created_at DESC
       LIMIT 200`
    )
    res.json(result.rows)
  } catch(e) {
    res.status(500).json({ error: 'Ошибка сервера' })
  }
})

// ── СТУД. ФОТО ──
router.get('/teams/:id/student-photo', adminAuth, async (req, res) => {
  try {
    const result = await db.query('SELECT student_photo, student_data FROM teams WHERE id=$1', [req.params.id])
    if (!result.rows[0]) return res.status(404).json({ error: 'Не найдено' })
    res.json({ photo: result.rows[0].student_photo, data: result.rows[0].student_data })
  } catch(e) {
    res.status(500).json({ error: 'Ошибка' })
  }
})

// ── СТУД. ВЕРИФИКАЦИИ ──
router.put('/student-verification/:id', adminAuth, async (req, res) => {
  const { status } = req.body
  if (!['approved','rejected','pending'].includes(status)) return res.status(400).json({ error: 'Неверный статус' })
  try {
    await db.query('UPDATE student_verifications SET status=$1 WHERE id=$2', [status, req.params.id])
    res.json({ success: true })
  } catch(e) {
    res.status(500).json({ error: 'Ошибка' })
  }
})

// ── УДАЛЕНИЕ ТУРНИРА ──
router.delete('/tournaments/:id', adminAuth, async (req, res) => {
  try {
    await db.query('DELETE FROM tournaments WHERE id=$1', [req.params.id])
    res.json({ success: true })
  } catch(e) {
    res.status(500).json({ error: 'Ошибка удаления' })
  }
})

// ── СТАТИСТИКА ──
router.get('/stats', adminAuth, async (req, res) => {
  try {
    const [users, tournaments, partners, teams] = await Promise.all([
      db.query('SELECT COUNT(*) FROM users'),
      db.query('SELECT COUNT(*) FROM tournaments'),
      db.query('SELECT COUNT(*) FROM partner_requests'),
      db.query('SELECT COUNT(*) FROM teams')
    ])
    res.json({
      users: parseInt(users.rows[0].count),
      tournaments: parseInt(tournaments.rows[0].count),
      partners: parseInt(partners.rows[0].count),
      teams: parseInt(teams.rows[0].count)
    })
  } catch(e) {
    res.status(500).json({ error: 'Ошибка' })
  }
})

module.exports = router

// ── УПРАВЛЕНИЕ ПОДПИСКАМИ ──
router.post('/subscription', auth, async (req, res) => {
  try {
    const adminRes = await db.query('SELECT role FROM users WHERE id=$1', [req.user.id])
    if (adminRes.rows[0]?.role !== 'admin') return res.status(403).json({ error: 'Нет прав' })

    const { user_id, subscription_type, months } = req.body
    // subscription_type: 'organizer' | 'university' | null (отменить)

    if (!subscription_type) {
      // Отменить подписку
      await db.query(
        'UPDATE users SET subscription_type=NULL, subscription_expires=NULL WHERE id=$1',
        [user_id]
      )
      return res.json({ success: true, message: 'Подписка отменена' })
    }

    const expires = new Date()
    expires.setMonth(expires.getMonth() + (months || 1))

    await db.query(
      'UPDATE users SET subscription_type=$1, subscription_expires=$2 WHERE id=$3',
      [subscription_type, expires, user_id]
    )
    res.json({ success: true, message: `Подписка ${subscription_type} выдана до ${expires.toLocaleDateString('ru-RU')}` })
  } catch(e) {
    res.status(500).json({ error: e.message })
  }
})

// ── СПИСОК ПОЛЬЗОВАТЕЛЕЙ С ПОДПИСКАМИ ──
router.get('/subscriptions', auth, async (req, res) => {
  try {
    const adminRes = await db.query('SELECT role FROM users WHERE id=$1', [req.user.id])
    if (adminRes.rows[0]?.role !== 'admin') return res.status(403).json({ error: 'Нет прав' })

    const result = await db.query(
      `SELECT id, username, full_name, email, role, subscription_type, subscription_expires
       FROM users WHERE subscription_type IS NOT NULL OR role IN ('admin','organizer')
       ORDER BY subscription_type NULLS LAST, username`
    )
    res.json(result.rows)
  } catch(e) {
    res.status(500).json({ error: e.message })
  }
})
