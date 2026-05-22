const express = require('express')
const router = express.Router()
const db = require('../db')
const auth = require('../middleware/auth')

// ── ВСЕ ТУРНИРЫ ──
router.get('/', async (req, res) => {
  const { game, status, limit = 20 } = req.query
  let q = 'SELECT t.*, u.username as organizer_name FROM tournaments t LEFT JOIN users u ON t.organizer_id = u.id WHERE 1=1'
  const params = []
  if (game) { params.push(game); q += ` AND t.game = $${params.length}` }
  if (status) { params.push(status); q += ` AND t.status = $${params.length}` }
  q += ` ORDER BY t.created_at DESC LIMIT $${params.length + 1}`
  params.push(parseInt(limit))
  const result = await db.query(q, params)
  res.json(result.rows)
})

// ── ОДИН ТУРНИР ──
router.get('/:id', async (req, res) => {
  try {
    const t = await db.query(
      `SELECT t.*, u.username as organizer_name, u.full_name as organizer_fullname
       FROM tournaments t LEFT JOIN users u ON t.organizer_id = u.id WHERE t.id = $1`,
      [req.params.id]
    )
    if (!t.rows[0]) return res.status(404).json({ error: 'Турнир не найден' })

    // Участники
    const regs = await db.query(
      `SELECT r.id, r.nickname, r.registered_at, u.username, u.full_name, u.game, u.rating
       FROM registrations r JOIN users u ON r.user_id = u.id
       WHERE r.tournament_id = $1 ORDER BY r.registered_at`,
      [req.params.id]
    )

    // Матчи / сетка
    const matches = await db.query(
      `SELECT m.*, u1.username as p1_name, u2.username as p2_name, uw.username as winner_name
       FROM matches m
       LEFT JOIN users u1 ON m.player1_id = u1.id
       LEFT JOIN users u2 ON m.player2_id = u2.id
       LEFT JOIN users uw ON m.winner_id = uw.id
       WHERE m.tournament_id = $1 ORDER BY m.round, m.id`,
      [req.params.id]
    )

    res.json({ tournament: t.rows[0], participants: regs.rows, matches: matches.rows })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Ошибка сервера' })
  }
})

