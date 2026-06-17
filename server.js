require('dotenv').config()
const express = require('express')
const cors = require('cors')
const path = require('path')

const app = express()

// ── MIDDLEWARE ──
app.use(cors())
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

// ── СТАТИЧЕСКИЕ ФАЙЛЫ (твои HTML) ──
app.use(express.static(path.join(__dirname, 'public')))

// ── API РОУТЫ ──
app.use('/api/auth', require('./routes/auth'))
app.use('/api/users', require('./routes/users'))
app.use('/api/matches', require('./routes/match'))
app.use('/api/tournaments', require('./routes/bracket'))
app.use('/api/tournaments', require('./routes/tournaments'))
app.use('/api/partners', require('./routes/partners'))
app.use('/api/admin', require('./routes/admin'))

// ── HEALTH CHECK (Railway использует это) ──
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date() }))

// ── ЛЮБОЙ ДРУГОЙ МАРШРУТ → index.html ──
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

// ── ЗАПУСК ──
const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`
  ╔════════════════════════════════╗
  ║   GAME GENESIS сервер запущен  ║
  ║   http://localhost:${PORT}        ║
  ╚════════════════════════════════╝
  `)
})
