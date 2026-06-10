const express = require('express')
const router = express.Router()
const db = require('../db')
const auth = require('../middleware/auth')

// ─────────────────────────────────────────────
// УТИЛИТЫ
// ─────────────────────────────────────────────
function nextPow2(n) { let p = 1; while (p < n) p <<= 1; return p }
function shuffle(arr) { return [...arr].sort(() => Math.random() - 0.5) }

async function insertMatch(tid, round, bracketType, matchNum, t1 = null, t2 = null) {
  const r = await db.query(
    `INSERT INTO matches (tournament_id, round, bracket_type, match_number, team1_id, team2_id, status)
     VALUES ($1,$2,$3,$4,$5,$6,'pending') RETURNING id`,
    [tid, round, bracketType, matchNum, t1, t2]
  )
  return r.rows[0].id
}

async function fillSlot(matchId, teamId) {
  if (!matchId || !teamId) return
  const cur = await db.query('SELECT team1_id, team2_id FROM matches WHERE id=$1', [matchId])
  if (!cur.rows[0]) return
  const { team1_id, team2_id } = cur.rows[0]
  if (!team1_id) {
    await db.query('UPDATE matches SET team1_id=$1 WHERE id=$2', [teamId, matchId])
  } else if (!team2_id) {
    await db.query('UPDATE matches SET team2_id=$1 WHERE id=$2', [teamId, matchId])
  }
}

// ─────────────────────────────────────────────
// ГЕНЕРАЦИЯ СЕТКИ
// ─────────────────────────────────────────────
router.post('/:tid/generate-bracket', auth, async (req, res) => {
  try {
    const userRes = await db.query('SELECT role FROM users WHERE id=$1', [req.user.id])
    const role = userRes.rows[0]?.role
    if (role !== 'admin' && role !== 'organizer') return res.status(403).json({ error: 'Нет прав' })

    const tid = req.params.tid
    const tRes = await db.query('SELECT * FROM tournaments WHERE id=$1', [tid])
    const t = tRes.rows[0]
    if (!t) return res.status(404).json({ error: 'Турнир не найден' })

    const teamsRes = await db.query(
      "SELECT id,name FROM teams WHERE tournament_id=$1 AND status='accepted' ORDER BY id", [tid]
    )
    const teams = teamsRes.rows
    if (teams.length < 2) return res.status(400).json({ error: 'Нужно минимум 2 принятые команды' })

    const seeded = shuffle(teams)
    for (let i = 0; i < seeded.length; i++) {
      await db.query('UPDATE teams SET seed=$1 WHERE id=$2', [i+1, seeded[i].id])
    }

    await db.query('DELETE FROM matches WHERE tournament_id=$1', [tid])

    const fmt = (t.format || 'se').toLowerCase()
    let msg = ''

    if (fmt === 'de' || fmt === 'double_elimination') {
      msg = await generateDE(tid, seeded)
    } else if (fmt === 'rr' || fmt === 'round_robin') {
      msg = await generateRR(tid, seeded)
    } else {
      msg = await generateSE(tid, seeded) // se — по умолчанию
    }

    await db.query("UPDATE tournaments SET bracket_generated=true, status='live' WHERE id=$1", [tid])
    res.json({ success: true, teams: seeded.length, format: fmt, message: msg })
  } catch(e) {
    console.error('❌ generate-bracket:', e)
    res.status(500).json({ error: 'Ошибка генерации сетки: ' + e.message })
  }
})

