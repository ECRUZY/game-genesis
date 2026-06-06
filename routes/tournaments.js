const express = require('express')
const router = express.Router()
const db = require('../db')
const auth = require('../middleware/auth')

// ── ВСЕ ТУРНИРЫ ──
router.get('/', async (req, res) => {
  const { game, status, limit = 20 } = req.query
  let q = `SELECT t.*, t.is_student, u.username as organizer_name, COALESCE(reg.cnt,0)::int as filled_count FROM tournaments t LEFT JOIN users u ON t.organizer_id = u.id LEFT JOIN (SELECT tournament_id, COUNT(*) as cnt FROM teams GROUP BY tournament_id) reg ON reg.tournament_id = t.id WHERE 1=1`
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
      `SELECT t.*, t.is_student, u.username as organizer_name, u.full_name as organizer_fullname
       FROM tournaments t LEFT JOIN users u ON t.organizer_id = u.id WHERE t.id = $1`,
      [req.params.id]
    )
    if (!t.rows[0]) return res.status(404).json({ error: 'Турнир не найден' })

    // Участники — из teams + team_players (новая система)
    const teamsRes = await db.query(
      `SELECT t.id, t.name as team_name, t.status, t.created_at,
        json_agg(json_build_object(
          'nickname', tp.nickname,
          'full_name', tp.full_name,
          'steam_url', tp.steam_url,
          'is_captain', tp.is_captain
        ) ORDER BY tp.is_captain DESC) as players
       FROM teams t
       LEFT JOIN team_players tp ON tp.team_id = t.id
       WHERE t.tournament_id = $1
       GROUP BY t.id ORDER BY t.created_at`,
      [req.params.id]
    )

    // Также берём из registrations (старая система — для совместимости)
    let regsRes = { rows: [] }
    try {
      regsRes = await db.query(
        `SELECT r.id, r.nickname, r.registered_at, u.username, u.full_name
         FROM registrations r
         LEFT JOIN users u ON r.user_id = u.id
         WHERE r.tournament_id = $1 ORDER BY r.registered_at`,
        [req.params.id]
      )
    } catch(e) {}

    // Матчи
    let matches = { rows: [] }
    try {
      matches = await db.query(
        `SELECT m.*, t1.name as team1_name, t2.name as team2_name, tw.name as winner_name
         FROM matches m
         LEFT JOIN teams t1 ON m.team1_id = t1.id
         LEFT JOIN teams t2 ON m.team2_id = t2.id
         LEFT JOIN teams tw ON m.winner_team_id = tw.id
         WHERE m.tournament_id = $1 ORDER BY m.bracket_type, m.round, m.match_number`,
        [req.params.id]
      )
    } catch(e) {}

    res.json({
      tournament: t.rows[0],
      participants: teamsRes.rows,
      registrations: regsRes.rows,
      matches: matches.rows
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Ошибка сервера' })
  }
})

