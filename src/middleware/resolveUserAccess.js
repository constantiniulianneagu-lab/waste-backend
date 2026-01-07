// src/middleware/resolveUserAccess.js
// ============================================================================
// resolveUserAccess middleware
// - Computes visibility scope ONCE and attaches it to req.userAccess
// - Adds BOTH:
//   - sectorIdsAll: all Bucharest sectors (1..6)
//   - institutionSectorIds: sectors mapped to the user's institution (if any)
// - This lets you implement your requirements correctly:
//   * Landfill + TMB pages: ADMIN_INSTITUTION = FULL access (use sectorIdsAll)
//   * Reports: ADMIN_INSTITUTION PMB = ALL, Sector city hall = only its sectors (use institutionSectorIds)
// ============================================================================

import pool from "../config/database.js";
import { ROLES } from "../constants/roles.js";

// ============================================================================
// PURE FUNCTION: Calculate userAccess without Express dependencies
// ============================================================================
export const calculateUserAccess = async (userId, role) => {
  // Helper: fetch ALL sectors (București 1..6)
  const allSectorsQ = await pool.query(
    `SELECT id, sector_number
     FROM sectors
     WHERE is_active = true AND deleted_at IS NULL
     ORDER BY sector_number`
  );
  const sectorIdsAll = allSectorsQ.rows.map((r) => r.id);

  // Helper: fetch user's institution (optional for some roles)
  const instQ = await pool.query(
    `SELECT i.id, i.name, i.type, i.short_name
     FROM user_institutions ui
     JOIN institutions i ON ui.institution_id = i.id
     WHERE ui.user_id = $1
     LIMIT 1`,
    [userId]
  );

  const institutionId = instQ.rows[0]?.id ?? null;
  const institutionName = instQ.rows[0]?.name ?? null;
  const institutionType = instQ.rows[0]?.type ?? null;

  // Helper: fetch sectors mapped to institution (if institution exists)
  let institutionSectorIds = [];
  if (institutionId) {
      const sectorsQ = await pool.query(
        `SELECT s.id, s.sector_number
         FROM institution_sectors ins
         JOIN sectors s ON ins.sector_id = s.id
         WHERE ins.institution_id = $1
           AND s.is_active = true
           AND s.deleted_at IS NULL
         ORDER BY s.sector_number`,
        [institutionId]
      );
      institutionSectorIds = sectorsQ.rows.map((r) => r.id);
    }

    // PMB detection (best effort):
    // - If institution has all 6 sectors mapped => PMB-like access for sector-scoped pages
    // - IMPORTANT: This does NOT affect LANDFILL/TMB for ADMIN_INSTITUTION (they must be FULL)
    const isPMB = institutionSectorIds.length === 6;

    // 1) PLATFORM_ADMIN => ALL sectors, can edit
    if (role === ROLES.PLATFORM_ADMIN) {
      req.userAccess = {
        role,
        userId,
        accessLevel: "ALL",
        sectorIdsAll,
        sectorIds: sectorIdsAll, // backward compatible
        institutionSectorIds: sectorIdsAll,
        visibleSectorIds: sectorIdsAll,
        institutionId: institutionId || null,
        institutionName: institutionName || "ADIGIDMB",
        institutionType: institutionType || "ASSOCIATION",
        isPMB: false,
        canEditData: true,
        canCreateData: true,
        canDeleteData: true,
        canExportData: true,

        // Per-page scopes (explicit, so requirements are clear)
        scopes: {
          landfill: "ALL",
          tmb: "ALL",
          reports: "ALL",
          sectors: "ALL",
          profileContracts: "ALL",
          institutions: "ALL",
          users: "ALL",
        },
      };
      return next();
    }

    // 2) REGULATOR_VIEWER => ALL sectors, no edit, NO reports & NO profile contracts section (per requirements)
    if (role === ROLES.REGULATOR_VIEWER) {
      req.userAccess = {
        role,
        userId,
        accessLevel: "ALL",
        sectorIdsAll,
        sectorIds: sectorIdsAll, // backward compatible
        institutionSectorIds: sectorIdsAll,
        visibleSectorIds: sectorIdsAll, // for filtering queries
        institutionId,
        institutionName: institutionName ?? "Autoritate Publică",
        institutionType,
        isPMB: false,
        canEditData: false,
        canCreateData: false,
        canDeleteData: false,
        canExportData: true,
        scopes: {
          landfill: "ALL",          // ✅ All sectors, read-only
          tmb: "ALL",               // ✅ All sectors, read-only
          sectors: "ALL",           // ✅ All sectors, read-only (CORRECTED)
          reports: "NONE",          // ✅ No access
          institutions: "NONE",     // ✅ No access
          users: "NONE",            // ✅ No access
          profileContracts: "NONE", // ✅ Contract section hidden
        },
      };
      return next();
    }

    // For roles that MUST have an institution
    if (role === ROLES.ADMIN_INSTITUTION || role === ROLES.EDITOR_INSTITUTION) {
      if (!institutionId) {
        return res.status(403).json({ success: false, message: "User fără instituție asociată" });
      }

      // ADMIN_INSTITUTION:
      // - Landfill/TMB/Sectors: ALL sectors (read-only)
      // - Reports/Contracts: ALL sectors (read-only)
      // - NO access to Users or Institutions pages
      if (role === ROLES.ADMIN_INSTITUTION) {
        req.userAccess = {
          role,
          userId,
          accessLevel: "ALL",
          sectorIdsAll,
          sectorIds: sectorIdsAll,
          institutionSectorIds,        // Institution's mapped sectors (all 6 for PMB)
          visibleSectorIds: sectorIdsAll, // Always see all sectors
          institutionId,
          institutionName,
          institutionType,
          isPMB,
          canEditData: false,
          canCreateData: false,
          canDeleteData: false,
          canExportData: true,

          scopes: {
            landfill: "ALL",         // ✅ All sectors, read-only
            tmb: "ALL",              // ✅ All sectors, read-only
            sectors: "ALL",          // ✅ All sectors, read-only
            reports: "ALL",          // ✅ All sectors, read-only
            profileContracts: "ALL", // ✅ All sectors, read-only
            institutions: "NONE",    // ✅ No access (CORRECTED)
            users: "NONE",           // ✅ No access (CORRECTED)
          },
        };
        return next();
      }

      // EDITOR_INSTITUTION:
      // - Landfill/TMB: ALL sectors (read-only)
      // - Reports/Sectors/Contracts: Only their sector (read-only)
      // - NO access to Users or Institutions pages
      if (role === ROLES.EDITOR_INSTITUTION) {
        req.userAccess = {
          role,
          userId,
          accessLevel: "SECTOR",
          sectorIdsAll,
          sectorIds: institutionSectorIds, // Only their sector(s)
          institutionSectorIds,
          visibleSectorIds: institutionSectorIds, // Filter by their sector
          institutionId,
          institutionName,
          institutionType,
          isPMB: false, // EDITOR_INSTITUTION is always sector-level
          canEditData: false,
          canCreateData: false,
          canDeleteData: false,
          canExportData: true,

          scopes: {
            landfill: "ALL",             // ✅ All sectors, read-only
            tmb: "ALL",                  // ✅ All sectors, read-only
            reports: "SECTOR",           // ✅ Only their sector, read-only
            sectors: "SECTOR",           // ✅ Only their sector, read-only
            profileContracts: "SECTOR",  // ✅ Only their sector, read-only
            institutions: "NONE",        // ✅ No access
            users: "NONE",               // ✅ No access
          },
        };
        return next();
      }
    }

    // Unknown role
    return res.status(403).json({ success: false, message: `Rol necunoscut: ${role}` });
  } catch (err) {
    console.error("resolveUserAccess error:", err);
    return res
      .status(500)
      .json({ success: false, message: "Eroare la calculul accesului (resolveUserAccess)" });
  }
};

export default { resolveUserAccess };