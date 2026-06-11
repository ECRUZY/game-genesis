const { Pool } = require('pg')

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
})

// Проверка подключения
pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ Ошибка подключения к БД:', err.message)
  } else {
    console.log('✅ PostgreSQL подключён')
    release()
  }
})

// Создание таблиц при первом запуске
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        phone VARCHAR(20),
        password_hash TEXT NOT NULL,
        full_name VARCHAR(100),
        game VARCHAR(50) DEFAULT 'CS2',
        university VARCHAR(100),
        faceit_nick VARCHAR(100),
        bio TEXT DEFAULT '',
        steam_url VARCHAR(300),
        is_private BOOLEAN DEFAULT false,
        role VARCHAR(20) DEFAULT 'player',
        rating INT DEFAULT 1000,
        wins INT DEFAULT 0,
        losses INT DEFAULT 0,
        verified BOOLEAN DEFAULT false,
        verify_code VARCHAR(6),
        verify_expires BIGINT,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS tournaments (
        id SERIAL PRIMARY KEY,
        organizer_id INT REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(200) NOT NULL,
        description TEXT DEFAULT '',
        game VARCHAR(50) NOT NULL,
        format VARCHAR(50) DEFAULT 'single_elimination',
        team_size VARCHAR(20) DEFAULT '1x1',
        max_slots INT DEFAULT 16,
        entry_fee INT DEFAULT 0,
        prize_pct INT DEFAULT 50,
        prize_pool INT DEFAULT 0,
        region VARCHAR(100) DEFAULT 'Чеченская Республика',
        start_date DATE,
        reg_start DATE,
        reg_end DATE,
        start_time VARCHAR(10) DEFAULT '18:00',
        status VARCHAR(20) DEFAULT 'open',
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS registrations (
        id SERIAL PRIMARY KEY,
        user_id INT REFERENCES users(id) ON DELETE CASCADE,
        tournament_id INT REFERENCES tournaments(id) ON DELETE CASCADE,
        nickname VARCHAR(100),
        steam_url VARCHAR(300),
        team_name VARCHAR(200),
        team_data TEXT,
        registered_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, tournament_id)
      );

      CREATE TABLE IF NOT EXISTS transactions (
        id SERIAL PRIMARY KEY,
        tournament_id INT REFERENCES tournaments(id) ON DELETE CASCADE,
        description TEXT NOT NULL,
        amount INT NOT NULL,
        type VARCHAR(10) NOT NULL CHECK (type IN ('income','expense')),
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS clips (
        id SERIAL PRIMARY KEY,
        user_id INT REFERENCES users(id) ON DELETE CASCADE,
        title VARCHAR(200) NOT NULL,
        game VARCHAR(50),
        duration VARCHAR(20),
        youtube_url VARCHAR(500),
        yt_id VARCHAR(50),
        views INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS teams (
        id SERIAL PRIMARY KEY,
        tournament_id INT REFERENCES tournaments(id) ON DELETE CASCADE,
        name VARCHAR(200) NOT NULL,
        captain_id INT REFERENCES users(id),
        status VARCHAR(20) DEFAULT 'pending',
        seed INT,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS team_players (
        id SERIAL PRIMARY KEY,
        team_id INT REFERENCES teams(id) ON DELETE CASCADE,
        full_name VARCHAR(200) NOT NULL,
        nickname VARCHAR(100) NOT NULL,
        steam_url VARCHAR(300),
        is_captain BOOLEAN DEFAULT false
      );

      -- Добавляем поля если их нет (безопасно)
      DO $$ BEGIN
        BEGIN ALTER TABLE matches ADD COLUMN team1_id INT REFERENCES teams(id); EXCEPTION WHEN duplicate_column THEN NULL; END;
        BEGIN ALTER TABLE matches ADD COLUMN team2_id INT REFERENCES teams(id); EXCEPTION WHEN duplicate_column THEN NULL; END;
        BEGIN ALTER TABLE matches ADD COLUMN winner_team_id INT REFERENCES teams(id); EXCEPTION WHEN duplicate_column THEN NULL; END;
        BEGIN ALTER TABLE matches ADD COLUMN bracket_type VARCHAR(10) DEFAULT 'upper'; EXCEPTION WHEN duplicate_column THEN NULL; END;
        BEGIN ALTER TABLE matches ADD COLUMN match_number INT; EXCEPTION WHEN duplicate_column THEN NULL; END;
        BEGIN ALTER TABLE tournaments ADD COLUMN bracket_generated BOOLEAN DEFAULT false; EXCEPTION WHEN duplicate_column THEN NULL; END;
        BEGIN ALTER TABLE tournaments ADD COLUMN bracket_published BOOLEAN DEFAULT false; EXCEPTION WHEN duplicate_column THEN NULL; END;
        BEGIN ALTER TABLE tournaments ADD COLUMN is_student BOOLEAN DEFAULT false; EXCEPTION WHEN duplicate_column THEN NULL; END;
        BEGIN ALTER TABLE tournaments ADD COLUMN cover_image TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END;
        BEGIN ALTER TABLE teams ADD COLUMN players JSONB; EXCEPTION WHEN duplicate_column THEN NULL; END;
        BEGIN ALTER TABLE teams ADD COLUMN needs_players INT DEFAULT 0; EXCEPTION WHEN duplicate_column THEN NULL; END;
        BEGIN ALTER TABLE teams ADD COLUMN team_type VARCHAR(20) DEFAULT 'full'; EXCEPTION WHEN duplicate_column THEN NULL; END;
        BEGIN ALTER TABLE teams ADD COLUMN student_data JSONB; EXCEPTION WHEN duplicate_column THEN NULL; END;
        BEGIN ALTER TABLE teams ADD COLUMN student_photo TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END;
        BEGIN ALTER TABLE users ADD COLUMN avatar TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END;
        BEGIN ALTER TABLE team_players ADD COLUMN student_data JSONB; EXCEPTION WHEN duplicate_column THEN NULL; END;
        BEGIN ALTER TABLE team_players ADD COLUMN student_photo TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END;

        -- Статистика игроков по матчам
        CREATE TABLE IF NOT EXISTS match_player_stats (
          id SERIAL PRIMARY KEY,
          match_id INT REFERENCES matches(id) ON DELETE CASCADE,
          tournament_id INT REFERENCES tournaments(id) ON DELETE CASCADE,
          team_id INT REFERENCES teams(id) ON DELETE CASCADE,
          nickname TEXT NOT NULL,
          kills INT DEFAULT 0,
          deaths INT DEFAULT 0,
          assists INT DEFAULT 0,
          hs_pct INT DEFAULT 0,
          adr INT DEFAULT 0,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      END $$;

    CREATE TABLE IF NOT EXISTS matches (
        id SERIAL PRIMARY KEY,
        tournament_id INT REFERENCES tournaments(id) ON DELETE CASCADE,
        round INT NOT NULL,
        player1_id INT REFERENCES users(id),
        player2_id INT REFERENCES users(id),
        score1 INT DEFAULT 0,
        score2 INT DEFAULT 0,
        winner_id INT REFERENCES users(id),
        status VARCHAR(20) DEFAULT 'pending',
        played_at TIMESTAMP
      );
    `)
    console.log('✅ Таблицы созданы / проверены')
  } catch (e) {
    console.error('❌ Ошибка создания таблиц:', e.message)
  }
}

initDB()

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool
}
