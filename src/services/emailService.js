// src/services/emailService.js
// ============================================================
// Serviciu de email folosind Resend
// Documentație: https://resend.com/docs
// ============================================================
// Instalare: npm install resend
// Variabile de environment necesare:
//   RESEND_API_KEY=re_xxxxxxxxx
//   EMAIL_FROM=noreply@domeniu-tau.ro
//   FRONTEND_URL=https://app-url.ro
// ============================================================

import { Resend } from 'resend';

// ✅ Inițializare lazy — nu crăpăm la start dacă API key lipsește
// Setează RESEND_API_KEY în environment variables când ai acces la domeniu
let resend = null;
const getResend = () => {
  if (!process.env.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY lipsește din environment variables');
  }
  if (!resend) {
    resend = new Resend(process.env.RESEND_API_KEY);
  }
  return resend;
};
const FROM = process.env.EMAIL_FROM || 'noreply@adigidmb.ro';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

// ============================================================
// HELPER — template de bază pentru emailuri
// ============================================================
const baseTemplate = (content) => `
<!DOCTYPE html>
<html lang="ro">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SAMD — Sistem de Administrare și Monitorizare a Deșeurilor</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
          
          <!-- HEADER -->
          <tr>
            <td style="background:linear-gradient(135deg,#059669,#0d9488);padding:32px 40px;">
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding-right:14px;vertical-align:middle;">
                    <div style="width:44px;height:44px;background:rgba(255,255,255,0.2);border-radius:12px;display:flex;align-items:center;justify-content:center;text-align:center;line-height:44px;">
                      <span style="color:#ffffff;font-size:22px;font-weight:900;font-family:Arial,sans-serif;">S</span>
                    </div>
                  </td>
                  <td style="vertical-align:middle;">
                    <p style="margin:0;color:#ffffff;font-size:22px;font-weight:900;letter-spacing:-0.5px;">SAMD</p>
                    <p style="margin:3px 0 0;color:rgba(255,255,255,0.8);font-size:12px;">Sistem Avansat de Monitorizare Deșeuri</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- CONTENT -->
          <tr>
            <td style="padding:40px;">
              ${content}
            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td style="background:#f8fafc;padding:24px 40px;border-top:1px solid #e2e8f0;">
              <p style="margin:0;color:#94a3b8;font-size:12px;line-height:1.6;">
                Acest email a fost trimis automat de sistemul SAMD — ADIGIDMB București.<br>
                Te rugăm să nu răspunzi la acest email.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;

// ============================================================
// EMAIL 1 — Cont nou creat (parolă temporară)
// ============================================================
export const sendWelcomeEmail = async ({ to, firstName, lastName, email, temporaryPassword }) => {
  const content = `
    <h2 style="margin:0 0 8px;color:#1e293b;font-size:22px;">Bine ai venit, ${firstName}!</h2>
    <p style="margin:0 0 24px;color:#64748b;font-size:15px;">
      Contul tău a fost creat în sistemul SAMD. Mai jos găsești datele de acces.
    </p>

    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:24px;">
      <tr>
        <td style="padding:20px 24px;">
          <p style="margin:0 0 12px;color:#64748b;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;">Date de autentificare</p>
          <p style="margin:0 0 8px;color:#1e293b;font-size:15px;">
            <strong>Email:</strong> ${email}
          </p>
          <p style="margin:0;color:#1e293b;font-size:15px;">
            <strong>Parolă temporară:</strong>
            <span style="background:#dbeafe;color:#1d4ed8;padding:2px 10px;border-radius:4px;font-family:monospace;font-size:16px;letter-spacing:1px;">
              ${temporaryPassword}
            </span>
          </p>
        </td>
      </tr>
    </table>

    <div style="background:#fef9c3;border:1px solid #fde047;border-radius:8px;padding:16px 20px;margin-bottom:24px;">
      <p style="margin:0;color:#854d0e;font-size:14px;">
        ⚠️ <strong>Important:</strong> La prima autentificare vei fi obligat să îți schimbi parola temporară.
        Alege o parolă sigură pe care nu o folosești în altă parte.
      </p>
    </div>

    <a href="${FRONTEND_URL}" 
       style="display:inline-block;background:#1e40af;color:#ffffff;padding:14px 28px;border-radius:8px;text-decoration:none;font-size:15px;font-weight:bold;">
      Accesează SAMD →
    </a>
  `;

  return getResend().emails.send({
    from: FROM,
    to,
    subject: 'Contul tău SAMD a fost creat',
    html: baseTemplate(content),
  });
};

// ============================================================
// EMAIL 2 — Reset parolă
// ============================================================
export const sendPasswordResetEmail = async ({ to, firstName, resetToken }) => {
  const resetUrl = `${FRONTEND_URL}/reset-password?token=${resetToken}`;

  const content = `
    <h2 style="margin:0 0 8px;color:#1e293b;font-size:22px;">Resetare parolă</h2>
    <p style="margin:0 0 24px;color:#64748b;font-size:15px;">
      Salut, ${firstName}! Am primit o solicitare de resetare a parolei pentru contul tău.
    </p>

    <p style="margin:0 0 16px;color:#475569;font-size:15px;">
      Apasă butonul de mai jos pentru a seta o parolă nouă:
    </p>

    <a href="${resetUrl}"
       style="display:inline-block;background:#1e40af;color:#ffffff;padding:14px 28px;border-radius:8px;text-decoration:none;font-size:15px;font-weight:bold;margin-bottom:24px;">
      Resetează parola →
    </a>

    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px 20px;margin-top:24px;">
      <p style="margin:0;color:#991b1b;font-size:14px;">
        ⏱️ <strong>Link-ul este valabil 1 oră.</strong><br>
        Dacă nu ai solicitat resetarea parolei, ignoră acest email — contul tău este în siguranță.
      </p>
    </div>

    <p style="margin:24px 0 0;color:#94a3b8;font-size:13px;">
      Dacă butonul nu funcționează, copiază și lipește acest link în browser:<br>
      <span style="color:#3b82f6;word-break:break-all;">${resetUrl}</span>
    </p>
  `;

  return getResend().emails.send({
    from: FROM,
    to,
    subject: 'Resetare parolă SAMD',
    html: baseTemplate(content),
  });
};