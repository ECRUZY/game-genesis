const express = require('express')
const router  = express.Router()
const db      = require('../db')
const auth    = require('../middleware/auth')

// ── ПОЛУЧИТЬ УВЕДОМЛЕНИЯ ──
router.get('/', auth, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT * FROM notifications
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 30`,
      [req.user.id]
    )
    const unread = result.rows.filter(n => !n.is_read).length
    res.json({ notifications: result.rows, unread })
  } catch(e) {
    res.status(500).json({ error: e.message })
  }
})

// ── ПРОЧИТАТЬ ОДНО ──
router.patch('/:id/read', auth, async (req, res) => {
  try {
    await db.query(
      'UPDATE notifications SET is_read=true WHERE id=$1 AND user_id=$2',
      [req.params.id, req.user.id]
    )
    res.json({ success: true })
  } catch(e) { res.status(500).json({ error: e.message }) }
})

// ── ПРОЧИТАТЬ ВСЕ ──
router.patch('/read-all', auth, async (req, res) => {
  try {
    await db.query(
      'UPDATE notifications SET is_read=true WHERE user_id=$1',
      [req.user.id]
    )
    res.json({ success: true })
  } catch(e) { res.status(500).json({ error: e.message }) }
})

// ── УДАЛИТЬ ВСЕ ──
router.delete('/clear', auth, async (req, res) => {
  try {
    await db.query('DELETE FROM notifications WHERE user_id=$1', [req.user.id])
    res.json({ success: true })
  } catch(e) { res.status(500).json({ error: e.message }) }
})

module.exports = router
