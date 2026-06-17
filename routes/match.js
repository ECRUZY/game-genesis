const express = require('express')
const router  = express.Router()
const db      = require('../db')
const auth    = require('../middleware/auth')

// ── IN-MEMORY ХРАНИЛИЩЕ ──
// { matchId: { messages: [], faceitLink: null, participants: Set } }
const matchRooms = new Map()

function getRoom(matchId) {
  if (!matchRooms.has(matchId)) {
    matchRooms.set(matchId, { messages: [], faceitLink: null })
  }
  return matchRooms.get(matchId)
}

// Очищаем комнату через 24ч после создания или если матч done
async function maybeCleanRoom(matchId) {
  try {
    const r = await db.query('SELECT status FROM matches WHERE id=$1', [matchId])
    if (r.rows[0]?.status === 'done') {
      setTimeout(() => matchRooms.delete(matchId), 60 * 60 * 1000) // через 1ч после завершения
    }
  } catch(e) {}
}

// ── ПОЛУЧИТЬ ДАННЫЕ МАТЧА ──
router.get('/:mid', async (req, res) => {
  try {
    const mid = req.params.mid
    const matchRes = await db.query(`
      SELECT m.*,
        t1.name as team1_name, t1.id as t1id,
        t2.name as team2_name, t2.id as t2id,
        t.name as tournament_name, t.game, t.organizer_id,
        t.team_size
      FROM matches m
      LEFT JOIN teams t1 ON t1.id = m.team1_id
      LEFT JOIN teams t2 ON t2.id = m.team2_id
      LEFT JOIN tournaments t ON t.id = m.tournament_id
      WHERE m.id = $1
    `, [mid])

    if (!matchRes.rows[0]) return res.status(404).json({ error: 'Матч не найден' })
    const match = matchRes.rows[0]

    // Игроки обеих команд
    const p1 = await db.query(
      'SELECT nickname, is_captain FROM team_players WHERE team_id=$1 ORDER BY is_captain DESC',
      [match.team1_id]
    )
    const p2 = await db.query(
      'SELECT nickname, is_captain FROM team_players WHERE team_id=$1 ORDER BY is_captain DESC',
      [match.team2_id]
    )

    // Статы игроков этого матча
    const stats = await db.query(
      'SELECT * FROM match_player_stats WHERE match_id=$1',
      [mid]
    )

    // Профили игроков (аватар, faceit_nick)
    const allNicks = [...p1.rows, ...p2.rows].map(p => p.nickname)
    const profiles = allNicks.length > 0 ? await db.query(
      `SELECT username, full_name, avatar, faceit_nick, rating
       FROM users WHERE LOWER(username) = ANY($1::text[]) OR LOWER(faceit_nick) = ANY($1::text[])`,
      [allNicks.map(n => n.toLowerCase())]
    ) : { rows: [] }

    res.json({
      match,
      team1_players: p1.rows,
      team2_players: p2.rows,
      stats: stats.rows,
      profiles: profiles.rows
    })
  } catch(e) {
    console.error(e)
    res.status(500).json({ error: e.message })
  }
})

// ── ПОЛУЧИТЬ СООБЩЕНИЯ (polling каждые 3 сек) ──
router.get('/:mid/messages', auth, async (req, res) => {
  try {
    const mid = parseInt(req.params.mid)
    const isParticipant = await checkParticipant(mid, req.user.id)
    if (!isParticipant) return res.status(403).json({ error: 'Нет доступа' })

    const room = getRoom(mid)
    const since = parseInt(req.query.since) || 0
    const newMessages = room.messages.filter(m => m.ts > since)

    res.json({
      messages: newMessages,
      faceitLink: room.faceitLink,
      lastTs: room.messages.length > 0 ? room.messages[room.messages.length-1].ts : 0
    })
  } catch(e) {
    res.status(500).json({ error: e.message })
  }
})

// ── ОТПРАВИТЬ СООБЩЕНИЕ ──
router.post('/:mid/messages', auth, async (req, res) => {
  try {
    const mid = parseInt(req.params.mid)
    const isParticipant = await checkParticipant(mid, req.user.id)
    if (!isParticipant) return res.status(403).json({ error: 'Нет доступа' })

    const { text } = req.body
    if (!text?.trim()) return res.status(400).json({ error: 'Пустое сообщение' })
    if (text.length > 500) return res.status(400).json({ error: 'Слишком длинное' })

    const userRes = await db.query('SELECT username, role, avatar FROM users WHERE id=$1', [req.user.id])
    const user = userRes.rows[0]

    const msg = {
      id: Date.now(),
      ts: Date.now(),
      userId: req.user.id,
      username: user.username,
      role: user.role,
      avatar: user.avatar,
      text: text.trim()
    }

    // Если организатор/admin отправляет ссылку на faceit — сохраняем отдельно
    if ((user.role === 'admin' || user.role === 'organizer') &&
        (text.includes('faceit.com') || text.includes('FACEIT'))) {
      const room = getRoom(mid)
      const urlMatch = text.match(/(https?:\/\/[^\s]+faceit[^\s]*)/i)
      if (urlMatch) room.faceitLink = urlMatch[1]
    }

    const room = getRoom(mid)
    room.messages.push(msg)
    if (room.messages.length > 200) room.messages.shift() // макс 200 сообщений

    maybeCleanRoom(mid)
    res.json({ success: true, message: msg })
  } catch(e) {
    res.status(500).json({ error: e.message })
  }
})

// ── УСТАНОВИТЬ ССЫЛКУ FACEIT (только организатор/admin) ──
router.post('/:mid/faceit-link', auth, async (req, res) => {
  try {
    const mid = parseInt(req.params.mid)
    const userRes = await db.query('SELECT role FROM users WHERE id=$1', [req.user.id])
    const role = userRes.rows[0]?.role
    const matchRes = await db.query('SELECT organizer_id FROM tournaments t JOIN matches m ON m.tournament_id=t.id WHERE m.id=$1', [mid])
    const isOrg = role === 'admin' || role === 'organizer' ||
                  matchRes.rows[0]?.organizer_id === req.user.id

    if (!isOrg) return res.status(403).json({ error: 'Нет прав' })

    const { link } = req.body
    if (!link) return res.status(400).json({ error: 'Нет ссылки' })

    const room = getRoom(mid)
    room.faceitLink = link
    res.json({ success: true })
  } catch(e) {
    res.status(500).json({ error: e.message })
  }
})

// ── ПРОВЕРКА УЧАСТНИКА ──
async function checkParticipant(matchId, userId) {
  // Получаем матч
  const m = await db.query(
    'SELECT m.team1_id, m.team2_id, t.organizer_id FROM matches m JOIN tournaments t ON t.id=m.tournament_id WHERE m.id=$1',
    [matchId]
  )
  if (!m.rows[0]) return false
  const { team1_id, team2_id, organizer_id } = m.rows[0]

  // Организатор/admin
  const u = await db.query('SELECT role, username FROM users WHERE id=$1', [userId])
  const role = u.rows[0]?.role
  if (role === 'admin' || organizer_id === userId) return true

  // Капитан одной из команд
  const nick = u.rows[0]?.username
  const cap = await db.query(
    `SELECT id FROM team_players
     WHERE is_captain=true AND team_id IN ($1,$2)
     AND LOWER(nickname)=LOWER($3)`,
    [team1_id, team2_id, nick]
  )
  return cap.rows.length > 0
}

module.exports = router
