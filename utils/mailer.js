const nodemailer = require('nodemailer')

const transporter = nodemailer.createTransport({
  host: 'smtp.mail.ru',
  port: 465,
  secure: true,
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS
  }
})

async function sendVerificationCode(toEmail, code, username) {
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#080c12;font-family:'Segoe UI',Arial,sans-serif;">
  <div style="max-width:480px;margin:40px auto;padding:0 20px;">

    <!-- Header -->
    <div style="text-align:center;padding:32px 0 24px;">
      <div style="font-size:13px;font-weight:700;letter-spacing:3px;color:#5c7090;text-transform:uppercase;margin-bottom:8px;">GAME GENESIS</div>
      <div style="font-family:Arial,sans-serif;font-size:28px;font-weight:900;color:#fff;letter-spacing:-0.5px;">Подтверждение<br><span style="color:#f0c040;">email</span></div>
    </div>

    <!-- Card -->
    <div style="background:#0d1420;border:1px solid #1a2436;border-radius:16px;padding:32px;text-align:center;">
      <p style="color:#5c7090;font-size:15px;margin:0 0 24px;">
        Привет, <strong style="color:#dde4ef;">${username}</strong>!<br>
        Введи этот код на сайте для подтверждения аккаунта:
      </p>

      <!-- Code -->
      <div style="background:#080c12;border:2px solid rgba(240,192,64,0.3);border-radius:12px;padding:20px;margin:0 0 24px;">
        <div style="font-family:'Courier New',monospace;font-size:42px;font-weight:900;letter-spacing:14px;color:#f0c040;">${code}</div>
      </div>

      <p style="color:#2e3f58;font-size:13px;margin:0;">
        Код действителен <strong style="color:#5c7090;">10 минут</strong><br>
        Если ты не регистрировался — просто проигнорируй это письмо
      </p>
    </div>

    <!-- Footer -->
    <div style="text-align:center;padding:20px 0;color:#1a2436;font-size:11px;">
      © 2025 Game Genesis · Киберспортивная платформа ЧР
    </div>

  </div>
</body>
</html>`

  await transporter.sendMail({
    from: `"Game Genesis" <${process.env.MAIL_USER}>`,
    to: toEmail,
    subject: `${code} — код подтверждения Game Genesis`,
    html
  })
}

async function sendPasswordReset(toEmail, code, username) {
  const html = `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#080c12;font-family:'Segoe UI',Arial,sans-serif;">
  <div style="max-width:480px;margin:40px auto;padding:0 20px;">
    <div style="text-align:center;padding:32px 0 24px;">
      <div style="font-size:13px;font-weight:700;letter-spacing:3px;color:#5c7090;text-transform:uppercase;margin-bottom:8px;">GAME GENESIS</div>
      <div style="font-size:28px;font-weight:900;color:#fff;">Сброс <span style="color:#f0c040;">пароля</span></div>
    </div>
    <div style="background:#0d1420;border:1px solid #1a2436;border-radius:16px;padding:32px;text-align:center;">
      <p style="color:#5c7090;font-size:15px;margin:0 0 24px;">
        Привет, <strong style="color:#dde4ef;">${username}</strong>!<br>
        Код для сброса пароля:
      </p>
      <div style="background:#080c12;border:2px solid rgba(248,113,113,0.3);border-radius:12px;padding:20px;margin:0 0 24px;">
        <div style="font-family:'Courier New',monospace;font-size:42px;font-weight:900;letter-spacing:14px;color:#f87171;">${code}</div>
      </div>
      <p style="color:#2e3f58;font-size:13px;margin:0;">Код действителен 10 минут</p>
    </div>
  </div>
</body>
</html>`

  await transporter.sendMail({
    from: `"Game Genesis" <${process.env.MAIL_USER}>`,
    to: toEmail,
    subject: `${code} — сброс пароля Game Genesis`,
    html
  })
}

module.exports = { sendVerificationCode, sendPasswordReset }
