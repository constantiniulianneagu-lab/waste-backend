// src/controllers/authController.js
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import pool from '../config/database.js';
import { resolveUserAccess } from '../middleware/resolveUserAccess.js';

const IS_PROD = process.env.NODE_ENV === 'production';

// ============================================================
// CONFIGURARE
// ============================================================
const LOCKOUT_MAX_ATTEMPTS = 10;       // blocat după 10 încercări eșuate
const LOCKOUT_DURATION_MIN = 30;       // blocat 30 de minute

// ============================================================
// HELPER — log doar în dev
// ============================================================
const devLog = (...args) => {
  if (!IS_PROD) console.log(...args);
};

// ============================================================
// HELPER — audit log
// ============================================================
const writeAuditLog = async ({ userId, action, entityType, entityId, ip, userAgent, details }) => {
  try {
    await pool.query(
      `INSERT INTO audit_log (user_id, action, entity_type, entity_id, ip_address, user_agent, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        userId ?? null,
        action,
        entityType ?? null,
        entityId ?? null,
        ip ?? null,
        userAgent ?? null,
        details ? JSON.stringify(details) : null,
      ]
    );
  } catch (err) {
    // Audit log nu trebuie să blocheze fluxul principal
    console.error('[AuditLog] Eroare la scriere:', err.message);
  }
};

// ============================================================
// HELPER — computeUserAccess
// ============================================================
const computeUserAccess = async (userId, role) => {
  const mockReq = { user: { id: userId, role } };
  const mockRes = {
    status: (code) => ({
      json: (data) => {
        throw new Error(`resolveUserAccess status(${code}): ${JSON.stringify(data)}`);
      },
    }),
  };
  const mockNext = () => {};

  try {
    await resolveUserAccess(mockReq, mockRes, mockNext);
    return mockReq.userAccess ?? null;
  } catch (err) {
    console.error('[computeUserAccess] Eroare:', err.message);
    return null;
  }
};

// ============================================================
// HELPER — generează tokens cu jti
// jti (JWT ID) = UUID unic salvat și în DB pentru lookup O(1)
// ============================================================
const generateTokens = (userId, email, role) => {
  const jti = randomUUID();

  const accessToken = jwt.sign(
    { id: userId, email, role },
    process.env.JWT_SECRET,
    { expiresIn: '15m' }
  );

  const refreshToken = jwt.sign(
    { id: userId, email, jti },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: '7d' }
  );

  return { accessToken, refreshToken, jti };
};

// ============================================================
// LOGIN
// ============================================================
export const login = async (req, res) => {
  const ip = req.ip;
  const userAgent = req.headers['user-agent'] ?? 'unknown';

  try {
    const { email, password } = req.body;

    // Validare input
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email și parola sunt obligatorii',
      });
    }

    // Găsește user în DB
    const result = await pool.query(
      `SELECT id, email, first_name, last_name, role, is_active,
              password_hash, failed_login_attempts, locked_until
       FROM users
       WHERE email = $1 AND deleted_at IS NULL`,
      [email.toLowerCase().trim()]
    );

    // Răspuns generic — nu dezvăluim dacă email-ul există
    if (result.rows.length === 0) {
      await writeAuditLog({
        action: 'LOGIN_FAILED',
        ip,
        userAgent,
        details: { reason: 'user_not_found', email: email.toLowerCase().trim() },
      });
      return res.status(401).json({
        success: false,
        message: 'Email sau parolă greșită',
      });
    }

    const user = result.rows[0];

    // Verifică dacă contul e blocat
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      const minutesLeft = Math.ceil(
        (new Date(user.locked_until) - new Date()) / 1000 / 60
      );
      await writeAuditLog({
        userId: user.id,
        action: 'LOGIN_BLOCKED',
        ip,
        userAgent,
        details: { reason: 'account_locked', minutes_left: minutesLeft },
      });
      return res.status(423).json({
        success: false,
        message: `Contul este blocat temporar. Încearcă din nou în ${minutesLeft} minute.`,
      });
    }

    // Verifică dacă user e activ
    if (!user.is_active) {
      await writeAuditLog({
        userId: user.id,
        action: 'LOGIN_FAILED',
        ip,
        userAgent,
        details: { reason: 'account_inactive' },
      });
      return res.status(403).json({
        success: false,
        message: 'Contul este dezactivat. Contactați administratorul.',
      });
    }

    // Verifică parola
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);

    if (!isPasswordValid) {
      const newAttempts = (user.failed_login_attempts ?? 0) + 1;
      const shouldLock = newAttempts >= LOCKOUT_MAX_ATTEMPTS;

      await pool.query(
        `UPDATE users
         SET failed_login_attempts = $1,
             locked_until = $2
         WHERE id = $3`,
        [
          newAttempts,
          shouldLock
            ? new Date(Date.now() + LOCKOUT_DURATION_MIN * 60 * 1000)
            : null,
          user.id,
        ]
      );

      await writeAuditLog({
        userId: user.id,
        action: 'LOGIN_FAILED',
        ip,
        userAgent,
        details: { reason: 'wrong_password', attempt: newAttempts, locked: shouldLock },
      });

      if (shouldLock) {
        console.warn(`[Login] Cont blocat: ${user.email} (${newAttempts} încercări) IP: ${ip}`);
        return res.status(423).json({
          success: false,
          message: `Prea multe încercări eșuate. Contul a fost blocat ${LOCKOUT_DURATION_MIN} minute.`,
        });
      }

      const attemptsLeft = LOCKOUT_MAX_ATTEMPTS - newAttempts;
      return res.status(401).json({
        success: false,
        message: `Email sau parolă greșită. Mai ai ${attemptsLeft} încercări.`,
      });
    }

    // Parolă corectă — resetează contorul
    await pool.query(
      `UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = $1`,
      [user.id]
    );

    // Generează tokens cu jti
    const { accessToken, refreshToken, jti } = generateTokens(
      user.id,
      user.email,
      user.role
    );

    // Salvează refresh token HASHED + jti în DB
    const refreshTokenHash = await bcrypt.hash(refreshToken, 10);
    await pool.query(
      `INSERT INTO refresh_tokens (user_id, token, jti, expires_at)
       VALUES ($1, $2, $3, NOW() + INTERVAL '7 days')`,
      [user.id, refreshTokenHash, jti]
    );

    // Audit log — login reușit
    await writeAuditLog({
      userId: user.id,
      action: 'LOGIN_SUCCESS',
      ip,
      userAgent,
      details: { role: user.role },
    });

    devLog(`[Login] Success: ${user.email} (${user.role}) IP: ${ip}`);

    const userAccess = await computeUserAccess(user.id, user.role);

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        user: {
          id: user.id,
          email: user.email,
          firstName: user.first_name,
          lastName: user.last_name,
          role: user.role,
          userAccess,
        },
        accessToken,
        refreshToken,
      },
    });

  } catch (error) {
    console.error('[Login] Eroare:', error.message);
    res.status(500).json({
      success: false,
      message: 'Eroare la autentificare',
    });
  }
};

// ============================================================
// LOGOUT
// ============================================================
export const logout = async (req, res) => {
  const ip = req.ip;
  const userAgent = req.headers['user-agent'] ?? 'unknown';

  try {
    const { refreshToken: token } = req.body;

    if (token) {
      try {
        const decoded = jwt.decode(token);
        if (decoded?.jti) {
          // ✅ Șterge exact token-ul curent după jti — O(1)
          await pool.query(
            'DELETE FROM refresh_tokens WHERE jti = $1',
            [decoded.jti]
          );
        }
      } catch {
        // Token malformat — ignorăm
      }

      // Housekeeping — curăță token-uri expirate
      await pool.query('DELETE FROM refresh_tokens WHERE expires_at < NOW()');
    }

    const userId = req.user?.id ?? null;
    await writeAuditLog({
      userId,
      action: 'LOGOUT',
      ip,
      userAgent,
    });

    res.json({ success: true, message: 'Logout successful' });

  } catch (error) {
    console.error('[Logout] Eroare:', error.message);
    res.status(500).json({ success: false, message: 'Eroare la logout' });
  }
};

// ============================================================
// REFRESH TOKEN — cu rotație + jti
// ============================================================
export const refreshToken = async (req, res) => {
  try {
    const { refreshToken: token } = req.body;

    if (!token) {
      return res.status(400).json({
        success: false,
        message: 'Refresh token lipsește',
      });
    }

    // Verifică JWT signature + extrage jti
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET);
    } catch {
      return res.status(401).json({
        success: false,
        message: 'Refresh token invalid sau expirat',
      });
    }

    const { id: userId, jti } = decoded;

    if (!jti) {
      return res.status(401).json({
        success: false,
        message: 'Token format invalid. Te rugăm să te autentifici din nou.',
      });
    }

    // ✅ Lookup direct după jti — O(1), fără loop
    const result = await pool.query(
      `SELECT rt.id, rt.token, rt.user_id, rt.jti,
              u.email, u.role, u.is_active, u.deleted_at
       FROM refresh_tokens rt
       JOIN users u ON rt.user_id = u.id
       WHERE rt.jti = $1 AND rt.expires_at > NOW()`,
      [jti]
    );

    if (result.rows.length === 0) {
      // jti valid în JWT dar absent în DB → posibil token reutilizat/furat
      await pool.query('DELETE FROM refresh_tokens WHERE user_id = $1', [userId]);
      await writeAuditLog({
        userId,
        action: 'TOKEN_REUSE_DETECTED',
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        details: { jti },
      });
      console.warn(`[RefreshToken] Token reuse detectat pentru user ${userId} — toate sesiunile revocate.`);
      return res.status(401).json({
        success: false,
        message: 'Sesiune invalidă. Te rugăm să te autentifici din nou.',
      });
    }

    const tokenData = result.rows[0];

    if (tokenData.deleted_at || !tokenData.is_active) {
      await pool.query('DELETE FROM refresh_tokens WHERE user_id = $1', [userId]);
      return res.status(403).json({
        success: false,
        message: 'Contul este dezactivat.',
      });
    }

    // Double-check hash
    const isHashValid = await bcrypt.compare(token, tokenData.token);
    if (!isHashValid) {
      await pool.query('DELETE FROM refresh_tokens WHERE user_id = $1', [userId]);
      console.warn(`[RefreshToken] Hash invalid pentru jti ${jti} — toate sesiunile revocate.`);
      return res.status(401).json({
        success: false,
        message: 'Sesiune invalidă. Te rugăm să te autentifici din nou.',
      });
    }

    // ✅ ROTAȚIE — tokens noi cu jti nou
    const {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      jti: newJti,
    } = generateTokens(tokenData.user_id, tokenData.email, tokenData.role);

    const newHash = await bcrypt.hash(newRefreshToken, 10);

    // Tranzacție atomică: șterge vechi, inserează nou
    await pool.query('BEGIN');
    try {
      await pool.query('DELETE FROM refresh_tokens WHERE id = $1', [tokenData.id]);
      await pool.query(
        `INSERT INTO refresh_tokens (user_id, token, jti, expires_at)
         VALUES ($1, $2, $3, NOW() + INTERVAL '7 days')`,
        [tokenData.user_id, newHash, newJti]
      );
      await pool.query('COMMIT');
    } catch (txErr) {
      await pool.query('ROLLBACK');
      throw txErr;
    }

    devLog(`[RefreshToken] Rotație OK pentru user ${tokenData.user_id}`);

    res.json({
      success: true,
      data: {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
      },
    });

  } catch (error) {
    console.error('[RefreshToken] Eroare:', error.message);
    res.status(500).json({ success: false, message: 'Eroare la refresh token' });
  }
};

// ============================================================
// GET CURRENT USER
// ============================================================
export const getCurrentUser = async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await pool.query(
      `SELECT id, email, first_name, last_name, role, is_active, created_at
       FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User negăsit' });
    }

    const user = result.rows[0];

    const [userAccess, institutionsResult] = await Promise.all([
      computeUserAccess(user.id, user.role),
      pool.query(
        `SELECT i.id, i.name, i.type, i.sector
         FROM institutions i
         JOIN user_institutions ui ON i.id = ui.institution_id
         WHERE ui.user_id = $1 AND ui.deleted_at IS NULL AND i.deleted_at IS NULL`,
        [userId]
      ),
    ]);

    res.json({
      success: true,
      data: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role,
        isActive: user.is_active,
        createdAt: user.created_at,
        institutions: institutionsResult.rows,
        userAccess,
      },
    });

  } catch (error) {
    console.error('[GetCurrentUser] Eroare:', error.message);
    res.status(500).json({ success: false, message: 'Eroare la obținerea datelor user' });
  }
};