// ─────────────────────────────────────────────
// SINGLE ELIMINATION + матч за 3-е место
// ─────────────────────────────────────────────
async function generateSE(tid, teams) {
  const n = teams.length
  const size = nextPow2(n)
  let mn = 1

  // Расставляем пары: 1 vs last, 2 vs (last-1)...
  const slots = new Array(size).fill(null)
  for (let i = 0; i < n; i++) slots[i] = teams[i]

  // Раунд 1: size/2 матчей
  const r1 = []
  for (let i = 0; i < size / 2; i++) {
    const t1 = slots[i]
    const t2 = slots[size - 1 - i]
    const id = await insertMatch(tid, 1, 'upper', mn++, t1?.id || null, t2?.id || null)
    r1.push(id)
  }

  // Последующие раунды
  let cur = r1
  let rnd = 2
  while (cur.length > 1) {
    const next = []
    for (let i = 0; i < cur.length; i += 2) {
      const id = await insertMatch(tid, rnd, 'upper', mn++)
      next.push(id)
    }
    cur = next
    rnd++
  }

  // Матч за 3-е место (если >=4 команд — есть полуфинал)
  if (size >= 4) {
    await insertMatch(tid, rnd - 1, 'third_place', mn++)
  }

  return `Single Elimination: ${n} команд`
}

// ─────────────────────────────────────────────
// DOUBLE ELIMINATION
// UB + LB + Grand Final + 3-е место (UB SF проигравшие)
// ─────────────────────────────────────────────
async function generateDE(tid, teams) {
  const n = teams.length
  const size = nextPow2(n)
  let mn = 1

  // ── UPPER BRACKET ──
  const slots = new Array(size).fill(null)
  for (let i = 0; i < n; i++) slots[i] = teams[i]

  // UB R1
  const ubR1 = []
  for (let i = 0; i < size / 2; i++) {
    const id = await insertMatch(tid, 1, 'upper', mn++, slots[i]?.id || null, slots[size-1-i]?.id || null)
    ubR1.push(id)
  }

  // UB R2..Final
  let ubCur = ubR1, ubRnd = 2
  const ubRounds = [ubR1]
  while (ubCur.length > 1) {
    const next = []
    for (let i = 0; i < ubCur.length; i += 2) {
      next.push(await insertMatch(tid, ubRnd, 'upper', mn++))
    }
    ubRounds.push(next)
    ubCur = next
    ubRnd++
  }
  // ubRounds.at(-1)[0] = UB Final

  // ── LOWER BRACKET ──
  // LB R1: принимает size/2 проигравших из UB R1 → size/4 матчей
  let lbRnd = 1
  let lbCur = []
  const lbMatchCount1 = size / 4
  for (let i = 0; i < lbMatchCount1; i++) {
    lbCur.push(await insertMatch(tid, lbRnd, 'lower', mn++))
  }
  lbRnd++

  // Дальнейшие раунды LB
  // Для каждого раунда UB (начиная со 2) проигравшие попадают в LB
  // Чередуем: elimination (matching UB drops) → consolidation (LB vs LB)
  for (let ubDropIdx = 1; ubDropIdx < ubRounds.length - 1; ubDropIdx++) {
    const dropCount = ubRounds[ubDropIdx].length // кол-во UB матчей = кол-во проигравших

    // Elimination раунд: LB survivors vs UB drops
    const elimNext = []
    for (let i = 0; i < lbCur.length; i++) {
      elimNext.push(await insertMatch(tid, lbRnd, 'lower', mn++))
    }
    lbRnd++
    lbCur = elimNext

    // Consolidation раунд (если осталось >1)
    if (lbCur.length > 1) {
      const consNext = []
      for (let i = 0; i < lbCur.length; i += 2) {
        consNext.push(await insertMatch(tid, lbRnd, 'lower', mn++))
      }
      lbRnd++
      lbCur = consNext
    }
  }

  // LB Final (LB winner vs UB Final loser)
  await insertMatch(tid, lbRnd, 'lower', mn++)

  // ── GRAND FINAL ──
  await insertMatch(tid, 1, 'grand_final', mn++)

  // ── МАТЧ ЗА 3-Е МЕСТО (UB SF проигравшие) ──
  if (ubRounds.length >= 3) { // есть UB SF (предпоследний раунд)
    await insertMatch(tid, 1, 'third_place', mn++)
  }

  return `Double Elimination: ${n} команд`
}

