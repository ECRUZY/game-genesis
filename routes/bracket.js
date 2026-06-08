const express = require('express')
const router = express.Router()
const db = require('../db')
const auth = require('../middleware/auth')

// ─────────────────────────────────────────────
// УТИЛИТЫ
// ─────────────────────────────────────────────

// Следующая степень двойки >= n
function nextPow2(n) {
  let p = 1
  while (p < n) p <<= 1
  return p
}

// Перемешать массив
function shuffle(arr) {
  return [...arr].sort(() => Math.random() - 0.5)
}

// Вставить матч
async function insertMatch(tid, round, bracketType, matchNum, t1 = null, t2 = null) {
  const r = await db.query(
    `INSERT INTO matches (tournament_id, round, bracket_type, match_number, team1_id, team2_id, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending') RETURNING id`,
    [tid, round, bracketType, matchNum, t1, t2]
  )
  return r.rows[0].id
}

// Заполнить слот следующего матча победителем/проигравшим
async function fillSlot(matchId, teamId) {
  await db.query(
    `UPDATE matches SET
      team1_id = CASE WHEN team1_id IS NULL THEN $1 ELSE team1_id END,
      team2_id = CASE WHEN team1_id IS NOT NULL AND team2_id IS NULL THEN $1 ELSE team2_id END
     WHERE id = $2`,
    [teamId, matchId]
  )
}

// ─────────────────────────────────────────────
// ГЕНЕРАЦИЯ СЕТКИ
// ─────────────────────────────────────────────
router.post('/:tid/generate-bracket', auth, async (req, res) => {
  try {
    const userRes = await db.query('SELECT role FROM users WHERE id=$1', [req.user.id])
    const role = userRes.rows[0]?.role
    if (role !== 'admin' && role !== 'organizer') {
      return res.status(403).json({ error: 'Нет прав' })
    }

    const tid = req.params.tid
    const tRes = await db.query('SELECT * FROM tournaments WHERE id=$1', [tid])
    const t = tRes.rows[0]
    if (!t) return res.status(404).json({ error: 'Турнир не найден' })

    const format = (t.format || 'single_elimination').toLowerCase()

    const teamsRes = await db.query(
      "SELECT id, name FROM teams WHERE tournament_id=$1 AND status='accepted' ORDER BY id",
      [tid]
    )
    const teams = teamsRes.rows
    if (teams.length < 2) return res.status(400).json({ error: 'Нужно минимум 2 принятые команды' })

    const seeded = shuffle(teams)
    for (let i = 0; i < seeded.length; i++) {
      await db.query('UPDATE teams SET seed=$1 WHERE id=$2', [i + 1, seeded[i].id])
    }

    await db.query('DELETE FROM matches WHERE tournament_id=$1', [tid])

    let message = ''

    if (format === 'single_elimination' || format === 'se') {
      message = await generateSingleElimination(tid, seeded)
    } else if (format === 'double_elimination' || format === 'de') {
      message = await generateDoubleElimination(tid, seeded)
    } else if (format === 'round_robin' || format === 'rr') {
      message = await generateRoundRobin(tid, seeded)
    } else {
      // По умолчанию — SE
      message = await generateSingleElimination(tid, seeded)
    }

    await db.query(
      "UPDATE tournaments SET bracket_generated=true, status='live' WHERE id=$1",
      [tid]
    )

    res.json({ success: true, teams: seeded.length, format, message })
  } catch (e) {
    console.error('❌ bracket generate:', e)
    res.status(500).json({ error: 'Ошибка генерации сетки: ' + e.message })
  }
})

