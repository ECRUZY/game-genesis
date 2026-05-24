const express = require('express')
const router = express.Router()
const db = require('../db')
const auth = require('../middleware/auth')

// ── МОЙ ПРОФИЛЬ ──
router.get('/profile', auth, async (req, res) => {
  try {
    const user = await db.query(
      `SELECT id, username, email, phone, full_name, game, university, faceit_nick, bio, role, verified, rating, wins, losses, created_at
       FROM users WHERE id = $1`,
      [req.user.id]
    )
    if (!user.rows[0]) return res.status(404).json({ error: 'Не найден' })

    // Турниры пользователя (организованные)
    const tournaments = await db.query(
      `SELECT id, name, game, status, max_slots, entry_fee, prize_pool, start_date, created_at
       FROM tournaments WHERE organizer_id = $1 ORDER BY created_at DESC`,
      [req.user.id]
    )

    // Регистрации (участие)
    let registrations = { rows: [] }
    try {
      registrations = await db.query(
        `SELECT t.id, t.name, t.game, t.status, t.start_date, r.registered_at
         FROM registrations r JOIN tournaments t ON r.tournament_id = t.id
         WHERE r.user_id = $1 ORDER BY r.registered_at DESC`,
        [req.user.id]
      )
    } catch(e) { console.log('Registrations error:', e.message) }

    // Нарезки (с защитой если колонки нет)
    let clipsRows = []
    try {
      const clips = await db.query(
        'SELECT * FROM clips WHERE user_id = $1 ORDER BY created_at DESC',
        [req.user.id]
      )
      clipsRows = clips.rows
    } catch(e) {
      console.log('Clips query error (migration needed):', e.message)
    }

    res.json({
      user: user.rows[0],
      organized_tournaments: tournaments.rows,
      participated_tournaments: registrations.rows,
      clips: clipsRows
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Ошибка сервера' })
  }
})

// ── ОБНОВИТЬ ПРОФИЛЬ ──
router.put('/profile', auth, async (req, res) => {
  const { full_name, phone, game, university, faceit_nick, bio, steam_url, is_private } = req.body
  try {
    const result = await db.query(
      `UPDATE users SET
        full_name = COALESCE($1, full_name),
        phone = COALESCE($2, phone),
        game = COALESCE($3, game),
        university = COALESCE($4, university),
        faceit_nick = COALESCE($5, faceit_nick),
        bio = COALESCE($6, bio),
        steam_url = COALESCE($7, steam_url),
        is_private = CASE WHEN $8::text IS NOT NULL THEN $8::boolean ELSE is_private END
       WHERE id = $9
       RETURNING id, username, email, phone, full_name, game, university, faceit_nick, bio, steam_url, is_private, role, verified`,
      [full_name, phone, game, university, faceit_nick, bio, steam_url, is_private !== undefined ? String(is_private) : null, req.user.id]
    )
    res.json(result.rows[0])
  } catch (e) {
    res.status(500).json({ error: 'Ошибка обновления' })
  }
})

// ── ДОБАВИТЬ НАРЕЗКУ ──
router.post('/clips', auth, async (req, res) => {
  const { title, game, duration, youtube_url, yt_id } = req.body
  if (!title) return res.status(400).json({ error: 'Введите название' })
  try {
    const result = await db.query(
      'INSERT INTO clips (user_id, title, game, duration, youtube_url, yt_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [req.user.id, title, game || 'CS2', duration || '0:30', youtube_url || null, yt_id || null]
    )
    res.status(201).json(result.rows[0])
  } catch (e) {
    res.status(500).json({ error: 'Ошибка добавления' })
  }
})

// ── УДАЛИТЬ НАРЕЗКУ ──
router.delete('/clips/:id', auth, async (req, res) => {
  await db.query('DELETE FROM clips WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id])
  res.json({ success: true })
})

// ── РЕЙТИНГ ПЛАТФОРМЫ ──
router.get('/ratings', async (req, res) => {
  const result = await db.query(
    `SELECT id, username, full_name, game, university, rating, wins, losses
     FROM users ORDER BY rating DESC LIMIT 50`
  )
  res.json(result.rows)
})

// ── ПУБЛИЧНЫЙ ПРОФИЛЬ ──
// ── ПУБЛИЧНЫЙ ПРОФИЛЬ ──
router.get('/:username', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, username, full_name, game, university, faceit_nick, steam_url, bio,
               is_private, rating, wins, losses, created_at, role
       FROM users WHERE username = $1`,
      [req.params.username]
    )
    if (!result.rows[0]) return res.status(404).json({ error: 'Пользователь не найден' })
    const u = result.rows[0]
    if (u.is_private) u.full_name = null

    // Клипы (публичные)
    let clips = []
    try {
      const clipsRes = await db.query(
        'SELECT id, title, game, youtube_url, yt_id, created_at FROM clips WHERE user_id = $1 ORDER BY created_at DESC',
        [u.id]
      )
      clips = clipsRes.rows
    } catch(e) {}

    // Турниры организатора (публичные)
    let tournaments = []
    try {
      const tRes = await db.query(
        'SELECT id, name, game, status, max_slots, entry_fee, prize_pool, start_date FROM tournaments WHERE organizer_id = $1 ORDER BY created_at DESC',
        [u.id]
      )
      tournaments = tRes.rows
    } catch(e) {}

    res.json({
      ...u,
      clips,
      organized_tournaments: tournaments
    })
  } catch(e) {
    console.error(e)
    res.status(500).json({ error: 'Ошибка сервера' })
  }
})

module.exports = router
