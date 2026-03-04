// src/controllers/passwordController.js
// ============================================================
// Gestionează:
//  1. Forgot password  — trimite email cu link de reset
//  2. Reset password   — validează token și setează parolă nouă
//  3. Force change     — schimbă parola temporară la primul login
// ============================================================
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import pool from '../config/database.js';
import { sendPasswordResetEmail } from '../services/emailService.js';

const IS_PROD = process.env.NODE_ENV === 'production';

// ============================================================
// FORGOT PASSWORD
// POST /api/auth/forgot-password
// Body: { email }
// ============================================================
export const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email-ul este obligatoriu',
      });
    }

    // ✅ Răspuns IDENTIC indiferent dacă emailul există sau nu
    // Nu dezvăluim ce conturi există în sistem
    const GENERIC_RESPONSE = {
      success: true,
      message: 'Dacă adresa de email există în sistem, vei primi un email cu instrucțiuni de resetare.',
    };

    const result = await pool.query(
      `SELECT id, first_name, last_name, email, is_active
       FROM users
       WHERE email = $1 AND deleted_at IS NULL`,
      [email.toLowerCase().trim()]
    );

    // Chiar dacă emailul nu există, returnăm același răspuns
    if (result.rows.length === 0) {
      return res.json(GENERIC_RESPONSE);
    }

    const user = result.rows[0];

    if (!user.is_active) {
      // Cont dezactivat — răspuns generic, nu dezvăluim că e dezactivat
      return res.json(GENERIC_RESPONSE);
    }

    // Generează token unic
    const resetToken = randomUUID();
    const tokenHash = await bcrypt.hash(resetToken, 10);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 oră

    // Invalidează token-urile anterioare ale userului (curăță token-uri vechi)
    await pool.query(
      `DELETE FROM password_reset_tokens
       WHERE user_id = $1`,
      [user.id]
    );

    // Salvează token-ul nou hashed
    await pool.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [user.id, tokenHash, expiresAt]
    );

    // Trimite emailul (best effort — nu blocăm dacă emailul eșuează)
    try {
      await sendPasswordResetEmail({
        to: user.email,
        firstName: user.first_name,
        resetToken,
      });
    } catch (emailErr) {
      console.error('[ForgotPassword] Eroare trimitere email:', emailErr.message);
      // Ștergem token-ul dacă emailul nu s-a trimis
      await pool.query(
        `DELETE FROM password_reset_tokens WHERE user_id = $1`,
        [user.id]
      );
      // Returnăm eroare mai specifică doar dacă nu e producție
      if (!IS_PROD) {
        return res.status(500).json({
          success: false,
          message: 'Eroare la trimiterea emailului: ' + emailErr.message,
        });
      }
      return res.status(500).json({
        success: false,
        message: 'Eroare la trimiterea emailului. Te rugăm să contactezi administratorul.',
      });
    }

    return res.json(GENERIC_RESPONSE);

  } catch (error) {
    console.error('[ForgotPassword] Eroare:', error.message);
    res.status(500).json({
      success: false,
      message: 'Eroare internă server',
    });
  }
};

