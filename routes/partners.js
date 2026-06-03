const express = require('express')
const router = express.Router()
const db = require('../db')

// ── ПОДАТЬ ЗАЯВКУ ──
router.post('/request', async (req, res) => {
  const { type, data } = req.body
  if (!type || !data) return res.status(400).json({ error: 'Нет данных' })

  const allowed = ['tournament', 'title', 'media', 'ambassador']
  if (!allowed.includes(type)) return res.status(400).json({ error: 'Неверный тип' })

  try {
    const result = await db.query(
      'INSERT INTO partner_requests (type, data) VALUES ($1, $2) RETURNING id, created_at',
      [type, JSON.stringify(data)]
    )
    res.json({ success: true, id: result.rows[0].id })
  } catch(e) {
    console.error('Partner request error:', e)
    res.status(500).json({ error: 'Ошибка сервера' })
  }
})

// ── СПИСОК ЗАЯВОК (только admin) ──
router.get('/requests', async (req, res) => {
  const auth = req.headers.authorization
  if (!auth) return res.status(401).json({ error: 'Нет доступа' })

  try {
    const jwt = require('jsonwebtoken')
    const decoded = jwt.verify(auth.replace('Bearer ', ''), process.env.JWT_SECRET)
    const user = await db.query('SELECT role FROM users WHERE id=$1', [decoded.id])
    if (!user.rows[0] || user.rows[0].role !== 'admin') {
      return res.status(403).json({ error: 'Только для администраторов' })
    }

    const list = await db.query(
      'SELECT * FROM partner_requests ORDER BY created_at DESC'
    )
    res.json(list.rows)
  } catch(e) {
    res.status(401).json({ error: 'Ошибка авторизации' })
  }
})

// ── ИЗМЕНИТЬ СТАТУС (только admin) ──
router.put('/requests/:id', async (req, res) => {
  const auth = req.headers.authorization
  if (!auth) return res.status(401).json({ error: 'Нет доступа' })

  try {
    const jwt = require('jsonwebtoken')
    const decoded = jwt.verify(auth.replace('Bearer ', ''), process.env.JWT_SECRET)
    const user = await db.query('SELECT role FROM users WHERE id=$1', [decoded.id])
    if (!user.rows[0] || user.rows[0].role !== 'admin') {
      return res.status(403).json({ error: 'Только для администраторов' })
    }

    const { status } = req.body
    const allowed = ['pending', 'approved', 'rejected']
    if (!allowed.includes(status)) return res.status(400).json({ error: 'Неверный статус' })

    await db.query('UPDATE partner_requests SET status=$1 WHERE id=$2', [status, req.params.id])
    res.json({ success: true })
  } catch(e) {
    res.status(500).json({ error: 'Ошибка сервера' })
  }
})

module.exports = router
