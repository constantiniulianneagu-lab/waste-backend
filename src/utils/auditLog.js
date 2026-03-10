// src/utils/auditLog.js
import pool from '../config/database.js';

export const writeAuditLog = async ({ userId, action, entityType, entityId, ip, userAgent, details }) => {
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