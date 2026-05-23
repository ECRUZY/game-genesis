const express = require('express')
const router = express.Router()
const db = require('../db')
const auth = require('../middleware/auth')

// ── ЗАРЕГИСТРИРОВАТЬ КОМАНДУ НА ТУРНИР ──
router.post('/:tid/teams', async (req, res) => {
  const { tid } = req.params
  const { team_name, players } = req.body  // players: [{full_name, nickname, steam_url, is_captain}]

  if (!team_name || !players || !players.length) {
    return res.status(400).json({ error: 'Укажите название команды и игроков' })
  }

  try {
    // Проверяем турнир
    const t = await db.query('SELECT * FROM tournaments WHERE id=$1', [tid])
    if (!t.rows[0]) return res.status(404).json({ error: 'Турнир не найден' })
    if (t.rows[0].status !== 'open') return res.status(400).json({ error: 'Регистрация закрыта' })

    // Считаем уже зарегистрированные команды
    const cnt = await db.query('SELECT COUNT(*) FROM teams WHERE tournament_id=$1', [tid])
    const max_teams = Math.floor(t.rows[0].max_slots / 5)
    if (parseInt(cnt.rows[0].count) >= max_teams) {
      return res.status(400).json({ error: `Все ${max_teams} мест заняты` })
    }

    // Проверяем дубли по названию
    const dup = await db.query('SELECT id FROM teams WHERE tournament_id=$1 AND LOWER(name)=LOWER($2)', [tid, team_name])
    if (dup.rows[0]) return res.status(400).json({ error: 'Команда с таким названием уже зарегистрирована' })

    // Создаём команду
    const captain_id = req.user ? req.user.id : null
    const team = await db.query(
      'INSERT INTO teams (tournament_id, name, captain_id, status) VALUES ($1,$2,$3,$4) RETURNING *',
      [tid, team_name, captain_id, 'pending']
    )
    const team_id = team.rows[0].id

    // Добавляем игроков
    for (const p of players) {
      await db.query(
        'INSERT INTO team_players (team_id, full_name, nickname, steam_url, is_captain) VALUES ($1,$2,$3,$4,$5)',
        [team_id, p.full_name || '', p.nickname || '', p.steam_url || '', p.is_captain || false]
      )
    }

    console.log(`✅ Команда "${team_name}" зарегистрирована на турнир #${tid}`)
    res.status(201).json({ success: true, team: team.rows[0] })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Ошибка регистрации команды' })
  }
})

// ── СПИСОК КОМАНД ТУРНИРА ──
router.get('/:tid/teams', async (req, res) => {
  try {
    const teams = await db.query(
      `SELECT t.*, 
        json_agg(json_build_object(
          'id', tp.id, 'full_name', tp.full_name,
          'nickname', tp.nickname, 'steam_url', tp.steam_url,
          'is_captain', tp.is_captain
        ) ORDER BY tp.is_captain DESC, tp.id) as players
       FROM teams t
       LEFT JOIN team_players tp ON tp.team_id = t.id
       WHERE t.tournament_id = $1
       GROUP BY t.id
       ORDER BY t.created_at`,
      [req.params.tid]
    )
    res.json(teams.rows)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Ошибка загрузки команд' })
  }
})

// ── ПРИНЯТЬ / ОТКЛОНИТЬ КОМАНДУ (только admin) ──
router.put('/:tid/teams/:team_id', auth, async (req, res) => {
  try {
    const user = await db.query('SELECT role FROM users WHERE id=$1', [req.user.id])
    if (user.rows[0]?.role !== 'admin') return res.status(403).json({ error: 'Только для администратора' })

    const { status } = req.body // 'accepted' | 'rejected'
    const result = await db.query(
      'UPDATE teams SET status=$1 WHERE id=$2 AND tournament_id=$3 RETURNING *',
      [status, req.params.team_id, req.params.tid]
    )
    if (!result.rows[0]) return res.status(404).json({ error: 'Команда не найдена' })
    res.json(result.rows[0])
  } catch (e) {
    res.status(500).json({ error: 'Ошибка обновления' })
  }
})

