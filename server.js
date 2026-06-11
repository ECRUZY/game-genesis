require('dotenv').config()
const express = require('express')
const cors = require('cors')
const path = require('path')

const app = express()

app.use(cors())
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))
app.use(express.static(path.join(__dirname, 'public')))

// bracket ПЕРВЫМ — перехватывает PUT матчей с переходами
app.use('/api/auth',        require('./routes/auth'))
app.use('/api/users',       require('./routes/users'))
app.use('/api/tournaments', require('./routes/bracket'))
app.use('/api/tournaments', require('./routes/tournaments'))
app.use('/api/partners',    require('./routes/partners'))
app.use('/api/admin',       require('./routes/admin'))

app.get('/health', (req, res) => res.json({ status: 'ok' }))
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')))

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log('Game Genesis на порту ' + PORT))
