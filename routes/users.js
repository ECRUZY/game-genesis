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
  const { full_name, phone, game, university, faceit_nick, bio, steam_url, is_private, avatar } = req.body
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
        is_private = CASE WHEN $8::text IS NOT NULL THEN $8::boolean ELSE is_private END,
        avatar = COALESCE($10, avatar)
       WHERE id = $9
       RETURNING id, username, email, phone, full_name, game, university, faceit_nick, bio, steam_url, is_private, role, verified, avatar`,
      [full_name, phone, game, university, faceit_nick, bio, steam_url, is_private !== undefined ? String(is_private) : null, req.user.id, avatar || null]
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
    `SELECT id, username, full_name, game, university, rating, wins, losses, is_private, avatar
     FROM users ORDER BY rating DESC LIMIT 50`
  )
  res.json(result.rows)
})

// ── ИНДИВИДУАЛЬНЫЙ РЕЙТИНГ ПО НИКАМ (из матч-статов) ──
router.get('/player-stats', async (req, res) => {
  try {
    // Агрегируем статы из match_player_stats по нику
    const stats = await db.query(`
      SELECT
        mps.nickname,
        tr.game,
        SUM(mps.kills)   as total_kills,
        SUM(mps.deaths)  as total_deaths,
        SUM(mps.assists) as total_assists,
        ROUND(AVG(mps.hs_pct))  as avg_hs,
        ROUND(AVG(mps.adr))     as avg_adr,
        COUNT(*)                as matches_played,
        COUNT(CASE WHEN m.winner_team_id = mps.team_id THEN 1 END) as wins,
        COUNT(CASE WHEN m.winner_team_id != mps.team_id AND m.status='done' THEN 1 END) as losses,
        1000
          + 25 * COUNT(CASE WHEN m.winner_team_id = mps.team_id THEN 1 END)
          - 25 * COUNT(CASE WHEN m.winner_team_id != mps.team_id AND m.status='done' THEN 1 END)
          + SUM(CASE WHEN mps.deaths > 0 AND (mps.kills::float/mps.deaths) > 1.5 THEN 10
                     WHEN mps.deaths > 0 AND (mps.kills::float/mps.deaths) < 0.5 THEN -10
                     ELSE 0 END)
          + SUM(CASE WHEN mps.hs_pct > 50 THEN 5 ELSE 0 END)
          + SUM(CASE WHEN mps.adr > 80 THEN 5 ELSE 0 END)
        as elo,
        u.id         as user_id,
        u.username   as username,
        u.full_name  as full_name,
        u.avatar     as avatar,
        u.is_private as is_private
      FROM match_player_stats mps
      LEFT JOIN matches m ON m.id = mps.match_id
      LEFT JOIN teams t ON t.id = mps.team_id
      LEFT JOIN tournaments tr ON tr.id = t.tournament_id
      LEFT JOIN users u ON LOWER(u.username) = LOWER(mps.nickname)
                        OR LOWER(u.faceit_nick) = LOWER(mps.nickname)
      GROUP BY mps.nickname, tr.game, u.id, u.username, u.full_name, u.avatar, u.is_private
      ORDER BY elo DESC
      LIMIT 100
    `)
    res.json(stats.rows)
  } catch(e) {
    console.error(e)
    res.status(500).json({ error: e.message })
  }
})

// ── КОМАНДНЫЙ РЕЙТИНГ ──
router.get('/team-ratings', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT
        t.id,
        t.name,
        t.tournament_id,
        tr.game,
        COALESCE(stats.wins, 0) as wins,
        COALESCE(stats.losses, 0) as losses,
        1000 + 25 * COALESCE(stats.wins, 0) - 25 * COALESCE(stats.losses, 0) as elo,
        COALESCE(
          json_agg(
            json_build_object('nickname', tp.nickname, 'is_captain', tp.is_captain)
            ORDER BY tp.is_captain DESC
          ) FILTER (WHERE tp.id IS NOT NULL),
          '[]'
        ) as players
      FROM teams t
      JOIN tournaments tr ON tr.id = t.tournament_id
      LEFT JOIN team_players tp ON tp.team_id = t.id
      LEFT JOIN LATERAL (
        SELECT
          COUNT(CASE WHEN m.winner_team_id = t.id THEN 1 END) as wins,
          COUNT(CASE WHEN m.winner_team_id != t.id
            AND (m.team1_id = t.id OR m.team2_id = t.id)
            AND m.status = 'done' THEN 1 END) as losses
        FROM matches m
        WHERE m.team1_id = t.id OR m.team2_id = t.id
      ) stats ON true
      WHERE t.status = 'accepted'
      GROUP BY t.id, t.name, t.tournament_id, tr.game, stats.wins, stats.losses
      ORDER BY elo DESC, wins DESC
      LIMIT 100
    `)
    res.json(result.rows)
  } catch(e) {
    console.error(e)
    res.status(500).json({ error: e.message })
  }
})


// ── РЕЙТИНГ ИГРОКА ПО ИГРАМ ──
router.get('/:username/ratings', async (req, res) => {
  try {
    const user = await db.query('SELECT id FROM users WHERE username=$1', [req.params.username])
    if (!user.rows[0]) return res.status(404).json({ error: 'Не найден' })

    const ratings = await db.query(
      `SELECT game, rating, wins, losses
       FROM player_ratings WHERE user_id=$1 ORDER BY rating DESC`,
      [user.rows[0].id]
    )

    // Если нет записей — берём из основного профиля
    if (!ratings.rows.length) {
      const u = await db.query('SELECT game, rating, wins, losses FROM users WHERE id=$1', [user.rows[0].id])
      if (u.rows[0] && u.rows[0].game) {
        return res.json([{
          game: u.rows[0].game,
          rating: u.rows[0].rating || 1000,
          wins: u.rows[0].wins || 0,
          losses: u.rows[0].losses || 0
        }])
      }
    }

    res.json(ratings.rows)
  } catch(e) {
    console.error(e)
    res.status(500).json({ error: 'Ошибка сервера' })
  }
})

// ── ПУБЛИЧНЫЙ ПРОФИЛЬ ──

// ── РЕЙТИНГ ИГРОКА ПО ИГРАМ ──
router.get('/:username/ratings', async (req, res) => {
  try {
    const user = await db.query('SELECT id FROM users WHERE username=$1', [req.params.username])
    if (!user.rows[0]) return res.status(404).json({ error: 'Не найден' })

    const ratings = await db.query(
      `SELECT game, rating, wins, losses
       FROM player_ratings WHERE user_id=$1 ORDER BY rating DESC`,
      [user.rows[0].id]
    )

    // Если нет записей — берём из основного профиля
    if (!ratings.rows.length) {
      const u = await db.query('SELECT game, rating, wins, losses FROM users WHERE id=$1', [user.rows[0].id])
      if (u.rows[0] && u.rows[0].game) {
        return res.json([{
          game: u.rows[0].game,
          rating: u.rows[0].rating || 1000,
          wins: u.rows[0].wins || 0,
          losses: u.rows[0].losses || 0
        }])
      }
    }

    res.json(ratings.rows)
  } catch(e) {
    console.error(e)
    res.status(500).json({ error: 'Ошибка сервера' })
  }
})

// ── ПУБЛИЧНЫЙ ПРОФИЛЬ ──
router.get('/:username', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, username, full_name, game, university, faceit_nick, steam_url, bio,
               is_private, rating, wins, losses, created_at, role, avatar
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