// ── УДАЛИТЬ КОМАНДУ (только admin) ──
router.delete('/:tid/teams/:team_id', auth, async (req, res) => {
  try {
    const user = await db.query('SELECT role FROM users WHERE id=$1', [req.user.id])
    if (user.rows[0]?.role !== 'admin') return res.status(403).json({ error: 'Только для администратора' })
    await db.query('DELETE FROM teams WHERE id=$1 AND tournament_id=$2', [req.params.team_id, req.params.tid])
    res.json({ success: true })
  } catch (e) {
    res.status(500).json({ error: 'Ошибка удаления' })
  }
})

// ── СГЕНЕРИРОВАТЬ СЕТКУ Double Elimination (только admin) ──
router.post('/:tid/generate-bracket', auth, async (req, res) => {
  try {
    const user = await db.query('SELECT role FROM users WHERE id=$1', [req.user.id])
    if (user.rows[0]?.role !== 'admin') return res.status(403).json({ error: 'Только для администратора' })

    const tid = req.params.tid

    // Берём только принятые команды
    const teams = await db.query(
      "SELECT id, name FROM teams WHERE tournament_id=$1 AND status='accepted' ORDER BY id",
      [tid]
    )

    if (teams.rows.length < 2) {
      return res.status(400).json({ error: 'Нужно минимум 2 принятые команды' })
    }

    // Рандомная жеребьёвка — перемешиваем команды
    const shuffled = [...teams.rows].sort(() => Math.random() - 0.5)
    const n = shuffled.length // 8 команд

    // Назначаем seed (номер посева)
    for (let i = 0; i < shuffled.length; i++) {
      await db.query('UPDATE teams SET seed=$1 WHERE id=$2', [i + 1, shuffled[i].id])
    }

    // Удаляем старые матчи этого турнира
    await db.query('DELETE FROM matches WHERE tournament_id=$1', [tid])

    // Генерируем ВЕРХНЮЮ сетку (Upper Bracket)
    // Для 8 команд: Round 1 = 4 матча, QF = 2 матча, SF = 1 матч, Final = 1 матч
    const matches = []

    // Upper Round 1: пары 1-8, 2-7, 3-6, 4-5
    const r1pairs = []
    for (let i = 0; i < n / 2; i++) {
      r1pairs.push({ t1: shuffled[i], t2: shuffled[n - 1 - i] })
    }

    let matchNum = 1
    for (const pair of r1pairs) {
      const m = await db.query(
        `INSERT INTO matches (tournament_id, round, team1_id, team2_id, bracket_type, match_number, status)
         VALUES ($1, 1, $2, $3, 'upper', $4, 'pending') RETURNING id`,
        [tid, pair.t1.id, pair.t2.id, matchNum++]
      )
      matches.push(m.rows[0].id)
    }

    // Upper Round 2 (пустые — заполнятся после R1)
    for (let i = 0; i < n / 4; i++) {
      await db.query(
        `INSERT INTO matches (tournament_id, round, bracket_type, match_number, status)
         VALUES ($1, 2, 'upper', $2, 'pending')`,
        [tid, matchNum++]
      )
    }

    // Upper Final (Semi, Final)
    await db.query(
      `INSERT INTO matches (tournament_id, round, bracket_type, match_number, status)
       VALUES ($1, 3, 'upper', $2, 'pending')`,
      [tid, matchNum++]
    )

    // Lower Bracket: Round 1 (4 проигравших из Upper R1)
    for (let i = 0; i < n / 4; i++) {
      await db.query(
        `INSERT INTO matches (tournament_id, round, bracket_type, match_number, status)
         VALUES ($1, 1, 'lower', $2, 'pending')`,
        [tid, matchNum++]
      )
    }

    // Lower Round 2
    for (let i = 0; i < n / 8; i++) {
      await db.query(
        `INSERT INTO matches (tournament_id, round, bracket_type, match_number, status)
         VALUES ($1, 2, 'lower', $2, 'pending')`,
        [tid, matchNum++]
      )
    }

    // Lower Final
    await db.query(
      `INSERT INTO matches (tournament_id, round, bracket_type, match_number, status)
       VALUES ($1, 3, 'lower', $2, 'pending')`,
      [tid, matchNum++]
    )

    // Grand Final
    await db.query(
      `INSERT INTO matches (tournament_id, round, bracket_type, match_number, status)
       VALUES ($1, 4, 'grand_final', $2, 'pending')`,
      [tid, matchNum++]
    )

    // Обновляем статус турнира
    await db.query(
      'UPDATE tournaments SET bracket_generated=true, status=$1 WHERE id=$2',
      ['live', tid]
    )

    console.log(`✅ Сетка сгенерирована для турнира #${tid} (${shuffled.length} команд)`)
    res.json({ success: true, teams: shuffled.length, message: 'Сетка сгенерирована и турнир запущен' })

  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Ошибка генерации сетки: ' + e.message })
  }
})