// ─────────────────────────────────────────────
// ROUND ROBIN
// ─────────────────────────────────────────────
async function generateRR(tid, teams) {
  const n = teams.length
  let mn = 1
  const list = n % 2 === 0 ? [...teams] : [...teams, null]
  const total = list.length

  for (let round = 0; round < total - 1; round++) {
    for (let i = 0; i < total / 2; i++) {
      const t1 = list[i], t2 = list[total-1-i]
      if (t1 && t2) await insertMatch(tid, round+1, 'robin', mn++, t1.id, t2.id)
    }
    const last = list.splice(total-1, 1)[0]
    list.splice(1, 0, last)
  }

  return `Round Robin: ${n} команд, ${n*(n-1)/2} матчей`
}

// ─────────────────────────────────────────────
// РЕЗУЛЬТАТ МАТЧА
// ─────────────────────────────────────────────
router.put('/:tid/matches/:mid', auth, async (req, res) => {
  try {
    const userRes = await db.query('SELECT role FROM users WHERE id=$1', [req.user.id])
    if (!['admin','organizer'].includes(userRes.rows[0]?.role)) return res.status(403).json({ error: 'Нет прав' })

    const { score1, score2, winner_team_id } = req.body
    if (!winner_team_id) return res.status(400).json({ error: 'Укажите победителя' })

    const result = await db.query(
      `UPDATE matches SET score1=$1,score2=$2,winner_team_id=$3,status='done',played_at=NOW()
       WHERE id=$4 AND tournament_id=$5 RETURNING *`,
      [score1||0, score2||0, winner_team_id, req.params.mid, req.params.tid]
    )
    if (!result.rows[0]) return res.status(404).json({ error: 'Матч не найден' })

    const match = result.rows[0]
    const loser_id = Number(winner_team_id) === match.team1_id ? match.team2_id : match.team1_id
    const tid = req.params.tid
    const bt = match.bracket_type

    // ── РЕЙТИНГ ──
    try {
      for (const [teamId, delta] of [[winner_team_id, 25], [loser_id, -25]]) {
        if (!teamId) continue
        const players = await db.query('SELECT nickname FROM team_players WHERE team_id=$1', [teamId])
        for (const p of players.rows) {
          await db.query(
            `UPDATE users SET rating=GREATEST(0,rating+$1),
              wins=wins+${delta>0?1:0}, losses=losses+${delta<0?1:0}
             WHERE LOWER(username)=LOWER($2) OR LOWER(faceit_nick)=LOWER($2)`,
            [delta, p.nickname]
          )
        }
      }
    } catch(e) { console.log('rating skip:', e.message) }

    // ── ПЕРЕХОДЫ ──
    await applyTransitions(tid, match, winner_team_id, loser_id)

    res.json({ success: true, match: result.rows[0] })
  } catch(e) {
    console.error('❌ match result:', e)
    res.status(500).json({ error: 'Ошибка: ' + e.message })
  }
})

