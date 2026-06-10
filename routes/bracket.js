const express = require('express')
const router = express.Router()
const db = require('../db')
const auth = require('../middleware/auth')

// ─────────────────────────────────────────────
// УТИЛИТЫ
// ─────────────────────────────────────────────
function nextPow2(n) { let p=1; while(p<n) p<<=1; return p }
function shuffle(arr) { return [...arr].sort(()=>Math.random()-0.5) }

async function insertMatch(tid, round, bracketType, matchNum, t1=null, t2=null) {
  const r = await db.query(
    `INSERT INTO matches (tournament_id,round,bracket_type,match_number,team1_id,team2_id,status)
     VALUES ($1,$2,$3,$4,$5,$6,'pending') RETURNING id`,
    [tid,round,bracketType,matchNum,t1,t2]
  )
  return r.rows[0].id
}

async function fillSlot(matchId, teamId) {
  if (!matchId || !teamId) return
  const cur = await db.query('SELECT team1_id,team2_id FROM matches WHERE id=$1',[matchId])
  if (!cur.rows[0]) return
  const {team1_id,team2_id} = cur.rows[0]
  if (!team1_id) await db.query('UPDATE matches SET team1_id=$1 WHERE id=$2',[teamId,matchId])
  else if (!team2_id) await db.query('UPDATE matches SET team2_id=$1 WHERE id=$2',[teamId,matchId])
}

// Найти ПРАВИЛЬНЫЙ следующий матч по позиции в раунде
async function findNextMatch(tid, bracketType, curRound, curMatchNum, nextRound) {
  // Получаем стартовый номер текущего раунда
  const curStart = await db.query(
    'SELECT MIN(match_number) as mn FROM matches WHERE tournament_id=$1 AND bracket_type=$2 AND round=$3',
    [tid, bracketType, curRound]
  )
  // Получаем стартовый номер следующего раунда
  const nextStart = await db.query(
    'SELECT MIN(match_number) as mn FROM matches WHERE tournament_id=$1 AND bracket_type=$2 AND round=$3',
    [tid, bracketType, nextRound]
  )
  if (!curStart.rows[0]?.mn || !nextStart.rows[0]?.mn) return null
  
  const posInCurRound = curMatchNum - curStart.rows[0].mn
  const nextMatchNum = nextStart.rows[0].mn + Math.floor(posInCurRound / 2)
  
  const r = await db.query(
    'SELECT id FROM matches WHERE tournament_id=$1 AND bracket_type=$2 AND match_number=$3',
    [tid, bracketType, nextMatchNum]
  )
  return r.rows[0]?.id || null
}

// ─────────────────────────────────────────────
// ГЕНЕРАЦИЯ СЕТКИ
// ─────────────────────────────────────────────
router.post('/:tid/generate-bracket', auth, async (req, res) => {
  try {
    const uRes = await db.query('SELECT role FROM users WHERE id=$1',[req.user.id])
    if (!['admin','organizer'].includes(uRes.rows[0]?.role))
      return res.status(403).json({error:'Нет прав'})

    const tid = req.params.tid
    const tRes = await db.query('SELECT * FROM tournaments WHERE id=$1',[tid])
    const t = tRes.rows[0]
    if (!t) return res.status(404).json({error:'Не найден'})

    const teamsRes = await db.query(
      "SELECT id,name FROM teams WHERE tournament_id=$1 AND status='accepted' ORDER BY id",[tid]
    )
    const teams = teamsRes.rows
    if (teams.length < 2) return res.status(400).json({error:'Нужно минимум 2 команды'})

    const seeded = shuffle(teams)
    for (let i=0;i<seeded.length;i++)
      await db.query('UPDATE teams SET seed=$1 WHERE id=$2',[i+1,seeded[i].id])

    await db.query('DELETE FROM matches WHERE tournament_id=$1',[tid])

    const fmt = (t.format||'se').toLowerCase()
    let msg = ''
    if (fmt==='de'||fmt==='double_elimination') msg = await generateDE(tid,seeded)
    else if (fmt==='rr'||fmt==='round_robin')   msg = await generateRR(tid,seeded)
    else                                         msg = await generateSE(tid,seeded)

    await db.query("UPDATE tournaments SET bracket_generated=true,status='live' WHERE id=$1",[tid])
    res.json({success:true,teams:seeded.length,format:fmt,message:msg})
  } catch(e) {
    console.error('❌ generate:',e)
    res.status(500).json({error:'Ошибка генерации: '+e.message})
  }
})