// ─────────────────────────────────────────────
// SINGLE ELIMINATION
// Проигравшие в полуфинале играют за 3-е место
// ─────────────────────────────────────────────
async function generateSingleElimination(tid, teams) {
  const n = teams.length
  const size = nextPow2(n) // размер сетки (ближайшая степень 2)
  let mn = 1

  // Заполняем сетку — bye если команд меньше чем size
  // Раунд 1: size/2 матчей
  const round1Ids = []
  const byes = [] // команды получившие bye (проходят автоматически)

  for (let i = 0; i < size / 2; i++) {
    const t1 = teams[i] || null
    const t2 = teams[size - 1 - i] || null

    if (t1 && !t2) {
      // Bye — команда проходит автоматически
      byes.push(t1.id)
      const id = await insertMatch(tid, 1, 'upper', mn++, t1.id, null)
      round1Ids.push({ id, bye: true, winner: t1.id })
    } else {
      const id = await insertMatch(tid, 1, 'upper', mn++, t1 ? t1.id : null, t2 ? t2.id : null)
      round1Ids.push({ id, bye: false, winner: null })
    }
  }

  // Генерируем оставшиеся раунды до финала
  let currentRound = round1Ids
  let roundNum = 2
  const allRounds = [round1Ids]

  while (currentRound.length > 1) {
    const nextRound = []
    for (let i = 0; i < currentRound.length; i += 2) {
      const id = await insertMatch(tid, roundNum, 'upper', mn++)
      nextRound.push({ id, bye: false, winner: null })
    }
    allRounds.push(nextRound)
    currentRound = nextRound
    roundNum++
  }

  // Полуфинал — предпоследний раунд (если >=4 команд)
  // Матч за 3-е место между проигравшими в полуфинале
  if (size >= 4) {
    const semifinalRound = allRounds[allRounds.length - 2]
    if (semifinalRound && semifinalRound.length === 2) {
      // Матч за 3-е место
      await db.query(
        `INSERT INTO matches (tournament_id, round, bracket_type, match_number, status)
         VALUES ($1, $2, 'third_place', $3, 'pending')`,
        [tid, roundNum - 1, mn++]
      )
    }
  }

  return `Single Elimination: ${n} команд, ${size} слотов`
}

// ─────────────────────────────────────────────
// DOUBLE ELIMINATION
// Верхняя и нижняя сетка + Grand Final
// Проигравшие в UB SF → матч за 3-е место (нижняя сетка)
// ─────────────────────────────────────────────
async function generateDoubleElimination(tid, teams) {
  const n = teams.length
  const size = nextPow2(n)
  let mn = 1

  // ── UPPER BRACKET ──
  // Round 1
  const ubR1 = []
  for (let i = 0; i < size / 2; i++) {
    const t1 = teams[i] || null
    const t2 = teams[size - 1 - i] || null
    const id = await insertMatch(tid, 1, 'upper', mn++, t1?.id || null, t2?.id || null)
    ubR1.push(id)
  }

  // Остальные раунды UB вплоть до финала UB
  let ubCurrent = ubR1
  let ubRound = 2
  const ubRounds = [ubR1]
  while (ubCurrent.length > 1) {
    const next = []
    for (let i = 0; i < ubCurrent.length; i += 2) {
      const id = await insertMatch(tid, ubRound, 'upper', mn++)
      next.push(id)
    }
    ubRounds.push(next)
    ubCurrent = next
    ubRound++
  }
  // ubRounds последний элемент = финал UB (1 матч)

  // ── LOWER BRACKET ──
  // LB Round 1: проигравшие из UB Round 1 (size/2 команд → size/4 матчей)
  let lbRound = 1
  const lbR1 = []
  for (let i = 0; i < size / 4; i++) {
    const id = await insertMatch(tid, lbRound, 'lower', mn++)
    lbR1.push(id)
  }

  let lbCurrent = lbR1
  lbRound++

  // LB продолжается пока не останется 1 матч
  // После каждого UB раунда (начиная со 2) — проигравшие падают в LB
  // LB раунды чередуются: elimination round (с падением из UB) и consolidation round
  let ubDropRound = 2
  while (lbCurrent.length > 1) {
    // Elimination round (с упавшими из UB)
    const elimRound = []
    for (let i = 0; i < lbCurrent.length; i++) {
      const id = await insertMatch(tid, lbRound, 'lower', mn++)
      elimRound.push(id)
    }
    lbRound++
    ubDropRound++

    // Consolidation round
    if (elimRound.length > 1) {
      const consolRound = []
      for (let i = 0; i < elimRound.length; i += 2) {
        const id = await insertMatch(tid, lbRound, 'lower', mn++)
        consolRound.push(id)
      }
      lbRound++
      lbCurrent = consolRound
    } else {
      lbCurrent = elimRound
    }
  }
  // lbCurrent[0] = финал LB

  // ── GRAND FINAL ──
  await insertMatch(tid, 1, 'grand_final', mn++)

  // ── МАТЧ ЗА 3-Е МЕСТО ──
  // Проигравшие в полуфиналах UB
  // UB SF = предпоследний раунд UB (если rounds >= 2)
  if (ubRounds.length >= 2) {
    await db.query(
      `INSERT INTO matches (tournament_id, round, bracket_type, match_number, status)
       VALUES ($1, 1, 'third_place', $2, 'pending')`,
      [tid, mn++]
    )
  }

  return `Double Elimination: ${n} команд, ${size} слотов`
}

