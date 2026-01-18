// src/middleware/enforceSectorAccess.js
// ============================================================================
// enforceSectorAccess middleware
// - If request contains sector_id (query/body/params), validate access.
// - sector_id can be 1..6 OR UUID.
// - Requires resolveUserAccess to run before it (so req.userAccess exists).
//
// IMPORTANT BUSINESS RULES (per your requirements):
// - Landfill + TMB pages:
//    * PLATFORM_ADMIN => ALL
//    * ADMIN_INSTITUTION => ALL
//    * REGULATOR_VIEWER => ALL
//    * EDITOR_INSTITUTION => PMB ALL, Sector city hall => SECTOR
// - Reports pages:
//    * PLATFORM_ADMIN => ALL
//    * ADMIN_INSTITUTION => PMB ALL, Sector city hall => SECTOR
//    * EDITOR_INSTITUTION => PMB ALL, Sector city hall => SECTOR
//    * REGULATOR_VIEWER => NONE (blocked elsewhere by role guard)
//
// This middleware enforces sector_id only. It does NOT grant access to a route.
// ============================================================================

import pool from "../config/database.js";
import { ROLES } from "../constants/roles.js";

const isUuid = (v) =>
  typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);

const pickSectorId = (req) => {
  return req.query?.sector_id ?? req.body?.sector_id ?? req.params?.sector_id ?? null;
};

// Decide which sector list to enforce depending on route context
const getContextKey = (req) => {
  const base = (req.baseUrl || "").toLowerCase();
  const url = (req.originalUrl || "").toLowerCase();

  // Reports
  if (base.includes("/reports") || url.includes("/api/reports")) return "reports";

  // Institutions / Sectors pages may be sector-scoped for non-PMB institutions
  if (base.includes("/institutions") || url.includes("/api/institutions")) return "institutions";
  if (base.includes("/sectors") || url.includes("/api/sectors")) return "sectors";

  // Tickets / Landfill / TMB etc (main operational pages)
  return "default";
};

const resolveSectorUuid = async (raw) => {
  const rawStr = String(raw).trim();
  const asInt = parseInt(rawStr, 10);

  // 1..6 => map to UUID
  if (!Number.isNaN(asInt) && asInt >= 1 && asInt <= 6) {
    const q = await pool.query(
      `SELECT id
       FROM sectors
       WHERE sector_number = $1 AND is_active = true AND deleted_at IS NULL
       LIMIT 1`,
      [asInt]
    );
    const sectorUuid = q.rows[0]?.id ?? null;
    if (!sectorUuid) return { ok: false, code: 404, message: "Sector inexistent" };
    return { ok: true, sectorUuid };
  }

  // UUID already
  if (isUuid(rawStr)) {
    return { ok: true, sectorUuid: rawStr };
  }

  return { ok: false, code: 400, message: `sector_id invalid: ${rawStr}` };
};

export const enforceSectorAccess = async (req, res, next) => {
  try {
    const access = req.userAccess;
    if (!access) {
      return res.status(500).json({
        success: false,
        message: "Missing req.userAccess (resolveUserAccess not applied)",
      });
    }

    const raw = pickSectorId(req);
    console.log('🔵 enforceSectorAccess - raw sector_id from request:', raw);
    
    if (raw === null || raw === undefined || String(raw).trim() === "") {
      console.log('🔵 enforceSectorAccess - NO sector_id, skipping...');
      return next();
    }

    const ctx = getContextKey(req);

    // Determine allowed sector ids based on role + context
    // Default behavior:
    //  - use access.sectorIds (already computed for the role)
    // Context overrides (especially for ADMIN_INSTITUTION on reports)
    let allowedSectorIds = access.sectorIds || [];

    // PLATFORM_ADMIN & REGULATOR_VIEWER: always ALL sectors (but route role guard decides if reports exist)
    if (req.user?.role === ROLES.PLATFORM_ADMIN || req.user?.role === ROLES.REGULATOR_VIEWER) {
      allowedSectorIds = access.sectorIdsAll || access.sectorIds || [];
    }

    // ADMIN_INSTITUTION:
    // - default pages => allow ALL (sectorIdsAll)
    // - reports/sectors/institutions pages => PMB ALL, otherwise institutionSectorIds
    if (req.user?.role === ROLES.ADMIN_INSTITUTION) {
      if (ctx === "reports" || ctx === "institutions" || ctx === "sectors") {
        const isPMB = !!access.isPMB;
        allowedSectorIds = isPMB
          ? (access.sectorIdsAll || access.sectorIds || [])
          : (access.institutionSectorIds || []);
      } else {
        // landfill/tmb/tickets/main pages
        allowedSectorIds = access.sectorIdsAll || access.sectorIds || [];
      }
    }

    // EDITOR_INSTITUTION:
    // - already computed as ALL (PMB) or SECTOR (sector city hall) in resolveUserAccess
    // - for reports, same list is correct
    if (req.user?.role === ROLES.EDITOR_INSTITUTION) {
      allowedSectorIds = access.sectorIds || access.institutionSectorIds || [];
    }

    // Resolve sector UUID
    const resolved = await resolveSectorUuid(raw);
    if (!resolved.ok) {
      return res.status(resolved.code).json({ success: false, message: resolved.message });
    }

    const { sectorUuid } = resolved;

    // Enforce
    if (!allowedSectorIds.includes(sectorUuid)) {
      return res.status(403).json({ success: false, message: "Nu ai acces la acest sector" });
    }

    // Stash resolved UUID so controllers can use it without extra query
    console.log('🔵 enforceSectorAccess - Setting req.requestedSectorUuid to:', sectorUuid);
    req.requestedSectorUuid = sectorUuid;

    return next();
  } catch (err) {
    console.error("enforceSectorAccess error:", err);
    return res.status(500).json({
      success: false,
      message: "Eroare la verificarea accesului pe sector",
    });
  }
};

export default { enforceSectorAccess };