// ─────────────────────────────────────────────
// SINGLE ELIMINATION + 3-е место
// ─────────────────────────────────────────────
async function generateSE(tid, teams) {
  const n = teams.length, size = nextPow2(n)
  let mn = 1
  const slots = new Array(size).fill(null)
  for (let i=0;i<n;i++) slots[i] = teams[i]

  // R1: попарно 1 vs last, 2 vs (last-1)...
  for (let i=0;i<size/2;i++) {
    const t1=slots[i], t2=slots[size-1-i]
    await insertMatch(tid,1,'upper',mn++,t1?.id||null,t2?.id||null)
  }

  // R2..Final
  let matchesInRound = size/2, rnd = 2
  while (matchesInRound > 1) {
    matchesInRound /= 2
    for (let i=0;i<matchesInRound;i++) await insertMatch(tid,rnd,'upper',mn++)
    rnd++
  }

  // 3-е место (SF проигравшие) — только если >=4 команд
  if (size >= 4) await insertMatch(tid, rnd-1, 'third_place', mn++)

  return `Single Elimination: ${n} команд`
}

// ─────────────────────────────────────────────
// DOUBLE ELIMINATION
// ─────────────────────────────────────────────
async function generateDE(tid, teams) {
  const n = teams.length, size = nextPow2(n)
  let mn = 1
  const slots = new Array(size).fill(null)
  for (let i=0;i<n;i++) slots[i] = teams[i]

  // UB R1
  for (let i=0;i<size/2;i++) {
    await insertMatch(tid,1,'upper',mn++,slots[i]?.id||null,slots[size-1-i]?.id||null)
  }
  // UB R2..Final
  let ubMatches = size/2, ubRnd = 2, ubRounds = 1
  while (ubMatches > 1) {
    ubMatches /= 2
    for (let i=0;i<ubMatches;i++) await insertMatch(tid,ubRnd,'upper',mn++)
    ubRnd++; ubRounds++
  }
  const maxUBRound = ubRnd - 1

  // LB
  // LB R1: size/4 матчей (принимает losers из UB R1)
  let lbMatches = size/4, lbRnd = 1
  for (let i=0;i<lbMatches;i++) await insertMatch(tid,lbRnd,'lower',mn++)
  lbRnd++

  // LB раунды: после каждого UB раунда (2..maxUBRound-1) losers падают в LB
  for (let ubDrop=2; ubDrop<maxUBRound; ubDrop++) {
    // Elimination: матчи LB winners vs UB drops
    for (let i=0;i<lbMatches;i++) await insertMatch(tid,lbRnd,'lower',mn++)
    lbRnd++
    // Consolidation: если lbMatches > 1
    if (lbMatches > 1) {
      lbMatches /= 2
      for (let i=0;i<lbMatches;i++) await insertMatch(tid,lbRnd,'lower',mn++)
      lbRnd++
    }
  }
  // LB Final
  await insertMatch(tid,lbRnd,'lower',mn++)

  // Grand Final
  await insertMatch(tid,1,'grand_final',mn++)

  // 3-е место: UB SF (предпоследний раунд UB) проигравшие
  if (maxUBRound >= 3) await insertMatch(tid,1,'third_place',mn++)

  return `Double Elimination: ${n} команд`
}

// ─────────────────────────────────────────────
// ROUND ROBIN
// ─────────────────────────────────────────────
async function generateRR(tid, teams) {
  let mn=1
  const list = teams.length%2===0 ? [...teams] : [...teams,null]
  const total = list.length
  for (let round=0;round<total-1;round++) {
    for (let i=0;i<total/2;i++) {
      const t1=list[i], t2=list[total-1-i]
      if (t1&&t2) await insertMatch(tid,round+1,'robin',mn++,t1.id,t2.id)
    }
    const last=list.splice(total-1,1)[0]; list.splice(1,0,last)
  }
  return `Round Robin: ${teams.length} команд`
}