// ── СОЗДАТЬ ТУРНИР ──
router.post('/', auth, async (req, res) => {
  const { name, description, game, format, team_size, max_slots, entry_fee, prize_pct, region, start_date, reg_start, reg_end, start_time, is_student } = req.body
  if (!name || !game) return res.status(400).json({ error: 'Укажите название и игру' })

  // Проверяем роль — admin публикует бесплатно, остальные в будущем платят
  const userRes = await db.query('SELECT role FROM users WHERE id=$1', [req.user.id])
  const role = userRes.rows[0]?.role || 'player'

  try {
    const result = await db.query(
      `INSERT INTO tournaments (organizer_id, name, description, game, format, team_size, max_slots, entry_fee, prize_pct, region, start_date, reg_start, reg_end, start_time, is_student)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [req.user.id, name, description || '', game, format || 'single_elimination', team_size || '1x1',
       max_slots || 16, entry_fee || 0, prize_pct || 50, region || 'Чеченская Республика',
       start_date, reg_start, reg_end, start_time || '18:00', is_student === true || is_student === 'true']
    )
    console.log(`✅ Турнир создан: "${name}" (${game}) от ${req.user.username} [${role}], студенческий: ${is_student}`)
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

    const { team_name, team_data } = req.body
    await db.query(
      'INSERT INTO registrations (user_id, tournament_id, nickname, steam_url, team_name, team_data) VALUES ($1,$2,$3,$4,$5,$6)',
      [req.user.id, req.params.id, nickname || req.user.username, steam_url || null, team_name || null, team_data || null]
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



// ── РЕГИСТРАЦИЯ КОМАНДЫ ──
router.post('/:id/teams', auth, async (req, res) => {
  const { team_name, players, student_data, student_photo, team_type, needs_players } = req.body
  if (!team_name || !players || players.length === 0) {
    return res.status(400).json({ error: 'Укажите название команды и игроков' })
  }

  try {
    const t = await db.query('SELECT * FROM tournaments WHERE id=$1', [req.params.id])
    if (!t.rows[0]) return res.status(404).json({ error: 'Турнир не найден' })
    if (t.rows[0].status !== 'open') return res.status(400).json({ error: 'Регистрация закрыта' })

    // Студенческий турнир — требуем данные
    if (t.rows[0].is_student) {
      if (!student_data || !student_data.university || !student_data.faculty || !student_data.group) {
        return res.status(400).json({ error: 'Для студенческого турнира заполните данные студенческого билета' })
      }
      if (!student_photo) {
        return res.status(400).json({ error: 'Для студенческого турнира загрузите фото студенческого билета' })
      }
    }

    // Считаем сколько команд уже есть
    const teamCount = await db.query('SELECT COUNT(*) FROM teams WHERE tournament_id=$1 AND status!=\'rejected\'', [req.params.id])
    const teamSize = parseInt((t.rows[0].team_size || '5x5').split('x')[0])
    const maxTeams = Math.floor((t.rows[0].max_slots || 40) / teamSize)
    if (parseInt(teamCount.rows[0].count) >= maxTeams) {
      return res.status(400).json({ error: 'Все места заняты' })
    }

    // Создаём команду
    const team = await db.query(
      `INSERT INTO teams (tournament_id, name, captain_id, status, players, needs_players, team_type, student_data, student_photo)
       VALUES ($1,$2,$3,'pending',$4,$5,$6,$7,$8) RETURNING *`,
      [
        req.params.id,
        team_name,
        req.user.id,
        JSON.stringify(players),
        needs_players || 0,
        team_type || 'full',
        student_data ? JSON.stringify(student_data) : null,
        student_photo || null
      ]
    )

    // Добавляем игроков в team_players
    for (const p of players) {
      await db.query(
        'INSERT INTO team_players (team_id, full_name, nickname, steam_url, is_captain) VALUES ($1,$2,$3,$4,$5)',
        [team.rows[0].id, p.full_name || '', p.nickname || '', p.steam_url || '', p.is_captain || false]
      )
    }

    res.status(201).json({ success: true, team: team.rows[0] })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Ошибка регистрации команды' })
  }
})

// ── СПИСОК КОМАНД ТУРНИРА ──
router.get('/:id/teams', async (req, res) => {
  try {
    const teams = await db.query(
      `SELECT t.*, 
        json_agg(json_build_object('id',p.id,'full_name',p.full_name,'nickname',p.nickname,'steam_url',p.steam_url,'is_captain',p.is_captain) 
          ORDER BY p.is_captain DESC, p.id) as players
       FROM teams t
       LEFT JOIN team_players p ON p.team_id = t.id
       WHERE t.tournament_id = $1
       GROUP BY t.id
       ORDER BY t.created_at`,
      [req.params.id]
    )
    res.json(teams.rows)
  } catch(e) {
    res.status(500).json({ error: 'Ошибка загрузки команд' })
  }
})

// ── ПРИНЯТЬ / ОТКЛОНИТЬ КОМАНДУ (только admin/organizer) ──
router.patch('/:tid/teams/:id', auth, async (req, res) => {
  const t = await db.query('SELECT organizer_id FROM tournaments WHERE id=$1', [req.params.tid])
  if (!t.rows[0]) return res.status(404).json({ error: 'Не найден' })
  const userRes = await db.query('SELECT role FROM users WHERE id=$1', [req.user.id])
  const isAdmin = userRes.rows[0]?.role === 'admin' || t.rows[0].organizer_id === req.user.id
  if (!isAdmin) return res.status(403).json({ error: 'Нет прав' })

  const { status } = req.body
  if (!['accepted','rejected','pending'].includes(status)) return res.status(400).json({ error: 'Неверный статус' })

  const result = await db.query('UPDATE teams SET status=$1 WHERE id=$2 AND tournament_id=$3 RETURNING *', [status, req.params.id, req.params.tid])
  res.json(result.rows[0])
})

// ── ГЕНЕРАЦИЯ СЕТКИ Double Elimination ──
router.post('/:id/generate-bracket', auth, async (req, res) => {
  try {
    const t = await db.query('SELECT * FROM tournaments WHERE id=$1', [req.params.id])
    if (!t.rows[0]) return res.status(404).json({ error: 'Не найден' })
    const userRes = await db.query('SELECT role FROM users WHERE id=$1', [req.user.id])
    const isAdmin = userRes.rows[0]?.role === 'admin' || t.rows[0].organizer_id === req.user.id
    if (!isAdmin) return res.status(403).json({ error: 'Нет прав' })

    // Получаем принятые команды
    const teams = await db.query(
      'SELECT * FROM teams WHERE tournament_id=$1 AND status=\'accepted\' ORDER BY id',
      [req.params.id]
    )
    if (teams.rows.length < 2) return res.status(400).json({ error: 'Нужно минимум 2 принятые команды' })

    // Удаляем старые матчи если есть
    await db.query('DELETE FROM matches WHERE tournament_id=$1', [req.params.id])

    // Рандомная жеребьёвка
    const shuffled = teams.rows.sort(() => Math.random() - 0.5)
    const n = shuffled.length

    // Обновляем seed команд
    for (let i = 0; i < shuffled.length; i++) {
      await db.query('UPDATE teams SET seed=$1 WHERE id=$2', [i + 1, shuffled[i].id])
    }

    // Генерируем Upper Bracket (верхняя сетка)
    const upperMatches = []
    let matchNum = 1

    // Раунд 1 верхней сетки
    for (let i = 0; i < Math.floor(n / 2); i++) {
      const m = await db.query(
        `INSERT INTO matches (tournament_id, round, team1_id, team2_id, status, bracket_type, match_number)
         VALUES ($1, 1, $2, $3, 'pending', 'upper', $4) RETURNING *`,
        [req.params.id, shuffled[i * 2].id, shuffled[i * 2 + 1].id, matchNum++]
      )
      upperMatches.push(m.rows[0])
    }

    // Раунд 2 верхней сетки (если 8 команд — 4 матча → 2 матча → финал)
    const rounds = Math.ceil(Math.log2(n))
    for (let r = 2; r <= rounds; r++) {
      const prevRound = await db.query(
        `SELECT * FROM matches WHERE tournament_id=$1 AND round=$2 AND bracket_type='upper' ORDER BY match_number`,
        [req.params.id, r - 1]
      )
      for (let i = 0; i < Math.floor(prevRound.rows.length / 2); i++) {
        await db.query(
          `INSERT INTO matches (tournament_id, round, status, bracket_type, match_number)
           VALUES ($1, $2, 'pending', 'upper', $3) RETURNING *`,
          [req.params.id, r, matchNum++]
        )
      }
    }

    // Нижняя сетка (lower bracket) — проигравшие из верхней
    // Раунд 1 нижней сетки
    for (let i = 0; i < Math.floor(n / 2); i++) {
      await db.query(
        `INSERT INTO matches (tournament_id, round, status, bracket_type, match_number)
         VALUES ($1, 1, 'pending', 'lower', $2)`,
        [req.params.id, matchNum++]
      )
    }

    // Гранд-финал
    await db.query(
      `INSERT INTO matches (tournament_id, round, status, bracket_type, match_number)
       VALUES ($1, 99, 'pending', 'grand_final', $2)`,
      [req.params.id, matchNum++]
    )

    // Обновляем статус турнира
    await db.query(
      'UPDATE tournaments SET bracket_generated=true, status=\'live\' WHERE id=$1',
      [req.params.id]
    )

    const allMatches = await db.query(
      `SELECT m.*, t1.name as team1_name, t2.name as team2_name
       FROM matches m
       LEFT JOIN teams t1 ON m.team1_id = t1.id
       LEFT JOIN teams t2 ON m.team2_id = t2.id
       WHERE m.tournament_id=$1 ORDER BY m.bracket_type, m.round, m.match_number`,
      [req.params.id]
    )

    res.json({ success: true, matches: allMatches.rows, message: `Сетка сгенерирована! ${n} команд, ${allMatches.rows.length} матчей` })
  } catch(e) {
    console.error(e)
    res.status(500).json({ error: 'Ошибка генерации сетки: ' + e.message })
  }
})

// ── ОПУБЛИКОВАТЬ СЕТКУ ──
router.post('/:id/publish-bracket', auth, async (req, res) => {
  const t = await db.query('SELECT organizer_id, bracket_generated FROM tournaments WHERE id=$1', [req.params.id])
  if (!t.rows[0]) return res.status(404).json({ error: 'Не найден' })
  if (!t.rows[0].bracket_generated) return res.status(400).json({ error: 'Сначала сгенерируйте сетку' })
  await db.query('UPDATE tournaments SET bracket_published=true WHERE id=$1', [req.params.id])
  res.json({ success: true })
})


// ── ОБНОВИТЬ ОБЛОЖКУ ТУРНИРА ──
router.post('/:id/cover', auth, async (req, res) => {
  const { cover_image } = req.body
  if (!cover_image) return res.status(400).json({ error: 'Нет изображения' })

  // Проверяем что это организатор или admin
  const user = await db.query('SELECT role FROM users WHERE id=$1', [req.user.id])
  const t = await db.query('SELECT organizer_id FROM tournaments WHERE id=$1', [req.params.id])
  if (!t.rows[0]) return res.status(404).json({ error: 'Турнир не найден' })

  const isAdmin = user.rows[0]?.role === 'admin'
  const isOrganizer = t.rows[0].organizer_id === req.user.id
  if (!isAdmin && !isOrganizer) return res.status(403).json({ error: 'Нет доступа' })

  await db.query('UPDATE tournaments SET cover_image=$1 WHERE id=$2', [cover_image, req.params.id])
  res.json({ success: true })
})

module.exports = router
