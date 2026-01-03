// src/utils/accessControl.js
// ============================================================================
// Helper functions (no RBAC in controllers)
// - Prefer middleware: resolveUserAccess + enforceSectorAccess
// ============================================================================

import pool from '../config/database.js';

export const getSectorIdFromNumber = async (sectorNumber) => {
  const n = parseInt(String(sectorNumber), 10);
  if (Number.isNaN(n) || n < 1 || n > 6) return null;

  const result = await pool.query(
    `SELECT id FROM sectors WHERE sector_number = $1 AND is_active = true AND deleted_at IS NULL LIMIT 1`,
    [n]
  );
  return result.rows[0]?.id ?? null;
};

export const getSectorNumberFromId = async (sectorId) => {
  const result = await pool.query(
    `SELECT sector_number FROM sectors WHERE id = $1 AND is_active = true AND deleted_at IS NULL LIMIT 1`,
    [sectorId]
  );
  return result.rows[0]?.sector_number ?? null;
};

export const getSectorIdsFromNumbers = async (sectorNumbers) => {
  if (!Array.isArray(sectorNumbers) || sectorNumbers.length === 0) return [];

  const cleaned = sectorNumbers
    .map(x => parseInt(String(x), 10))
    .filter(n => !Number.isNaN(n) && n >= 1 && n <= 6);

  if (!cleaned.length) return [];

  const result = await pool.query(
    `SELECT id FROM sectors
     WHERE sector_number = ANY($1)
       AND is_active = true
       AND deleted_at IS NULL
     ORDER BY sector_number`,
    [cleaned]
  );

  return result.rows.map(r => r.id);
};

export default {
  getSectorIdFromNumber,
  getSectorNumberFromId,
  getSectorIdsFromNumbers,
};