// ============================================================
// RESET PASSWORD — validează token din email și setează parolă nouă
// POST /api/auth/reset-password
// Body: { token, newPassword }
// ============================================================
export const resetPassword = async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Token-ul și parola nouă sunt obligatorii',
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'Parola trebuie să aibă minim 8 caractere',
      });
    }

    // Caută toate token-urile active (neexpirate, nefolosite)
    const result = await pool.query(
      `SELECT prt.id, prt.user_id, prt.token_hash,
              u.email, u.first_name, u.is_active
       FROM password_reset_tokens prt
       JOIN users u ON prt.user_id = u.id
       WHERE prt.expires_at > NOW()
         AND prt.used_at IS NULL
         AND u.deleted_at IS NULL`,
    );

    if (result.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Link-ul de resetare este invalid sau a expirat',
      });
    }

    // Verifică hash-ul față de toate token-urile active
    // (în practică un user are maxim 1 token activ)
    let matchedToken = null;
    for (const row of result.rows) {
      const isMatch = await bcrypt.compare(token, row.token_hash);
      if (isMatch) {
        matchedToken = row;
        break;
      }
    }

    if (!matchedToken) {
      return res.status(400).json({
        success: false,
        message: 'Link-ul de resetare este invalid sau a expirat',
      });
    }

    if (!matchedToken.is_active) {
      return res.status(403).json({
        success: false,
        message: 'Contul este dezactivat. Contactați administratorul.',
      });
    }

    const newPasswordHash = await bcrypt.hash(newPassword, 10);

    // Tranzacție: actualizează parola + marchează token-ul ca folosit
    await pool.query('BEGIN');
    try {
      await pool.query(
        `UPDATE users
         SET password_hash = $1,
             must_change_password = false,
             failed_login_attempts = 0,
             locked_until = NULL,
             updated_at = NOW()
         WHERE id = $2`,
        [newPasswordHash, matchedToken.user_id]
      );

      await pool.query(
        `UPDATE password_reset_tokens
         SET used_at = NOW()
         WHERE id = $1`,
        [matchedToken.id]
      );

      // Revocă toate sesiunile active (forțează re-login)
      await pool.query(
        `DELETE FROM refresh_tokens WHERE user_id = $1`,
        [matchedToken.user_id]
      );

      await pool.query('COMMIT');
    } catch (txErr) {
      await pool.query('ROLLBACK');
      throw txErr;
    }

    return res.json({
      success: true,
      message: 'Parola a fost resetată cu succes. Te poți autentifica cu noua parolă.',
    });

  } catch (error) {
    console.error('[ResetPassword] Eroare:', error.message);
    res.status(500).json({
      success: false,
      message: 'Eroare internă server',
    });
  }
};

// ============================================================
// FORCE CHANGE PASSWORD — la primul login (must_change_password = true)
// POST /api/auth/change-password
// Body: { currentPassword, newPassword }
// Necesită: authenticateToken
// ============================================================
export const forceChangePassword = async (req, res) => {
  try {
    const userId = req.user.id;
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Parola curentă și parola nouă sunt obligatorii',
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'Parola nouă trebuie să aibă minim 8 caractere',
      });
    }

    const result = await pool.query(
      `SELECT id, password_hash, must_change_password
       FROM users
       WHERE id = $1 AND deleted_at IS NULL`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User negăsit' });
    }

    const user = result.rows[0];

    // Verifică parola curentă (temporară)
    const isMatch = await bcrypt.compare(currentPassword, user.password_hash);
    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: 'Parola curentă este incorectă',
      });
    }

    // Nu permite să seteze aceeași parolă
    const isSamePassword = await bcrypt.compare(newPassword, user.password_hash);
    if (isSamePassword) {
      return res.status(400).json({
        success: false,
        message: 'Parola nouă nu poate fi identică cu parola temporară',
      });
    }

    const newPasswordHash = await bcrypt.hash(newPassword, 10);

    await pool.query(
      `UPDATE users
       SET password_hash = $1,
           must_change_password = false,
           updated_at = NOW()
       WHERE id = $2`,
      [newPasswordHash, userId]
    );

    return res.json({
      success: true,
      message: 'Parola a fost schimbată cu succes',
    });

  } catch (error) {
    console.error('[ForceChangePassword] Eroare:', error.message);
    res.status(500).json({
      success: false,
      message: 'Eroare internă server',
    });
  }
};

// ============================================================
// VALIDATE RESET TOKEN — verifică dacă token-ul din URL e valid
// GET /api/auth/reset-password/validate?token=UUID
// Folosit de frontend să știe dacă afișează formularul sau eroarea
// ============================================================
export const validateResetToken = async (req, res) => {
  try {
    const { token } = req.query;

    if (!token) {
      return res.status(400).json({ success: false, message: 'Token lipsă' });
    }

    const result = await pool.query(
      `SELECT prt.id, prt.token_hash
       FROM password_reset_tokens prt
       JOIN users u ON prt.user_id = u.id
       WHERE prt.expires_at > NOW()
         AND prt.used_at IS NULL
         AND u.deleted_at IS NULL`,
    );

    if (result.rows.length === 0) {
      return res.json({ success: false, valid: false });
    }

    let isValid = false;
    for (const row of result.rows) {
      const isMatch = await bcrypt.compare(token, row.token_hash);
      if (isMatch) { isValid = true; break; }
    }

    return res.json({ success: true, valid: isValid });

  } catch (error) {
    console.error('[ValidateResetToken] Eroare:', error.message);
    res.status(500).json({ success: false, message: 'Eroare internă server' });
  }
};