// ─────────────────────────────────────────────
// РЕЗУЛЬТАТ МАТЧА
// ─────────────────────────────────────────────
router.put('/:tid/matches/:mid', auth, async (req, res) => {
  try {
    const uRes = await db.query('SELECT role FROM users WHERE id=$1',[req.user.id])
    if (!['admin','organizer'].includes(uRes.rows[0]?.role))
      return res.status(403).json({error:'Нет прав'})

    const {score1,score2,winner_team_id} = req.body
    if (!winner_team_id) return res.status(400).json({error:'Укажите победителя'})

    const result = await db.query(
      `UPDATE matches SET score1=$1,score2=$2,winner_team_id=$3,status='done',played_at=NOW()
       WHERE id=$4 AND tournament_id=$5 RETURNING *`,
      [score1||0,score2||0,winner_team_id,req.params.mid,req.params.tid]
    )
    if (!result.rows[0]) return res.status(404).json({error:'Матч не найден'})

    const match = result.rows[0]
    const w = Number(winner_team_id)
    const l = (w===match.team1_id) ? match.team2_id : match.team1_id

    // Рейтинг
    try {
      for (const [teamId,delta] of [[w,25],[l,-25]]) {
        if (!teamId) continue
        const pl = await db.query('SELECT nickname FROM team_players WHERE team_id=$1',[teamId])
        for (const p of pl.rows) {
          await db.query(
            `UPDATE users SET rating=GREATEST(0,rating+$1),
              wins=wins+${delta>0?1:0},losses=losses+${delta<0?1:0}
             WHERE LOWER(username)=LOWER($2) OR LOWER(faceit_nick)=LOWER($2)`,
            [delta,p.nickname]
          )
        }
      }
    } catch(e){ console.log('rating skip:',e.message) }

    await applyTransitions(req.params.tid, match, w, l)
    res.json({success:true,match:result.rows[0]})
  } catch(e) {
    console.error('❌ match result:',e)
    res.status(500).json({error:'Ошибка: '+e.message})
  }
})