// ── ОПУБЛИКОВАТЬ СЕТКУ (сделать видимой участникам) ──
router.post('/:tid/publish-bracket', auth, async (req, res) => {
  try {
    const user = await db.query('SELECT role FROM users WHERE id=$1', [req.user.id])
    if (user.rows[0]?.role !== 'admin') return res.status(403).json({ error: 'Только для администратора' })

    await db.query('UPDATE tournaments SET bracket_published=true WHERE id=$1', [req.params.tid])
    res.json({ success: true })
  } catch (e) {
    res.status(500).json({ error: 'Ошибка публикации' })
  }
})

// ── ПОЛУЧИТЬ СЕТКУ ──
router.get('/:tid/bracket', async (req, res) => {
  try {
    const t = await db.query('SELECT bracket_generated, bracket_published FROM tournaments WHERE id=$1', [req.params.tid])
    if (!t.rows[0]) return res.status(404).json({ error: 'Турнир не найден' })

    const { bracket_generated, bracket_published } = t.rows[0]

    // Проверяем роль — admin видит сетку всегда, остальные только после публикации
    let isAdmin = false
    const authHeader = req.headers.authorization
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const jwt = require('jsonwebtoken')
        const decoded = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET)
        const u = await db.query('SELECT role FROM users WHERE id=$1', [decoded.id])
        isAdmin = u.rows[0]?.role === 'admin'
      } catch(e) {}
    }

    if (!bracket_generated) {
      return res.json({ generated: false, published: false, matches: [], teams: [] })
    }

    if (!bracket_published && !isAdmin) {
      return res.json({ generated: true, published: false, matches: [], teams: [] })
    }

    // Загружаем матчи с командами
    const matches = await db.query(
      `SELECT m.*,
        t1.name as team1_name, t1.seed as team1_seed,
        t2.name as team2_name, t2.seed as team2_seed,
        tw.name as winner_name
       FROM matches m
       LEFT JOIN teams t1 ON m.team1_id = t1.id
       LEFT JOIN teams t2 ON m.team2_id = t2.id
       LEFT JOIN teams tw ON m.winner_team_id = tw.id
       WHERE m.tournament_id = $1
       ORDER BY m.bracket_type, m.round, m.match_number`,
      [req.params.tid]
    )

    const teams = await db.query(
      `SELECT t.*, json_agg(json_build_object(
        'nickname', tp.nickname, 'full_name', tp.full_name, 'is_captain', tp.is_captain
      ) ORDER BY tp.is_captain DESC) as players
       FROM teams t
       LEFT JOIN team_players tp ON tp.team_id = t.id
       WHERE t.tournament_id = $1
       GROUP BY t.id ORDER BY t.seed`,
      [req.params.tid]
    )

    res.json({
      generated: bracket_generated,
      published: bracket_published,
      matches: matches.rows,
      teams: teams.rows
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Ошибка загрузки сетки' })
  }
})

