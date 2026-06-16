const https = require('https')

async function sendVerificationCode(to, code, username) {
  const fromDomain = process.env.MAILERSEND_DOMAIN || 'test-vz9dlem65zq4kj50.mlsender.net'
  
  const data = JSON.stringify({
    from: { email: `noreply@${fromDomain}`, name: 'Game Genesis' },
    to: [{ email: to }],
    subject: 'Код подтверждения — Game Genesis',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;background:#080c12;color:#fff;border-radius:12px;overflow:hidden;">
        <div style="background:#f0c040;padding:20px 28px;">
          <div style="font-size:22px;font-weight:900;color:#080c12;letter-spacing:2px;">GAME GENESIS</div>
          <div style="font-size:12px;color:#080c12;opacity:.7;margin-top:2px;">ESPORTS PLATFORM · ЧР</div>
        </div>
        <div style="padding:28px;">
          <div style="font-size:16px;margin-bottom:8px;">Привет, <b>${username}</b>!</div>
          <div style="color:#7a9cc4;font-size:14px;margin-bottom:24px;">Твой код подтверждения для регистрации:</div>
          <div style="background:#0f1e35;border:2px solid #f0c040;border-radius:10px;padding:20px;text-align:center;margin-bottom:24px;">
            <div style="font-size:42px;font-weight:900;letter-spacing:10px;color:#f0c040;">${code}</div>
          </div>
          <div style="color:#4a6a8a;font-size:12px;">Код действует 10 минут. Если ты не регистрировался — просто проигнорируй.</div>
        </div>
        <div style="background:#0a1428;padding:14px 28px;text-align:center;">
          <div style="color:#1e3a5f;font-size:11px;">game-genesis-production.up.railway.app</div>
        </div>
      </div>
    `
  })

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.mailersend.com',
      path: '/v1/email',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.MAILERSEND_API_KEY}`,
        'Content-Length': Buffer.byteLength(data)
      }
    }, (res) => {
      let body = ''
      res.on('data', chunk => body += chunk)
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve()
        } else {
          reject(new Error(`MailerSend error: ${res.statusCode} ${body}`))
        }
      })
    })
    req.on('error', reject)
    req.write(data)
    req.end()
  })
}

module.exports = { sendVerificationCode }
