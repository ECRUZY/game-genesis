const db = require('../db')

// Типы уведомлений и их иконки
const TYPES = {
  team_accepted:  { icon: '✅', label: 'Заявка принята' },
  team_rejected:  { icon: '❌', label: 'Заявка отклонена' },
  match_result:   { icon: '🏆', label: 'Результат матча' },
  match_ready:    { icon: '⚔️',  label: 'Матч готов' },
  new_message:    { icon: '💬', label: 'Новое сообщение' },
  tournament_start:{ icon: '🚀', label: 'Турнир начался' },
  tournament_done:{ icon: '🎉', label: 'Турнир завершён' },
}

async function notify(userId, type, text, link) {
  if (!userId) return
  try {
    await db.query(
      `INSERT INTO notifications (user_id, type, text, link)
       VALUES ($1, $2, $3, $4)`,
      [userId, type, text, link || null]
    )
  } catch(e) {
    console.log('notify error:', e.message)
  }
}

// Уведомить всех игроков команды
async function notifyTeam(teamId, type, text, link) {
  try {
    const players = await db.query(
      `SELECT u.id FROM team_players tp
       JOIN users u ON LOWER(u.username) = LOWER(tp.nickname)
                    OR LOWER(u.faceit_nick) = LOWER(tp.nickname)
       WHERE tp.team_id = $1`,
      [teamId]
    )
    for (const p of players.rows) {
      await notify(p.id, type, text, link)
    }
  } catch(e) {
    console.log('notifyTeam error:', e.message)
  }
}

module.exports = { notify, notifyTeam, TYPES }