async function applyTransitions(tid, match, winner_id, loser_id) {
  const bt = match.bracket_type

  if (bt === 'upper') {
    // Получаем финальный раунд UB
    const maxR = await db.query(
      `SELECT MAX(round) as mr FROM matches WHERE tournament_id=$1 AND bracket_type='upper'`, [tid]
    )
    const maxUBRound = maxR.rows[0].mr
    const isFinal = match.round === maxUBRound
    const isSF = match.round === maxUBRound - 1

    if (isFinal) {
      // UB Final: победитель → Grand Final, проигравший → LB Final
      const gf = await findFreeMatch(tid, 'grand_final', null)
      if (gf) await fillSlot(gf, winner_id)
      const lbFinal = await findFreeMatch(tid, 'lower', null) // последний раунд LB
      if (lbFinal) await fillSlot(lbFinal, loser_id)
    } else {
      // Обычный UB матч: победитель → следующий UB раунд
      const nextUB = await findFreeMatch(tid, 'upper', match.round + 1)
      if (nextUB) await fillSlot(nextUB, winner_id)

      // Проигравший → LB того же раунда (первый свободный)
      if (loser_id) {
        const lbMatch = await findFreeMatch(tid, 'lower', match.round)
        if (lbMatch) await fillSlot(lbMatch, loser_id)
      }

      // Проигравший в SF (предпоследний UB раунд) → матч за 3-е место
      if (isSF && loser_id) {
        const tp = await findFreeMatch(tid, 'third_place', null)
        if (tp) await fillSlot(tp, loser_id)
      }
    }

  } else if (bt === 'lower') {
    const maxLB = await db.query(
      `SELECT MAX(round) as mr FROM matches WHERE tournament_id=$1 AND bracket_type='lower'`, [tid]
    )
    const isLBFinal = match.round === maxLB.rows[0].mr

    if (isLBFinal) {
      // LB Final победитель → Grand Final
      const gf = await findFreeMatch(tid, 'grand_final', null)
      if (gf) await fillSlot(gf, winner_id)
    } else {
      // LB победитель → следующий LB раунд
      const nextLB = await findFreeMatch(tid, 'lower', match.round + 1)
      if (nextLB) await fillSlot(nextLB, winner_id)
    }
    // LB проигравший выбывает

  } else if (bt === 'grand_final') {
    await db.query("UPDATE tournaments SET status='done' WHERE id=$1", [tid])

  } else if (bt === 'robin') {
    const pending = await db.query(
      `SELECT COUNT(*) FROM matches WHERE tournament_id=$1 AND bracket_type='robin' AND status!='done'`, [tid]
    )
    if (parseInt(pending.rows[0].count) === 0) {
      await db.query("UPDATE tournaments SET status='done' WHERE id=$1", [tid])
    }
  }
  // third_place — ничего дополнительного
}

// Найти первый свободный матч нужного типа/раунда
async function findFreeMatch(tid, bracketType, round) {
  let q, params
  if (round !== null) {
    q = `SELECT id FROM matches WHERE tournament_id=$1 AND bracket_type=$2
         AND round=$3 AND (team1_id IS NULL OR team2_id IS NULL)
         ORDER BY match_number LIMIT 1`
    params = [tid, bracketType, round]
  } else {
    // Для grand_final и last LB — просто первый свободный
    q = `SELECT id FROM matches WHERE tournament_id=$1 AND bracket_type=$2
         AND (team1_id IS NULL OR team2_id IS NULL)
         ORDER BY round DESC, match_number LIMIT 1`
    params = [tid, bracketType]
  }
  const r = await db.query(q, params)
  return r.rows[0]?.id || null
}

// ─────────────────────────────────────────────
// ПЕРЕСЧИТАТЬ ПЕРЕХОДЫ
// ─────────────────────────────────────────────
router.post('/:tid/recalculate', auth, async (req, res) => {
  try {
    const userRes = await db.query('SELECT role FROM users WHERE id=$1', [req.user.id])
    if (!['admin','organizer'].includes(userRes.rows[0]?.role)) return res.status(403).json({ error: 'Нет прав' })

    const tid = req.params.tid

    // Сбрасываем все НЕзавершённые матчи кроме R1 upper
    await db.query(
      `UPDATE matches SET team1_id=NULL, team2_id=NULL
       WHERE tournament_id=$1 AND status='pending'
       AND NOT (bracket_type='upper' AND round=1)`,
      [tid]
    )

    // Все завершённые матчи по порядку (UB R1 → R2 → ... → LB → GF)
    const done = await db.query(
      `SELECT * FROM matches WHERE tournament_id=$1 AND status='done'
       ORDER BY
         CASE bracket_type WHEN 'upper' THEN 1 WHEN 'lower' THEN 2
           WHEN 'third_place' THEN 3 WHEN 'grand_final' THEN 4 ELSE 5 END,
         round, match_number`,
      [tid]
    )

    for (const match of done.rows) {
      const w = match.winner_team_id
      if (!w) continue
      const l = Number(w) === match.team1_id ? match.team2_id : match.team1_id
      await applyTransitions(tid, match, w, l)
    }

    res.json({ success: true, processed: done.rows.length })
  } catch(e) {
    console.error('❌ recalculate:', e)
    res.status(500).json({ error: e.message })
  }
})

