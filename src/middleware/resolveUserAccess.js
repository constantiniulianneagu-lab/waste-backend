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

export const resolveUserAccess = async (req, res, next) => {
  try {
    if (!req.user?.id || !req.user?.role) {
      return res.status(401).json({ success: false, message: "Neautentificat" });
    }

    const userId = req.user.id;
    const role = req.user.role;

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
        accessLevel: "ALL",
        sectorIdsAll,
        sectorIds: sectorIdsAll, // backward compatible
        institutionSectorIds: sectorIdsAll,
        institutionId: null,
        institutionName: "ADIGIDMB",
        institutionType: "ASSOCIATION",
        isPMB: false,
        canEditData: true,

        // Per-page scopes (explicit, so requirements are clear)
        scopes: {
          landfill: "ALL",
          tmb: "ALL",
          reports: "ALL",
          institutions: "ALL",
          sectors: "ALL",
          users: "ALL",
          profileContracts: "ALL",
        },
      };
      return next();
    }

    // 2) REGULATOR_VIEWER => ALL sectors, no edit, NO reports & NO profile contracts section (per requirements)
    if (role === ROLES.REGULATOR_VIEWER) {
      req.userAccess = {
        accessLevel: "ALL",
        sectorIdsAll,
        sectorIds: sectorIdsAll, // backward compatible
        institutionSectorIds: sectorIdsAll,
        institutionId,
        institutionName: institutionName ?? "Autoritate Publică",
        institutionType,
        isPMB: false,
        canEditData: false,
        scopes: {
          landfill: "ALL",
          tmb: "ALL",
          reports: "NONE",          // ✅ per your table (not listed)
          institutions: "NONE",     // ✅ per your table (not listed)
          sectors: "NONE",          // ✅ per your table (not listed)
          users: "NONE",
          profileContracts: "NONE", // ✅ per your table: regulator doesn't see contract section
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
      // - MUST see LANDFILL + TMB pages with FULL access (use sectorIdsAll)
      // - Reports depend on PMB vs Sector (PMB ALL, Sector only its sectorIds)
      if (role === ROLES.ADMIN_INSTITUTION) {
        req.userAccess = {
          accessLevel: "ALL",          // ✅ IMPORTANT: for main pages they must not get empty data
          sectorIdsAll,
          sectorIds: sectorIdsAll,     // ✅ backward compatible: controllers using req.userAccess.sectorIds will work
          institutionSectorIds,        // ✅ for sector-scoped features (reports/institutions filtering)
          institutionId,
          institutionName,
          institutionType,
          isPMB,
          canEditData: false,

          scopes: {
            landfill: "ALL", // ✅ per your table
            tmb: "ALL",      // ✅ per your table

            // Reports: PMB full, sector city hall only its sectors (read-only anyway)
            reports: isPMB ? "ALL" : "SECTOR",

            // Institutions page exists for admin institution, but filtered if sector city hall
            institutions: isPMB ? "ALL" : "SECTOR",

            // Sectors page exists: PMB all, sector city hall only its sector(s)
            sectors: isPMB ? "ALL" : "SECTOR",

            // Users page exists for institution admin (PMB & sector), but backend should scope by institution (not by sector)
            users: "INSTITUTION",

            // Profile contracts MUST be visible to ADMIN_INSTITUTION
            profileContracts: "ALL",
          },
        };
        return next();
      }

      // EDITOR_INSTITUTION:
      // - Landfill/TMB access depends on PMB vs sector (PMB ALL, sector only its sector)
      // - Reports: same idea but always read-only
      // - Institutions: view-only and filtered for sector city hall
      if (role === ROLES.EDITOR_INSTITUTION) {
        // If PMB editor has 6 sectors mapped, treat as ALL, else sector scoped
        const editorSectorIds = isPMB ? sectorIdsAll : institutionSectorIds;

        req.userAccess = {
          accessLevel: isPMB ? "ALL" : "SECTOR",
          sectorIdsAll,
          sectorIds: editorSectorIds,
          institutionSectorIds,
          institutionId,
          institutionName,
          institutionType,
          isPMB,
          canEditData: false,

          scopes: {
            landfill: isPMB ? "ALL" : "SECTOR",
            tmb: isPMB ? "ALL" : "SECTOR",
            reports: isPMB ? "ALL" : "SECTOR",
            institutions: isPMB ? "ALL" : "SECTOR",
            sectors: isPMB ? "ALL" : "SECTOR",
            users: "NONE", // ✅ per your table: editors don't access /users page
            profileContracts: "ALL", // ✅ per your table: editor sees contracts (PMB all, sector filtered in controller)
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
