// src/middleware/enforceSectorAccess.js
const pool = require("../db/pool");

/**
 * Very small UUID v4-ish check (also accepts any canonical UUID).
 * IMPORTANT: UUID strings may start with digits (e.g. "1b7e..."),
 * so DO NOT parseInt() before checking UUID format.
 */
function isUuid(str) {
  if (!str) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(str).trim()
  );
}

/**
 * Resolves sector identifier from request to a sector UUID from DB.
 * Accepts:
 *  - UUID (preferred)
 *  - sector number 1..6 (ONLY if the string is purely numeric)
 */
async function resolveSectorUuid(raw) {
  const rawStr = String(raw ?? "").trim();

  // 1) UUID first (CRITICAL: UUID may start with digits)
  if (isUuid(rawStr)) {
    return { ok: true, sectorUuid: rawStr };
  }

  // 2) Only accept numeric sector numbers if the value is purely numeric
  // (prevents parseInt("1b7e...") === 1 type of bugs)
  if (/^\d+$/.test(rawStr)) {
    const asInt = parseInt(rawStr, 10);
    if (asInt >= 1 && asInt <= 6) {
      const q = await pool.query(
        `SELECT id
         FROM sectors
         WHERE sector_number = $1
           AND is_active = true
           AND deleted_at IS NULL
         LIMIT 1`,
        [asInt]
      );
      const sectorUuid = q.rows[0]?.id ?? null;
      if (!sectorUuid) {
        return { ok: false, code: 404, message: "Sector inexistent" };
      }
      return { ok: true, sectorUuid };
    }
  }

  return { ok: false, code: 400, message: `sector_id invalid: ${rawStr}` };
}

/**
 * Middleware:
 * - If request has sector_id in query/body, resolves it to a UUID and stores it in req.requestedSectorUuid
 * - If user is limited to certain sectors, enforces access
 *
 * Assumptions:
 * - req.user may exist with properties:
 *    - is_admin (boolean)
 *    - sector_id (uuid) or sectors (array of uuids)
 */
async function enforceSectorAccess(req, res, next) {
  try {
    const rawSector =
      (req.query && req.query.sector_id) ||
      (req.body && req.body.sector_id) ||
      null;

    if (rawSector) {
      const resolved = await resolveSectorUuid(rawSector);
      if (!resolved.ok) {
        return res
          .status(resolved.code || 400)
          .json({ success: false, error: resolved.message });
      }
      req.requestedSectorUuid = resolved.sectorUuid;
    }

    // If no auth/user context, just continue
    if (!req.user) return next();

    // Admin can access all sectors
    if (req.user.is_admin) return next();

    // Allowed sectors for this user
    const allowed = [];
    if (req.user.sectors && Array.isArray(req.user.sectors)) {
      allowed.push(...req.user.sectors.filter(Boolean));
    }
    if (req.user.sector_id) allowed.push(req.user.sector_id);

    const allowedSet = new Set(allowed.map(String));

    // If request asked for a sector, enforce it's allowed
    if (req.requestedSectorUuid) {
      if (!allowedSet.has(String(req.requestedSectorUuid))) {
        return res.status(403).json({
          success: false,
          error: "Nu aveți acces la sectorul selectat.",
        });
      }
    } else {
      // If no sector requested but user is limited to one, set it
      if (allowedSet.size === 1) {
        req.requestedSectorUuid = Array.from(allowedSet)[0];
      }
    }

    return next();
  } catch (err) {
    console.error("enforceSectorAccess error:", err);
    return res
      .status(500)
      .json({ success: false, error: "Eroare internă server." });
  }
}

module.exports = enforceSectorAccess;