// ─────────────────────────────────────────────
// ОПУБЛИКОВАТЬ СЕТКУ
// ─────────────────────────────────────────────
router.post('/:tid/publish-bracket', auth, async (req, res) => {
  try {
    const userRes = await db.query('SELECT role FROM users WHERE id=$1', [req.user.id])
    if (!['admin','organizer'].includes(userRes.rows[0]?.role)) return res.status(403).json({ error: 'Нет прав' })
    await db.query('UPDATE tournaments SET bracket_published=true WHERE id=$1', [req.params.tid])
    res.json({ success: true })
  } catch(e) { res.status(500).json({ error: 'Ошибка' }) }
})

// ─────────────────────────────────────────────
// ПОЛУЧИТЬ СЕТКУ
// ─────────────────────────────────────────────
router.get('/:tid/bracket', async (req, res) => {
  try {
    const tRes = await db.query(
      'SELECT bracket_generated,bracket_published,format FROM tournaments WHERE id=$1', [req.params.tid]
    )
    if (!tRes.rows[0]) return res.status(404).json({ error: 'Не найден' })
    const { bracket_generated, bracket_published, format } = tRes.rows[0]

    let isAdmin = false
    try {
      const jwt = require('jsonwebtoken')
      const tok = (req.headers.authorization||'').split(' ')[1]
      if (tok) {
        const dec = jwt.verify(tok, process.env.JWT_SECRET)
        const u = await db.query('SELECT role FROM users WHERE id=$1', [dec.id])
        isAdmin = ['admin','organizer'].includes(u.rows[0]?.role)
      }
    } catch(e) {}

    if (!bracket_generated) return res.json({ generated:false, published:false, matches:[], teams:[] })
    if (!bracket_published && !isAdmin) return res.json({ generated:true, published:false, matches:[], teams:[] })

    const matches = await db.query(
      `SELECT m.*,
        t1.name as team1_name, t1.seed as team1_seed,
        t2.name as team2_name, t2.seed as team2_seed,
        tw.name as winner_name
       FROM matches m
       LEFT JOIN teams t1 ON m.team1_id=t1.id
       LEFT JOIN teams t2 ON m.team2_id=t2.id
       LEFT JOIN teams tw ON m.winner_team_id=tw.id
       WHERE m.tournament_id=$1
       ORDER BY
         CASE m.bracket_type WHEN 'upper' THEN 1 WHEN 'lower' THEN 2
           WHEN 'robin' THEN 3 WHEN 'third_place' THEN 4 WHEN 'grand_final' THEN 5 ELSE 6 END,
         m.round, m.match_number`,
      [req.params.tid]
    )

    const teams = await db.query(
      `SELECT t.*, COALESCE(
        json_agg(json_build_object(
          'nickname',tp.nickname,'full_name',tp.full_name,'is_captain',tp.is_captain
        ) ORDER BY tp.is_captain DESC) FILTER (WHERE tp.id IS NOT NULL), '[]'
      ) as players
       FROM teams t
       LEFT JOIN team_players tp ON tp.team_id=t.id
       WHERE t.tournament_id=$1 GROUP BY t.id ORDER BY t.seed`,
      [req.params.tid]
    )

    res.json({ generated:true, published:bracket_published, format, matches:matches.rows, teams:teams.rows })
  } catch(e) {
    console.error(e)
    res.status(500).json({ error: 'Ошибка: ' + e.message })
  }
})

module.exports = router
