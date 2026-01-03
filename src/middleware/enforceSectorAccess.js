// src/middleware/enforceSectorAccess.js
// ============================================================================
// enforceSectorAccess middleware
// - If request contains sector_id (query/body/params), validate access.
// - sector_id can be 1..6 OR UUID.
// - Requires resolveUserAccess to run before it (so req.userAccess exists).
// ============================================================================

import pool from '../config/database.js';

const isUuid = (v) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);

const pickSectorId = (req) => {
  return (
    req.query?.sector_id ??
    req.body?.sector_id ??
    req.params?.sector_id ??
    null
  );
};

export const enforceSectorAccess = async (req, res, next) => {
  try {
    const access = req.userAccess;
    if (!access) {
      return res.status(500).json({ success: false, message: 'Missing req.userAccess (resolveUserAccess not applied)' });
    }

    const raw = pickSectorId(req);
    if (raw === null || raw === undefined || String(raw).trim() === '') return next();

    // If access is ALL, no need to block
    if (access.accessLevel === 'ALL') return next();

    // Convert 1..6 -> UUID if needed
    let sectorUuid = null;

    const rawStr = String(raw).trim();
    const asInt = parseInt(rawStr, 10);

    if (!Number.isNaN(asInt) && asInt >= 1 && asInt <= 6) {
      const q = await pool.query(
        `SELECT id FROM sectors WHERE sector_number = $1 AND is_active = true AND deleted_at IS NULL LIMIT 1`,
        [asInt]
      );
      sectorUuid = q.rows[0]?.id ?? null;
      if (!sectorUuid) {
        return res.status(404).json({ success: false, message: 'Sector inexistent' });
      }
    } else if (isUuid(rawStr)) {
      sectorUuid = rawStr;
    } else {
      return res.status(400).json({ success: false, message: `sector_id invalid: ${rawStr}` });
    }

    if (!access.sectorIds?.includes(sectorUuid)) {
      return res.status(403).json({ success: false, message: 'Nu ai acces la acest sector' });
    }

    // Optional: stash resolved UUID so controllers can use it (fără extra query)
    req.requestedSectorUuid = sectorUuid;

    return next();
  } catch (err) {
    console.error('enforceSectorAccess error:', err);
    return res.status(500).json({ success: false, message: 'Eroare la verificarea accesului pe sector' });
  }
};

export default { enforceSectorAccess };
