// src/middleware/resolveUserAccess.js
// ============================================================================
// resolveUserAccess middleware
// - Computes visibility scope ONCE and attaches it to req.userAccess
// - Controllers must NOT compute sectors manually anymore.
// ============================================================================

import pool from '../config/database.js';
import { ROLES } from '../constants/roles.js';

export const resolveUserAccess = async (req, res, next) => {
  try {
    if (!req.user?.id || !req.user?.role) {
      return res.status(401).json({ success: false, message: 'Neautentificat' });
    }

    const userId = req.user.id;
    const role = req.user.role;

    // 1) PLATFORM_ADMIN => ALL sectors
    if (role === ROLES.PLATFORM_ADMIN) {
      const s = await pool.query(`SELECT id FROM sectors WHERE is_active = true AND deleted_at IS NULL ORDER BY sector_number`);
      req.userAccess = {
        accessLevel: 'ALL',
        sectorIds: s.rows.map(r => r.id),
        institutionId: null,
        institutionName: 'ADIGIDMB',
        isPMB: false,
        canEditData: true,
      };
      return next();
    }

    // 2) REGULATOR_VIEWER => ALL sectors, no edit
    if (role === ROLES.REGULATOR_VIEWER) {
      const s = await pool.query(`SELECT id FROM sectors WHERE is_active = true AND deleted_at IS NULL ORDER BY sector_number`);
      // Institution optional
      const inst = await pool.query(
        `SELECT i.id, i.name
         FROM user_institutions ui
         JOIN institutions i ON ui.institution_id = i.id
         WHERE ui.user_id = $1
         LIMIT 1`,
        [userId]
      );

      req.userAccess = {
        accessLevel: 'ALL',
        sectorIds: s.rows.map(r => r.id),
        institutionId: inst.rows[0]?.id ?? null,
        institutionName: inst.rows[0]?.name ?? 'Autoritate Publică',
        isPMB: false,
        canEditData: false,
      };
      return next();
    }

    // 3) ADMIN_INSTITUTION / EDITOR_INSTITUTION => sectors from institution_sectors
    if (role === ROLES.ADMIN_INSTITUTION || role === ROLES.EDITOR_INSTITUTION) {
      const inst = await pool.query(
        `SELECT i.id, i.name, i.type
         FROM user_institutions ui
         JOIN institutions i ON ui.institution_id = i.id
         WHERE ui.user_id = $1
         LIMIT 1`,
        [userId]
      );

      if (inst.rows.length === 0) {
        return res.status(403).json({ success: false, message: 'User fără instituție asociată' });
      }

      const institutionId = inst.rows[0].id;
      const institutionName = inst.rows[0].name;

      const sectors = await pool.query(
        `SELECT s.id, s.sector_number
         FROM institution_sectors ins
         JOIN sectors s ON ins.sector_id = s.id
         WHERE ins.institution_id = $1
           AND s.is_active = true
           AND s.deleted_at IS NULL
         ORDER BY s.sector_number`,
        [institutionId]
      );

      const sectorIds = sectors.rows.map(r => r.id);
      const isPMB = sectorIds.length === 6;

      req.userAccess = {
        accessLevel: isPMB ? 'ALL' : 'SECTOR',
        sectorIds,
        institutionId,
        institutionName,
        isPMB,
        canEditData: false,
      };

      return next();
    }

    // Unknown role
    return res.status(403).json({ success: false, message: `Rol necunoscut: ${role}` });
  } catch (err) {
    console.error('resolveUserAccess error:', err);
    return res.status(500).json({ success: false, message: 'Eroare la calculul accesului (resolveUserAccess)' });
  }
};

export default { resolveUserAccess };