async function applyTransitions(tid, match, w, l) {
  const bt = match.bracket_type

  if (bt==='upper') {
    // Макс раунд UB
    const maxR = await db.query(
      'SELECT MAX(round) as mr FROM matches WHERE tournament_id=$1 AND bracket_type=\'upper\'',[tid]
    )
    const maxUBRound = maxR.rows[0].mr
    const isFinal = match.round===maxUBRound
    const isSF = match.round===maxUBRound-1

    if (isFinal) {
      // UB финал: победитель → Grand Final
      const gf = await db.query(
        'SELECT id FROM matches WHERE tournament_id=$1 AND bracket_type=\'grand_final\' AND (team1_id IS NULL OR team2_id IS NULL) ORDER BY id LIMIT 1',[tid]
      )
      if (gf.rows[0]) await fillSlot(gf.rows[0].id, w)
      // Проигравший → LB финал (последний раунд LB)
      if (l) {
        const lbFinal = await db.query(
          'SELECT id FROM matches WHERE tournament_id=$1 AND bracket_type=\'lower\' AND (team1_id IS NULL OR team2_id IS NULL) ORDER BY round DESC,match_number LIMIT 1',[tid]
        )
        if (lbFinal.rows[0]) await fillSlot(lbFinal.rows[0].id, l)
      }
    } else {
      // Обычный UB матч: победитель → следующий UB раунд (правильный матч!)
      const nextId = await findNextMatch(tid,'upper',match.round,match.match_number,match.round+1)
      if (nextId) await fillSlot(nextId, w)

      // Проигравший: если DE → LB, если SE → ничего (просто выбывает)
      if (l) {
        // Проигравший в SF → матч за 3-е место
        if (isSF) {
          const tp = await db.query(
            'SELECT id FROM matches WHERE tournament_id=$1 AND bracket_type=\'third_place\' AND (team1_id IS NULL OR team2_id IS NULL) ORDER BY id LIMIT 1',[tid]
          )
          if (tp.rows[0]) await fillSlot(tp.rows[0].id, l)
        }
        // DE: проигравший → LB правильный матч
        const lbExists = await db.query(
          'SELECT COUNT(*) FROM matches WHERE tournament_id=$1 AND bracket_type=\'lower\'',[tid]
        )
        if (parseInt(lbExists.rows[0].count)>0) {
          // Для UB R1: losers → LB R1 по позиции
          // Для UB R2+: losers → соответствующий LB raунд
          const lbRound = match.round // UB round N losers → LB round N
          const lbNextId = await findNextMatchLB(tid, match.round, match.match_number)
          if (lbNextId) await fillSlot(lbNextId, l)
        }
      }
    }

  } else if (bt==='lower') {
    const maxLB = await db.query(
      'SELECT MAX(round) as mr FROM matches WHERE tournament_id=$1 AND bracket_type=\'lower\'',[tid]
    )
    const isLBFinal = match.round===maxLB.rows[0].mr
    if (isLBFinal) {
      // LB финал: победитель → Grand Final
      const gf = await db.query(
        'SELECT id FROM matches WHERE tournament_id=$1 AND bracket_type=\'grand_final\' AND (team1_id IS NULL OR team2_id IS NULL) ORDER BY id LIMIT 1',[tid]
      )
      if (gf.rows[0]) await fillSlot(gf.rows[0].id, w)
    } else {
      // Победитель → следующий LB раунд
      const nextId = await findNextMatch(tid,'lower',match.round,match.match_number,match.round+1)
      if (nextId) await fillSlot(nextId, w)
    }

  } else if (bt==='grand_final') {
    await db.query("UPDATE tournaments SET status='done' WHERE id=$1",[tid])

  } else if (bt==='robin') {
    const p = await db.query(
      "SELECT COUNT(*) FROM matches WHERE tournament_id=$1 AND bracket_type='robin' AND status!='done'",[tid]
    )
    if (parseInt(p.rows[0].count)===0)
      await db.query("UPDATE tournaments SET status='done' WHERE id=$1",[tid])
  }
}

// Для DE: найти правильный LB матч для проигравшего из UB
async function findNextMatchLB(tid, ubRound, ubMatchNum) {
  // UB R1 losers → LB R1: позиция в UB R1 / 2 → позиция в LB R1
  // UB R2 losers → LB elimination раунд соответствующего уровня
  // Упрощённо: найти LB раунд = ubRound, первый свободный по позиции
  const lbRound = ubRound
  const curStart = await db.query(
    'SELECT MIN(match_number) as mn FROM matches WHERE tournament_id=$1 AND bracket_type=\'upper\' AND round=$2',
    [tid, ubRound]
  )
  const lbStart = await db.query(
    'SELECT MIN(match_number) as mn FROM matches WHERE tournament_id=$1 AND bracket_type=\'lower\' AND round=$3',
    [tid, lbRound]
  )
  if (!curStart.rows[0]?.mn || !lbStart.rows[0]?.mn) return null
  
  const posInUB = ubMatchNum - curStart.rows[0].mn
  const lbMatchNum = lbStart.rows[0].mn + Math.floor(posInUB / 2)
  
  const r = await db.query(
    'SELECT id FROM matches WHERE tournament_id=$1 AND bracket_type=\'lower\' AND match_number=$2',
    [tid, lbMatchNum]
  )
  return r.rows[0]?.id || null
}

