const { Resend } = require('resend')
const resend = new Resend(process.env.RESEND_API_KEY)

async function sendVerificationCode(toEmail, code, username) {
  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#080c12;font-family:'Segoe UI',Arial,sans-serif;">
  <div style="max-width:480px;margin:40px auto;padding:0 20px;">
    <div style="text-align:center;padding:32px 0 24px;">
      <div style="font-size:13px;font-weight:700;letter-spacing:3px;color:#5c7090;text-transform:uppercase;margin-bottom:8px;">GAME GENESIS</div>
      <div style="font-size:28px;font-weight:900;color:#fff;">Подтверждение <span style="color:#f0c040;">email</span></div>
    </div>
    <div style="background:#0d1420;border:1px solid #1a2436;border-radius:16px;padding:32px;text-align:center;">
      <p style="color:#5c7090;font-size:15px;margin:0 0 24px;">
        Привет, <strong style="color:#dde4ef;">${username}</strong>!<br>
        Введи этот код для подтверждения аккаунта:
      </p>
      <div style="background:#080c12;border:2px solid rgba(240,192,64,0.3);border-radius:12px;padding:20px;margin:0 0 24px;">
        <div style="font-family:'Courier New',monospace;font-size:42px;font-weight:900;letter-spacing:14px;color:#f0c040;">${code}</div>
      </div>
      <p style="color:#2e3f58;font-size:13px;margin:0;">
        Код действителен <strong style="color:#5c7090;">10 минут</strong><br>
        Если ты не регистрировался — просто проигнорируй это письмо
      </p>
    </div>
    <div style="text-align:center;padding:20px 0;color:#1a2436;font-size:11px;">
      © 2025 Game Genesis · Киберспортивная платформа ЧР
    </div>
  </div>
</body>
</html>`

  const { error } = await resend.emails.send({
    from: 'Game Genesis <onboarding@resend.dev>',
    to: toEmail,
    subject: `${code} — код подтверждения Game Genesis`,
    html
  })

  if (error) throw new Error(error.message)
}

async function sendPasswordReset(toEmail, code, username) {
  const { error } = await resend.emails.send({
    from: 'Game Genesis <onboarding@resend.dev>',
    to: toEmail,
    subject: `${code} — сброс пароля Game Genesis`,
    html: `<div style="font-family:Arial;text-align:center;padding:40px;background:#080c12;color:#fff;">
      <h2 style="color:#f0c040;">Game Genesis</h2>
      <p>Привет, ${username}! Код для сброса пароля:</p>
      <div style="font-size:36px;font-weight:900;letter-spacing:12px;color:#f87171;padding:20px;background:#0d1420;border-radius:12px;margin:20px 0;">${code}</div>
      <p style="color:#5c7090;font-size:13px;">Код действителен 10 минут</p>
    </div>`
  })
  if (error) throw new Error(error.message)
}

module.exports = { sendVerificationCode, sendPasswordReset }
