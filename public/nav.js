/**
 * GAME GENESIS — Боковая навигация
 * Подключи: <script src="/nav.js"></script>
 * Убирает старый header и sidebar, рендерит новый sidebar
 */
(function () {

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Rajdhani:wght@500;600;700&family=Exo+2:wght@400;500;600&display=swap');

  :root {
    --gold: #f0c040;
    --gold-dim: rgba(240,192,64,0.1);
    --bg: #080c12;
    --bg-card: #0d1420;
    --bg-card2: #111928;
    --border: #1a2436;
    --border-hi: #253550;
    --text: #dde4ef;
    --text-dim: #5c7090;
    --text-muted: #2e3f58;
    --success: #4ade80;
    --red: #f87171;
    --sidebar-w: 240px;
    --sidebar-w-collapsed: 64px;
  }

  /* ── Убираем старое ── */
  body > header:not(#gg-sidebar),
  .page > header { display: none !important; }
  aside.sidebar { display: none !important; }

  /* ── Body смещение ── */
  body {
    margin: 0 !important;
    padding: 0 !important;
    padding-left: var(--sidebar-w) !important;
    transition: padding-left .3s ease;
    min-height: 100vh;
  }
  body.gg-collapsed {
    padding-left: var(--sidebar-w-collapsed) !important;
  }
  .page {
    margin-left: 0 !important;
    padding-top: 0 !important;
  }

  /* ── SIDEBAR ── */
  #gg-sidebar {
    position: fixed;
    left: 0; top: 0; bottom: 0;
    width: var(--sidebar-w);
    z-index: 500;
    display: flex;
    flex-direction: column;
    background: rgba(8,12,18,0.97);
    backdrop-filter: blur(20px);
    border-right: 1px solid var(--border);
    transition: width .3s ease;
    overflow: hidden;
  }
  body.gg-collapsed #gg-sidebar {
    width: var(--sidebar-w-collapsed);
  }

  /* ── TOP: лого + toggle ── */
  .gg-sb-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 20px 16px 16px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    min-height: 68px;
  }
  .gg-sb-logo {
    display: flex;
    align-items: center;
    gap: 10px;
    text-decoration: none;
    overflow: hidden;
    white-space: nowrap;
  }
  .gg-sb-logo-hex {
    width: 36px; height: 36px;
    background: var(--gold);
    clip-path: polygon(50% 0%,93% 25%,93% 75%,50% 100%,7% 75%,7% 25%);
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
    transition: transform .2s;
  }
  .gg-sb-logo-hex:hover { transform: scale(1.08); }
  .gg-sb-logo-hex svg { width: 18px; height: 18px; }
  .gg-sb-logo-name {
    font-family: 'Rajdhani', sans-serif;
    font-size: 17px; font-weight: 700;
    color: var(--gold); letter-spacing: 2px;
    opacity: 1; transition: opacity .2s;
  }
  body.gg-collapsed .gg-sb-logo-name { opacity: 0; pointer-events: none; }

  .gg-sb-toggle {
    width: 28px; height: 28px;
    background: var(--bg-card); border: 1px solid var(--border);
    border-radius: 7px; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    color: var(--text-dim); transition: .2s; flex-shrink: 0;
    margin-left: 6px;
  }
  .gg-sb-toggle:hover { border-color: var(--gold); color: var(--gold); }
  .gg-sb-toggle svg {
    width: 14px; height: 14px; stroke: currentColor; fill: none;
    stroke-width: 2; stroke-linecap: round; stroke-linejoin: round;
    transition: transform .3s;
  }
  body.gg-collapsed .gg-sb-toggle svg { transform: rotate(180deg); }

  /* ── NAV ITEMS ── */
  .gg-sb-nav {
    flex: 1; overflow-y: auto; overflow-x: hidden;
    padding: 12px 10px; display: flex; flex-direction: column; gap: 2px;
  }
  .gg-sb-nav::-webkit-scrollbar { width: 3px; }
  .gg-sb-nav::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }

  .gg-sb-label {
    font-size: 10px; font-weight: 700; color: var(--text-muted);
    text-transform: uppercase; letter-spacing: 1.5px;
    padding: 10px 10px 4px;
    white-space: nowrap; overflow: hidden;
    opacity: 1; transition: opacity .2s;
  }
  body.gg-collapsed .gg-sb-label { opacity: 0; }

  .gg-sb-item {
    display: flex; align-items: center; gap: 12px;
    padding: 10px 10px;
    border-radius: 10px;
    text-decoration: none;
    color: var(--text-dim);
    cursor: pointer;
    transition: background .2s, color .2s;
    position: relative;
    white-space: nowrap;
    overflow: hidden;
    border: none; background: transparent;
    width: 100%; text-align: left;
    font-family: 'Exo 2', sans-serif;
  }
  .gg-sb-item:hover {
    background: rgba(255,255,255,.04);
    color: var(--text);
  }
  .gg-sb-item.active {
    background: var(--gold-dim);
    color: var(--gold);
  }
  .gg-sb-item.active::before {
    content: '';
    position: absolute; left: 0; top: 20%; bottom: 20%;
    width: 3px; background: var(--gold); border-radius: 0 2px 2px 0;
  }
  .gg-sb-icon {
    width: 20px; height: 20px; flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
  }
  .gg-sb-icon svg {
    width: 18px; height: 18px; stroke: currentColor; fill: none;
    stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round;
  }
  .gg-sb-text {
    font-size: 14px; font-weight: 500;
    opacity: 1; transition: opacity .2s;
    line-height: 1.2;
  }
  body.gg-collapsed .gg-sb-text { opacity: 0; }

  /* tooltip when collapsed */
  .gg-sb-item::after {
    content: attr(data-tip);
    position: absolute; left: calc(var(--sidebar-w-collapsed) + 6px); top: 50%;
    transform: translateY(-50%);
    background: #1a2436; color: var(--text);
    font-size: 12px; padding: 5px 10px; border-radius: 6px;
    white-space: nowrap; pointer-events: none;
    opacity: 0; transition: opacity .15s;
    font-family: 'Exo 2', sans-serif;
  }
  body.gg-collapsed .gg-sb-item:hover::after { opacity: 1; }

  .gg-sb-sep { height: 1px; background: var(--border); margin: 8px 10px; }

  /* CREATE button */
  .gg-sb-create {
    display: flex; align-items: center; gap: 12px;
    padding: 10px 10px; border-radius: 10px;
    background: var(--gold); color: #080c12;
    text-decoration: none; cursor: pointer; border: none;
    font-family: 'Exo 2', sans-serif;
    transition: background .2s, box-shadow .2s;
    white-space: nowrap; overflow: hidden; width: 100%;
  }
  .gg-sb-create:hover { background: #ffd055; box-shadow: 0 0 16px rgba(240,192,64,.3); }
  .gg-sb-create .gg-sb-icon svg { stroke: #080c12; }
  .gg-sb-create .gg-sb-text { font-weight: 700; font-size: 14px; letter-spacing: .5px; }

  /* ── BOTTOM: user block ── */
  .gg-sb-bottom {
    border-top: 1px solid var(--border);
    padding: 12px 10px;
    flex-shrink: 0;
  }

  /* Not logged in */
  .gg-sb-auth {
    display: flex; flex-direction: column; gap: 6px;
  }
  .gg-sb-btn-login {
    display: flex; align-items: center; justify-content: center; gap: 8px;
    padding: 9px 12px; border-radius: 9px;
    border: 1px solid var(--border-hi); background: transparent;
    color: var(--text-dim); cursor: pointer; transition: .2s;
    font-family: 'Exo 2', sans-serif; font-size: 13px; font-weight: 500;
    text-decoration: none; white-space: nowrap; overflow: hidden;
  }
  .gg-sb-btn-login:hover { border-color: var(--gold); color: var(--gold); }
  .gg-sb-btn-reg {
    display: flex; align-items: center; justify-content: center; gap: 8px;
    padding: 9px 12px; border-radius: 9px;
    border: 2px solid var(--gold); background: transparent;
    color: var(--gold); cursor: pointer; transition: .2s;
    font-family: 'Rajdhani', sans-serif; font-size: 14px; font-weight: 700; letter-spacing: 1px;
    text-decoration: none; white-space: nowrap; overflow: hidden;
  }
  .gg-sb-btn-reg:hover { background: var(--gold); color: #080c12; }
  .gg-sb-btn-login svg, .gg-sb-btn-reg svg {
    width: 15px; height: 15px; stroke: currentColor; fill: none;
    stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; flex-shrink: 0;
  }

  /* Logged in user card */
  .gg-sb-user {
    display: flex; align-items: center; gap: 10px;
    padding: 8px 10px; border-radius: 10px;
    cursor: pointer; transition: background .2s;
    position: relative; overflow: hidden;
    border: 1px solid transparent;
  }
  .gg-sb-user:hover { background: rgba(255,255,255,.04); border-color: var(--border-hi); }
  .gg-sb-user.open { background: var(--gold-dim); border-color: rgba(240,192,64,.25); }

  .gg-sb-avatar {
    width: 36px; height: 36px; border-radius: 9px;
    background: linear-gradient(135deg, #1a2a4a, #2a1a4a);
    display: flex; align-items: center; justify-content: center;
    font-family: 'Rajdhani', sans-serif; font-size: 14px; font-weight: 700; color: var(--gold);
    flex-shrink: 0; border: 1px solid var(--border-hi); overflow: hidden;
  }
  .gg-sb-avatar img { width: 100%; height: 100%; object-fit: cover; }

  .gg-sb-user-info { flex: 1; min-width: 0; }
  .gg-sb-user-name {
    font-family: 'Rajdhani', sans-serif; font-size: 15px; font-weight: 700; color: #fff;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .gg-sb-user-role { font-size: 10px; color: var(--text-dim); margin-top: 1px; }

  .gg-sb-user-chevron {
    width: 14px; height: 14px; stroke: var(--text-muted); fill: none;
    stroke-width: 2; stroke-linecap: round; stroke-linejoin: round;
    flex-shrink: 0; transition: transform .2s;
  }
  .gg-sb-user.open .gg-sb-user-chevron { transform: rotate(180deg); }

  /* User dropdown (above) */
  .gg-sb-user-dd {
    position: absolute; left: 10px; right: 10px;
    bottom: calc(100% + 8px);
    background: var(--bg-card); border: 1px solid var(--border-hi);
    border-radius: 12px; overflow: hidden;
    box-shadow: 0 -12px 40px rgba(0,0,0,.5);
    opacity: 0; pointer-events: none; transform: translateY(6px);
    transition: opacity .2s, transform .2s; z-index: 100;
  }
  .gg-sb-user-dd.open { opacity: 1; pointer-events: all; transform: translateY(0); }

  .gg-dd-head {
    padding: 12px 14px 10px;
    border-bottom: 1px solid var(--border);
    background: rgba(0,0,0,.3);
  }
  .gg-dd-uname { font-family: 'Rajdhani',sans-serif; font-size: 16px; font-weight: 700; color: #fff; }
  .gg-dd-email { font-size: 11px; color: var(--text-dim); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  .gg-dd-link {
    display: flex; align-items: center; gap: 10px;
    padding: 10px 14px; font-size: 13px; color: var(--text-dim);
    text-decoration: none; cursor: pointer; transition: .2s;
    border: none; background: none; width: 100%; text-align: left;
    font-family: 'Exo 2', sans-serif;
  }
  .gg-dd-link svg { width: 15px; height: 15px; stroke: currentColor; fill: none; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; flex-shrink: 0; }
  .gg-dd-link:hover { color: var(--text); background: rgba(255,255,255,.04); }
  .gg-dd-link.danger:hover { color: var(--red); background: rgba(248,113,113,.06); }
  .gg-dd-sep { height: 1px; background: var(--border); }

  body.gg-collapsed .gg-sb-user-info,
  body.gg-collapsed .gg-sb-user-chevron { opacity: 0; }
  body.gg-collapsed .gg-sb-text,
  body.gg-collapsed .gg-sb-label { opacity: 0; }
  body.gg-collapsed .gg-sb-auth { gap: 4px; }
  body.gg-collapsed .gg-sb-btn-login span,
  body.gg-collapsed .gg-sb-btn-reg span { display: none; }

  /* ── MOBILE overlay ── */
  .gg-sb-overlay {
    display: none; position: fixed; inset: 0;
    background: rgba(0,0,0,.6); z-index: 499;
  }
  .gg-sb-overlay.open { display: block; }

  /* ── MOBILE toggle button ── */
  .gg-mobile-toggle {
    display: none; position: fixed;
    top: 14px; left: 14px; z-index: 600;
    width: 40px; height: 40px; border-radius: 10px;
    background: var(--bg-card); border: 1px solid var(--border-hi);
    align-items: center; justify-content: center;
    cursor: pointer; color: var(--text-dim);
  }
  .gg-mobile-toggle svg { width: 18px; height: 18px; stroke: currentColor; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }

  @media (max-width: 768px) {
    body { padding-left: 0 !important; padding-top: 60px !important; }
    body.gg-collapsed { padding-left: 0 !important; }
    #gg-sidebar {
      width: var(--sidebar-w) !important;
      transform: translateX(-100%);
      transition: transform .3s ease;
    }
    #gg-sidebar.mobile-open { transform: translateX(0); }
    .gg-mobile-toggle { display: flex; }
    .gg-sb-toggle { display: none; }
  }
`;

  // ── Иконки ──
  const I = {
    hex: `<svg viewBox="0 0 18 18" fill="none"><polygon points="9,1 16,4.5 16,13.5 9,17 2,13.5 2,4.5" stroke="#080c12" stroke-width="1.5"/><circle cx="9" cy="9" r="2.5" fill="#080c12"/></svg>`,
    tournaments: `<svg viewBox="0 0 24 24"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2z"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/></svg>`,
    rating: `<svg viewBox="0 0 24 24"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`,
    faq: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17" stroke-width="2.5"/></svg>`,
    partners: `<svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
    plus: `<svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
    home: `<svg viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,
    user: `<svg viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
    login: `<svg viewBox="0 0 24 24"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>`,
    logout: `<svg viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>`,
    settings: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
    bell: `<svg viewBox="0 0 24 24"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`,
    chevron_down: `<svg class="gg-sb-user-chevron" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>`,
    collapse: `<svg viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg>`,
  };

  // ── Активная страница ──
  function active(page) {
    // Берём имя файла из URL, нормализуем
    let p = window.location.pathname.split('/').pop() || '';
    // Корневой URL "/" или "/index.html" → home
    if (p === '' || p === 'index.html') p = 'index.html';
    const map = {
      home:        ['index.html'],
      tournaments: ['tournaments.html', 'tournament.html', 'tournament-register.html'],
      create:      ['create-tournament.html'],
      organizer:   ['organizer.html'],
      profile:     ['profile.html'],
      faq:         ['faq.html'],
      partners:    ['partners.html'],
      ratings:     ['ratings.html'],
    };
    return (map[page] || []).some(f => p === f) ? ' active' : '';
  }

  // ── Рендер ──
  function render() {
    // Стили
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    // Читаем пользователя
    let user = null;
    try { user = JSON.parse(localStorage.getItem('gg_user')); } catch(e) {}

    const initials = user
      ? (user.full_name || user.username || '?').split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2)
      : '';
    const roleLabel = user
      ? (user.role === 'organizer' ? 'Организатор' : 'Игрок')
      : '';

    // Строим HTML
    const sb = document.createElement('div');
    sb.id = 'gg-sidebar';
    sb.innerHTML = `
      <!-- TOP -->
      <div class="gg-sb-top">
        <a href="/index.html" class="gg-sb-logo">
          <div class="gg-sb-logo-hex">${I.hex}</div>
          <span class="gg-sb-logo-name">GAME GENESIS</span>
        </a>
        <button class="gg-sb-toggle" id="gg-toggle" onclick="window._ggToggle()" title="Свернуть">
          ${I.collapse}
        </button>
      </div>

      <!-- NAV -->
      <nav class="gg-sb-nav">

        <div class="gg-sb-label">Главное</div>

        <a href="/index.html" class="gg-sb-item${active('home')}" data-tip="Главная">
          <span class="gg-sb-icon">${I.home}</span>
          <span class="gg-sb-text">Главная</span>
        </a>

        <a href="/tournaments.html" class="gg-sb-item${active('tournaments')}" data-tip="Турниры">
          <span class="gg-sb-icon">${I.tournaments}</span>
          <span class="gg-sb-text">Турниры</span>
        </a>

        <a href="/ratings.html" class="gg-sb-item${active('ratings')}" data-tip="Рейтинг">
          <span class="gg-sb-icon">${I.rating}</span>
          <span class="gg-sb-text">Рейтинг</span>
        </a>

        <div class="gg-sb-sep"></div>
        <div class="gg-sb-label">Информация</div>

        <a href="/faq.html" class="gg-sb-item${active('faq')}" data-tip="FAQ">
          <span class="gg-sb-icon">${I.faq}</span>
          <span class="gg-sb-text">FAQ</span>
        </a>

        <a href="/organizer.html" class="gg-sb-item${active('organizer')}" data-tip="Панель организатора">
          <span class="gg-sb-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg></span>
          <span class="gg-sb-text">Мои турниры</span>
        </a>
        <a href="/partners.html" class="gg-sb-item${active('partners')}" data-tip="Партнёрам">
          <span class="gg-sb-icon">${I.partners}</span>
          <span class="gg-sb-text">Партнёрам</span>
        </a>

        <div class="gg-sb-sep"></div>

        <a href="/create-tournament.html" class="gg-sb-create${active('create')}" data-tip="Создать турнир">
          <span class="gg-sb-icon">${I.plus}</span>
          <span class="gg-sb-text">Создать турнир</span>
        </a>

        ${user ? `
        <div class="gg-sb-sep"></div>
        <button class="gg-sb-item" onclick="window._ggLogout()" data-tip="Выйти" style="color:var(--red);">
          <span class="gg-sb-icon">${I.logout}</span>
          <span class="gg-sb-text">Выйти</span>
        </button>` : ''}

      </nav>

      <!-- BOTTOM: user / auth -->
      <div class="gg-sb-bottom">
        ${user ? `
          <!-- Dropdown user menu (above) -->
          <div class="gg-sb-user-dd" id="gg-user-dd">
            <div class="gg-dd-head">
              <div class="gg-dd-uname">${user.full_name || user.username}</div>
              <div class="gg-dd-email">${user.email || ''}</div>
            </div>
            <a href="/profile.html" class="gg-dd-link">${I.user} Мой профиль</a>
            <a href="/profile.html#tournaments" class="gg-dd-link">${I.tournaments} Мои турниры</a>
            <a href="/profile.html#notifications" class="gg-dd-link">${I.bell} Уведомления</a>
            <div class="gg-dd-sep"></div>
            <a href="/profile.html#settings" class="gg-dd-link">${I.settings} Настройки</a>
            <button class="gg-dd-link danger" onclick="window._ggLogout()">${I.logout} Выйти</button>
          </div>

          <!-- User button -->
          <a href="/profile.html" class="gg-sb-user" id="gg-user-btn" style="text-decoration:none;">
            <div class="gg-sb-avatar" id="gg-av" style="overflow:hidden;">${user.avatar ? `<img src="${user.avatar}" style="width:100%;height:100%;object-fit:cover;border-radius:9px;">` : initials}</div>
            <div class="gg-sb-user-info">
              <div class="gg-sb-user-name">${user.username}</div>
              <div class="gg-sb-user-role">${roleLabel}</div>
            </div>
          </a>
          <button onclick="window._ggLogout()" style="background:none;border:none;cursor:pointer;padding:6px 8px;border-radius:7px;color:var(--text-muted);transition:.2s;display:flex;align-items:center;gap:6px;font-size:12px;font-family:'Exo 2',sans-serif;width:100%;margin-top:4px;" onmouseover="this.style.color='var(--red)';this.style.background='rgba(248,113,113,.08)'" onmouseout="this.style.color='var(--text-muted)';this.style.background='none'">
            ${I.logout || '<svg viewBox="0 0 24 24" style="width:14px;height:14px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>'}
            Выйти
          </button>
        ` : `
          <div class="gg-sb-auth">
            <a href="/auth.html" class="gg-sb-btn-login">
              ${I.login} <span>Войти</span>
            </a>
            <a href="/auth.html" class="gg-sb-btn-reg">
              ${I.user} <span>Регистрация</span>
            </a>
          </div>
        `}
      </div>
    `;

    // Overlay (mobile)
    const overlay = document.createElement('div');
    overlay.className = 'gg-sb-overlay';
    overlay.id = 'gg-overlay';
    overlay.onclick = () => window._ggCloseMobile();

    // Mobile toggle button
    const mobileBtn = document.createElement('button');
    mobileBtn.className = 'gg-mobile-toggle';
    mobileBtn.id = 'gg-mobile-btn';
    mobileBtn.innerHTML = `<svg viewBox="0 0 24 24"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>`;
    mobileBtn.onclick = () => window._ggOpenMobile();

    document.body.insertBefore(sb, document.body.firstChild);
    document.body.appendChild(overlay);
    document.body.appendChild(mobileBtn);

    // Читаем сохранённое состояние collapsed
    if (localStorage.getItem('gg_nav_collapsed') === '1') {
      document.body.classList.add('gg-collapsed');
    }

    // ── Handlers ──
    window._ggToggle = function() {
      const collapsed = document.body.classList.toggle('gg-collapsed');
      localStorage.setItem('gg_nav_collapsed', collapsed ? '1' : '0');
    };

    window._ggUserMenu = function() {
      const btn = document.getElementById('gg-user-btn');
      const dd = document.getElementById('gg-user-dd');
      if (!btn || !dd) return;
      btn.classList.toggle('open');
      dd.classList.toggle('open');
    };

    window._ggLogout = function() {
      localStorage.removeItem('gg_token');
      localStorage.removeItem('gg_user');
      location.href = '/auth.html';
    };

    window._ggOpenMobile = function() {
      document.getElementById('gg-sidebar').classList.add('mobile-open');
      document.getElementById('gg-overlay').classList.add('open');
    };

    window._ggCloseMobile = function() {
      document.getElementById('gg-sidebar').classList.remove('mobile-open');
      document.getElementById('gg-overlay').classList.remove('open');
    };

    // Закрываем user dropdown при клике вне
    document.addEventListener('click', function(e) {
      const btn = document.getElementById('gg-user-btn');
      const dd = document.getElementById('gg-user-dd');
      if (btn && dd && !btn.contains(e.target) && !dd.contains(e.target)) {
        btn.classList.remove('open');
        dd.classList.remove('open');
      }
    });

    // Убираем старый header/sidebar из DOM если уже отрендерился
    document.querySelectorAll('body > header:not(#gg-sidebar), .page > header').forEach(el => {
      if (el.id !== 'gg-sidebar') el.style.display = 'none';
    });
    document.querySelectorAll('aside.sidebar').forEach(el => el.style.display = 'none');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render);
  } else {
    render();
  }
})();