// ─────────────────────────────────────────────
// ПЕРЕСЧИТАТЬ ПЕРЕХОДЫ
// ─────────────────────────────────────────────
router.post('/:tid/recalculate', auth, async (req, res) => {
  try {
    const uRes = await db.query('SELECT role FROM users WHERE id=$1',[req.user.id])
    if (!['admin','organizer'].includes(uRes.rows[0]?.role))
      return res.status(403).json({error:'Нет прав'})

    const tid = req.params.tid

    // Сбрасываем все pending матчи кроме UB R1
    await db.query(
      `UPDATE matches SET team1_id=NULL,team2_id=NULL
       WHERE tournament_id=$1 AND status='pending'
       AND NOT (bracket_type='upper' AND round=1)`,
      [tid]
    )

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
      const l = (Number(w)===match.team1_id) ? match.team2_id : match.team1_id
      await applyTransitions(tid, match, w, l)
    }

    res.json({success:true, processed:done.rows.length})
  } catch(e) {
    console.error('❌ recalculate:',e)
    res.status(500).json({error:e.message})
  }
})

// ─────────────────────────────────────────────
// ОПУБЛИКОВАТЬ
// ─────────────────────────────────────────────
router.post('/:tid/publish-bracket', auth, async (req, res) => {
  try {
    const uRes = await db.query('SELECT role FROM users WHERE id=$1',[req.user.id])
    if (!['admin','organizer'].includes(uRes.rows[0]?.role)) return res.status(403).json({error:'Нет прав'})
    await db.query('UPDATE tournaments SET bracket_published=true WHERE id=$1',[req.params.tid])
    res.json({success:true})
  } catch(e) { res.status(500).json({error:'Ошибка'}) }
})

// ─────────────────────────────────────────────
// ПОЛУЧИТЬ СЕТКУ
// ─────────────────────────────────────────────
router.get('/:tid/bracket', async (req, res) => {
  try {
    const tRes = await db.query(
      'SELECT bracket_generated,bracket_published,format FROM tournaments WHERE id=$1',[req.params.tid]
    )
    if (!tRes.rows[0]) return res.status(404).json({error:'Не найден'})
    const {bracket_generated,bracket_published,format} = tRes.rows[0]

    let isAdmin = false
    try {
      const jwt = require('jsonwebtoken')
      const tok = (req.headers.authorization||'').split(' ')[1]
      if (tok) {
        const dec = jwt.verify(tok,process.env.JWT_SECRET)
        const u = await db.query('SELECT role FROM users WHERE id=$1',[dec.id])
        isAdmin = ['admin','organizer'].includes(u.rows[0]?.role)
      }
    } catch(e){}

    if (!bracket_generated) return res.json({generated:false,published:false,matches:[],teams:[]})
    if (!bracket_published&&!isAdmin) return res.json({generated:true,published:false,matches:[],teams:[]})

    const matches = await db.query(
      `SELECT m.*,
        t1.name as team1_name,t1.seed as team1_seed,
        t2.name as team2_name,t2.seed as team2_seed,
        tw.name as winner_name
       FROM matches m
       LEFT JOIN teams t1 ON m.team1_id=t1.id
       LEFT JOIN teams t2 ON m.team2_id=t2.id
       LEFT JOIN teams tw ON m.winner_team_id=tw.id
       WHERE m.tournament_id=$1
       ORDER BY
         CASE m.bracket_type WHEN 'upper' THEN 1 WHEN 'lower' THEN 2
           WHEN 'robin' THEN 3 WHEN 'third_place' THEN 4 WHEN 'grand_final' THEN 5 ELSE 6 END,
         m.round,m.match_number`,
      [req.params.tid]
    )

    const teams = await db.query(
      `SELECT t.*,COALESCE(
        json_agg(json_build_object(
          'nickname',tp.nickname,'full_name',tp.full_name,'is_captain',tp.is_captain
        ) ORDER BY tp.is_captain DESC) FILTER (WHERE tp.id IS NOT NULL),'[]'
      ) as players
       FROM teams t
       LEFT JOIN team_players tp ON tp.team_id=t.id
       WHERE t.tournament_id=$1 GROUP BY t.id ORDER BY t.seed`,
      [req.params.tid]
    )

    res.json({generated:true,published:bracket_published,format,matches:matches.rows,teams:teams.rows})
  } catch(e) {
    console.error(e)
    res.status(500).json({error:'Ошибка: '+e.message})
  }
})

module.exports = router