// ─────────────────────────────────────────────
// ROUND ROBIN
// Каждый против каждого
// ─────────────────────────────────────────────
async function generateRoundRobin(tid, teams) {
  const n = teams.length
  let mn = 1

  // Алгоритм круговой сетки (round-robin scheduling)
  // Если нечётное число — добавляем "bye"
  const list = n % 2 === 0 ? [...teams] : [...teams, null]
  const total = list.length

  for (let round = 0; round < total - 1; round++) {
    for (let i = 0; i < total / 2; i++) {
      const t1 = list[i]
      const t2 = list[total - 1 - i]
      if (t1 && t2) {
        await insertMatch(tid, round + 1, 'robin', mn++, t1.id, t2.id)
      }
    }
    // Rotate: фиксируем первый элемент, остальные двигаем по кругу
    const last = list.splice(total - 1, 1)[0]
    list.splice(1, 0, last)
  }

  return `Round Robin: ${n} команд, ${(n * (n - 1)) / 2} матчей`
}

// ─────────────────────────────────────────────
// ОПУБЛИКОВАТЬ СЕТКУ
// ─────────────────────────────────────────────
router.post('/:tid/publish-bracket', auth, async (req, res) => {
  try {
    const userRes = await db.query('SELECT role FROM users WHERE id=$1', [req.user.id])
    const role = userRes.rows[0]?.role
    if (role !== 'admin' && role !== 'organizer') return res.status(403).json({ error: 'Нет прав' })
    await db.query('UPDATE tournaments SET bracket_published=true WHERE id=$1', [req.params.tid])
    res.json({ success: true })
  } catch (e) {
    res.status(500).json({ error: 'Ошибка публикации' })
  }
})