// ── СОЗДАТЬ ТУРНИР ──
router.post('/', auth, async (req, res) => {
  const { name, description, game, format, team_size, max_slots, entry_fee, prize_pct, region, start_date, reg_start, reg_end, start_time } = req.body
  if (!name || !game) return res.status(400).json({ error: 'Укажите название и игру' })
  try {
    const result = await db.query(
      `INSERT INTO tournaments (organizer_id, name, description, game, format, team_size, max_slots, entry_fee, prize_pct, region, start_date, reg_start, reg_end, start_time)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [req.user.id, name, description || '', game, format || 'single_elimination', team_size || '1x1',
       max_slots || 16, entry_fee || 0, prize_pct || 50, region || 'Чеченская Республика',
       start_date, reg_start, reg_end, start_time || '18:00']
    )
    res.status(201).json(result.rows[0])
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Ошибка создания турнира' })
  }
})

// ── ОБНОВИТЬ ТУРНИР ──
router.put('/:id', auth, async (req, res) => {
  const t = await db.query('SELECT organizer_id FROM tournaments WHERE id=$1', [req.params.id])
  if (!t.rows[0]) return res.status(404).json({ error: 'Не найден' })
  if (t.rows[0].organizer_id !== req.user.id) return res.status(403).json({ error: 'Нет прав' })

  const { name, status, description } = req.body
  const result = await db.query(
    `UPDATE tournaments SET
      name = COALESCE($1, name),
      status = COALESCE($2, status),
      description = COALESCE($3, description)
     WHERE id = $4 RETURNING *`,
    [name, status, description, req.params.id]
  )
  res.json(result.rows[0])
})

// ── ЗАРЕГИСТРИРОВАТЬСЯ НА ТУРНИР ──
router.post('/:id/register', auth, async (req, res) => {
  const { nickname, steam_url } = req.body
  try {
    const t = await db.query('SELECT * FROM tournaments WHERE id=$1', [req.params.id])
    if (!t.rows[0]) return res.status(404).json({ error: 'Турнир не найден' })
    if (t.rows[0].status !== 'open') return res.status(400).json({ error: 'Регистрация закрыта' })

    const count = await db.query('SELECT COUNT(*) FROM registrations WHERE tournament_id=$1', [req.params.id])
    if (parseInt(count.rows[0].count) >= t.rows[0].max_slots) {
      return res.status(400).json({ error: 'Все места заняты' })
    }

    await db.query(
      'INSERT INTO registrations (user_id, tournament_id, nickname, steam_url) VALUES ($1,$2,$3,$4)',
      [req.user.id, req.params.id, nickname || req.user.username, steam_url || null]
    )
    res.status(201).json({ success: true, message: 'Вы зарегистрированы!' })
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Вы уже зарегистрированы' })
    console.error(e)
    res.status(500).json({ error: 'Ошибка сервера' })
  }
})

// ── ОТМЕНИТЬ РЕГИСТРАЦИЮ ──
router.delete('/:id/register', auth, async (req, res) => {
  await db.query('DELETE FROM registrations WHERE user_id=$1 AND tournament_id=$2', [req.user.id, req.params.id])
  res.json({ success: true })
})

// ── ФИНАНСЫ ТУРНИРА ──
router.get('/:id/finance', auth, async (req, res) => {
  const t = await db.query('SELECT organizer_id FROM tournaments WHERE id=$1', [req.params.id])
  if (!t.rows[0] || t.rows[0].organizer_id !== req.user.id) return res.status(403).json({ error: 'Нет прав' })

  const txs = await db.query(
    'SELECT * FROM transactions WHERE tournament_id=$1 ORDER BY created_at DESC',
    [req.params.id]
  )
  const summary = txs.rows.reduce((acc, tx) => {
    if (tx.type === 'income') acc.income += tx.amount
    else acc.expense += tx.amount
    return acc
  }, { income: 0, expense: 0 })
  summary.platform = Math.round(summary.income * 0.2)
  summary.net = summary.income - summary.expense - summary.platform

  res.json({ transactions: txs.rows, summary })
})

// ── ДОБАВИТЬ ТРАНЗАКЦИЮ ──
router.post('/:id/finance', auth, async (req, res) => {
  const t = await db.query('SELECT organizer_id FROM tournaments WHERE id=$1', [req.params.id])
  if (!t.rows[0] || t.rows[0].organizer_id !== req.user.id) return res.status(403).json({ error: 'Нет прав' })

  const { description, amount, type } = req.body
  if (!description || !amount || !type) return res.status(400).json({ error: 'Заполните все поля' })

  const result = await db.query(
    'INSERT INTO transactions (tournament_id, description, amount, type) VALUES ($1,$2,$3,$4) RETURNING *',
    [req.params.id, description, Math.abs(parseInt(amount)), type]
  )
  res.status(201).json(result.rows[0])
})

// ── УДАЛИТЬ ТРАНЗАКЦИЮ ──
router.delete('/:tid/finance/:id', auth, async (req, res) => {
  const t = await db.query('SELECT organizer_id FROM tournaments WHERE id=$1', [req.params.tid])
  if (!t.rows[0] || t.rows[0].organizer_id !== req.user.id) return res.status(403).json({ error: 'Нет прав' })
  await db.query('DELETE FROM transactions WHERE id=$1 AND tournament_id=$2', [req.params.id, req.params.tid])
  res.json({ success: true })
})

// ── ЗАПИСАТЬ РЕЗУЛЬТАТ МАТЧА ──
router.put('/:tid/matches/:mid', auth, async (req, res) => {
  const { score1, score2, winner_id } = req.body
  const t = await db.query('SELECT organizer_id FROM tournaments WHERE id=$1', [req.params.tid])
  if (!t.rows[0] || t.rows[0].organizer_id !== req.user.id) return res.status(403).json({ error: 'Нет прав' })

  const result = await db.query(
    `UPDATE matches SET score1=$1, score2=$2, winner_id=$3, status='done', played_at=NOW()
     WHERE id=$4 AND tournament_id=$5 RETURNING *`,
    [score1, score2, winner_id, req.params.mid, req.params.tid]
  )

  // Обновить статистику победителя
  if (winner_id) {
    const loserId = result.rows[0].player1_id === winner_id ? result.rows[0].player2_id : result.rows[0].player1_id
    await db.query('UPDATE users SET wins=wins+1, rating=rating+100 WHERE id=$1', [winner_id])
    if (loserId) await db.query('UPDATE users SET losses=losses+1 WHERE id=$1', [loserId])
  }

  res.json(result.rows[0])
})

module.exports = router