// ── ЗАПИСАТЬ РЕЗУЛЬТАТ МАТЧА (только admin) ──
router.put('/:tid/matches/:mid', auth, async (req, res) => {
  try {
    const user = await db.query('SELECT role FROM users WHERE id=$1', [req.user.id])
    if (user.rows[0]?.role !== 'admin') return res.status(403).json({ error: 'Только для администратора' })

    const { score1, score2, winner_team_id } = req.body
    if (!winner_team_id) return res.status(400).json({ error: 'Укажите победителя' })

    const result = await db.query(
      `UPDATE matches SET score1=$1, score2=$2, winner_team_id=$3, status='done', played_at=NOW()
       WHERE id=$4 AND tournament_id=$5 RETURNING *`,
      [score1 || 0, score2 || 0, winner_team_id, req.params.mid, req.params.tid]
    )

    if (!result.rows[0]) return res.status(404).json({ error: 'Матч не найден' })

    // Определяем проигравшую команду
    const match = result.rows[0]
    const loser_id = match.winner_team_id === match.team1_id ? match.team2_id : match.team1_id

    // Обновляем рейтинг игроков команды-победителя (+25) и проигравшей (-25, мин. 0)
    try {
      // Игроки победившей команды
      const winPlayers = await db.query(
        'SELECT tp.* FROM team_players tp WHERE tp.team_id=$1',
        [winner_team_id]
      )
      for (const p of winPlayers.rows) {
        // Ищем пользователя по никнейму
        await db.query(
          'UPDATE users SET rating=rating+25, wins=wins+1 WHERE LOWER(username)=LOWER($1) OR LOWER(faceit_nick)=LOWER($1)',
          [p.nickname]
        )
      }
      // Игроки проигравшей команды
      if (loser_id) {
        const losePlayers = await db.query(
          'SELECT tp.* FROM team_players tp WHERE tp.team_id=$1',
          [loser_id]
        )
        for (const p of losePlayers.rows) {
          await db.query(
            'UPDATE users SET rating=GREATEST(0, rating-25), losses=losses+1 WHERE LOWER(username)=LOWER($1) OR LOWER(faceit_nick)=LOWER($1)',
            [p.nickname]
          )
        }
      }
    } catch(ratingErr) {
      console.log('Rating update skipped:', ratingErr.message)
    }

    // Если это Upper bracket — проигравший идёт в Lower
    if (match.bracket_type === 'upper') {
      // Найдём ближайший пустой матч в Lower bracket того же раунда
      const lowerMatch = await db.query(
        `SELECT id FROM matches WHERE tournament_id=$1 AND bracket_type='lower'
         AND round=$2 AND team1_id IS NULL
         ORDER BY match_number LIMIT 1`,
        [req.params.tid, match.round]
      )
      if (lowerMatch.rows[0]) {
        await db.query(
          `UPDATE matches SET team1_id = CASE WHEN team1_id IS NULL THEN $1 ELSE team1_id END,
                             team2_id = CASE WHEN team1_id IS NOT NULL AND team2_id IS NULL THEN $1 ELSE team2_id END
           WHERE id=$2`,
          [loser_id, lowerMatch.rows[0].id]
        )
      }
    }

    // Победитель идёт в следующий матч Upper/Lower
    const nextMatch = await db.query(
      `SELECT id FROM matches WHERE tournament_id=$1 AND bracket_type=$2
       AND round=$3 AND team1_id IS NULL
       ORDER BY match_number LIMIT 1`,
      [req.params.tid, match.bracket_type === 'grand_final' ? 'grand_final' : match.bracket_type,
       match.bracket_type === 'grand_final' ? match.round : match.round + 1]
    )
    if (nextMatch.rows[0]) {
      await db.query(
        `UPDATE matches SET
          team1_id = CASE WHEN team1_id IS NULL THEN $1 ELSE team1_id END,
          team2_id = CASE WHEN team1_id IS NOT NULL AND team2_id IS NULL THEN $1 ELSE team2_id END
         WHERE id=$2`,
        [winner_team_id, nextMatch.rows[0].id]
      )
    }

    res.json({ success: true, match: result.rows[0] })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Ошибка сохранения результата' })
  }
})

module.exports = router