// ─────────────────────────────────────────────
// ПОЛУЧИТЬ СЕТКУ
// ─────────────────────────────────────────────
router.get('/:tid/bracket', async (req, res) => {
  try {
    const tRes = await db.query('SELECT bracket_generated, bracket_published, format FROM tournaments WHERE id=$1', [req.params.tid])
    if (!tRes.rows[0]) return res.status(404).json({ error: 'Турнир не найден' })
    const { bracket_generated, bracket_published, format } = tRes.rows[0]

    let isAdmin = false
    const authHeader = req.headers.authorization
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const jwt = require('jsonwebtoken')
        const decoded = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET)
        const u = await db.query('SELECT role FROM users WHERE id=$1', [decoded.id])
        isAdmin = ['admin', 'organizer'].includes(u.rows[0]?.role)
      } catch(e) {}
    }

    if (!bracket_generated) return res.json({ generated: false, published: false, matches: [], teams: [] })
    if (!bracket_published && !isAdmin) return res.json({ generated: true, published: false, matches: [], teams: [] })

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
       ORDER BY
         CASE m.bracket_type
           WHEN 'upper'       THEN 1
           WHEN 'lower'       THEN 2
           WHEN 'robin'       THEN 3
           WHEN 'third_place' THEN 4
           WHEN 'grand_final' THEN 5
           ELSE 6 END,
         m.round, m.match_number`,
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

    res.json({ generated: true, published: bracket_published, format, matches: matches.rows, teams: teams.rows })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Ошибка загрузки сетки' })
  }
})

// ─────────────────────────────────────────────
// РЕЗУЛЬТАТ МАТЧА
// ─────────────────────────────────────────────
router.put('/:tid/matches/:mid', auth, async (req, res) => {
  try {
    const userRes = await db.query('SELECT role FROM users WHERE id=$1', [req.user.id])
    const role = userRes.rows[0]?.role
    if (role !== 'admin' && role !== 'organizer') return res.status(403).json({ error: 'Нет прав' })

    const { score1, score2, winner_team_id } = req.body
    if (!winner_team_id) return res.status(400).json({ error: 'Укажите победителя' })

    const result = await db.query(
      `UPDATE matches SET score1=$1, score2=$2, winner_team_id=$3, status='done', played_at=NOW()
       WHERE id=$4 AND tournament_id=$5 RETURNING *`,
      [score1 || 0, score2 || 0, winner_team_id, req.params.mid, req.params.tid]
    )
    if (!result.rows[0]) return res.status(404).json({ error: 'Матч не найден' })

    const match = result.rows[0]
    const loser_id = winner_team_id == match.team1_id ? match.team2_id : match.team1_id

    // ── РЕЙТИНГ ──
    try {
      const winPlayers = await db.query('SELECT nickname FROM team_players WHERE team_id=$1', [winner_team_id])
      for (const p of winPlayers.rows) {
        await db.query(
          `INSERT INTO player_ratings (user_id, game, rating, wins, losses)
           SELECT u.id, t.game, 1025, 1, 0 FROM users u, tournaments t
           WHERE (LOWER(u.username)=LOWER($1) OR LOWER(u.faceit_nick)=LOWER($1)) AND t.id=$2
           ON CONFLICT (user_id, game) DO UPDATE SET
             rating = player_ratings.rating + 25,
             wins   = player_ratings.wins + 1`,
          [p.nickname, req.params.tid]
        )
        await db.query(
          `UPDATE users SET rating=rating+25, wins=wins+1
           WHERE LOWER(username)=LOWER($1) OR LOWER(faceit_nick)=LOWER($1)`,
          [p.nickname]
        )
      }
      if (loser_id) {
        const losePlayers = await db.query('SELECT nickname FROM team_players WHERE team_id=$1', [loser_id])
        for (const p of losePlayers.rows) {
          await db.query(
            `INSERT INTO player_ratings (user_id, game, rating, wins, losses)
             SELECT u.id, t.game, 975, 0, 1 FROM users u, tournaments t
             WHERE (LOWER(u.username)=LOWER($1) OR LOWER(u.faceit_nick)=LOWER($1)) AND t.id=$2
             ON CONFLICT (user_id, game) DO UPDATE SET
               rating = GREATEST(0, player_ratings.rating - 25),
               losses = player_ratings.losses + 1`,
            [p.nickname, req.params.tid]
          )
          await db.query(
            `UPDATE users SET rating=GREATEST(0,rating-25), losses=losses+1
             WHERE LOWER(username)=LOWER($1) OR LOWER(faceit_nick)=LOWER($1)`,
            [p.nickname]
          )
        }
      }
    } catch(ratingErr) { console.log('Rating skip:', ratingErr.message) }

    // ── ПЕРЕХОД В СЛЕДУЮЩИЙ МАТЧ ──
    const bt = match.bracket_type

    if (bt === 'upper') {
      // Победитель → следующий раунд Upper
      const nextUpper = await db.query(
        `SELECT id FROM matches WHERE tournament_id=$1 AND bracket_type='upper'
         AND round=$2 AND (team1_id IS NULL OR team2_id IS NULL)
         ORDER BY match_number LIMIT 1`,
        [req.params.tid, match.round + 1]
      )
      if (nextUpper.rows[0]) await fillSlot(nextUpper.rows[0].id, winner_team_id)

      // Проигравший → Lower bracket того же раунда
      if (loser_id) {
        const nextLower = await db.query(
          `SELECT id FROM matches WHERE tournament_id=$1 AND bracket_type='lower'
           AND round=$2 AND (team1_id IS NULL OR team2_id IS NULL)
           ORDER BY match_number LIMIT 1`,
          [req.params.tid, match.round]
        )
        if (nextLower.rows[0]) await fillSlot(nextLower.rows[0].id, loser_id)
      }

      // Проигравший в полуфинале UB → матч за 3-е место
      // Проверяем: это предпоследний раунд UB?
      const maxUBRound = await db.query(
        `SELECT MAX(round) as mr FROM matches WHERE tournament_id=$1 AND bracket_type='upper'`,
        [req.params.tid]
      )
      const isUBSemifinal = match.round === (maxUBRound.rows[0].mr - 1)
      if (isUBSemifinal && loser_id) {
        const thirdPlace = await db.query(
          `SELECT id FROM matches WHERE tournament_id=$1 AND bracket_type='third_place'
           AND (team1_id IS NULL OR team2_id IS NULL) ORDER BY id LIMIT 1`,
          [req.params.tid]
        )
        if (thirdPlace.rows[0]) await fillSlot(thirdPlace.rows[0].id, loser_id)
      }

    } else if (bt === 'lower') {
      // Победитель → следующий раунд Lower или Grand Final
      const nextLower = await db.query(
        `SELECT id FROM matches WHERE tournament_id=$1 AND bracket_type='lower'
         AND round=$2 AND (team1_id IS NULL OR team2_id IS NULL)
         ORDER BY match_number LIMIT 1`,
        [req.params.tid, match.round + 1]
      )
      if (nextLower.rows[0]) {
        await fillSlot(nextLower.rows[0].id, winner_team_id)
      } else {
        // Нет следующего Lower раунда → идёт в Grand Final
        const gf = await db.query(
          `SELECT id FROM matches WHERE tournament_id=$1 AND bracket_type='grand_final'
           AND (team1_id IS NULL OR team2_id IS NULL) ORDER BY id LIMIT 1`,
          [req.params.tid]
        )
        if (gf.rows[0]) await fillSlot(gf.rows[0].id, winner_team_id)
      }
      // Проигравший выбывает

    } else if (bt === 'grand_final') {
      // Финал — обновляем статус турнира
      await db.query("UPDATE tournaments SET status='done' WHERE id=$1", [req.params.tid])

    } else if (bt === 'third_place') {
      // Матч за 3-е место — ничего дополнительного

    } else if (bt === 'robin') {
      // Round Robin — ничего, победитель определяется по очкам в конце
      // Проверяем закончились ли все матчи
      const pending = await db.query(
        `SELECT COUNT(*) FROM matches WHERE tournament_id=$1 AND bracket_type='robin' AND status!='done'`,
        [req.params.tid]
      )
      if (parseInt(pending.rows[0].count) === 0) {
        await db.query("UPDATE tournaments SET status='done' WHERE id=$1", [req.params.tid])
      }
    }

    res.json({ success: true, match: result.rows[0] })
  } catch (e) {
    console.error('❌ match result:', e)
    res.status(500).json({ error: 'Ошибка сохранения результата: ' + e.message })
  }
})

module.exports = router
