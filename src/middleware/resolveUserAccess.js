// src/middleware/resolveUserAccess.js
// ============================================================================
// resolveUserAccess middleware - VERSIUNE SIMPLIFICATĂ 2.0
// ============================================================================
// Calculează scope-ul de vizibilitate o singură dată și îl atașează la req.userAccess
//
// LOGICA SIMPLIFICATĂ:
// 1. User → Role (din users.role)
// 2. User → Institution (din user_institutions)
// 3. Institution → Sectors (din institution_sectors)
// 4. Rolul + Instituția determină automat toate permisiunile
//
// NU MAI FOLOSIM: user_permissions (păstrat pentru backwards compatibility)
// ============================================================================

import pool from '../config/database.js';
import { ROLES, getPageScope, isPMBInstitution } from '../constants/roles.js';

export const resolveUserAccess = async (req, res, next) => {
  try {
    if (!req.user?.id || !req.user?.role) {
      return res.status(401).json({ 
        success: false, 
        message: 'Neautentificat' 
      });
    }

    const userId = req.user.id;
    const role = req.user.role;

    // ----------------------------------------------------------------------------
    // STEP 1: Fetch ALL sectors (București 1-6)
    // ----------------------------------------------------------------------------
    const allSectorsQuery = await pool.query(
      `SELECT id, sector_number, sector_name
       FROM sectors
       WHERE is_active = true AND deleted_at IS NULL
       ORDER BY sector_number`
    );
    const allSectors = allSectorsQuery.rows;
    const sectorIdsAll = allSectors.map((s) => s.id);

    // ----------------------------------------------------------------------------
    // STEP 2: Fetch user's institution (if exists)
    // ----------------------------------------------------------------------------
    const institutionQuery = await pool.query(
      `SELECT i.id, i.name, i.type, i.short_name, i.sector
       FROM user_institutions ui
       JOIN institutions i ON ui.institution_id = i.id
       WHERE ui.user_id = $1
       LIMIT 1`,
      [userId]
    );

    const institution = institutionQuery.rows[0] || null;
    const institutionId = institution?.id || null;
    const institutionName = institution?.name || null;
    const institutionType = institution?.type || null;

    // ----------------------------------------------------------------------------
    // STEP 3: Fetch sectors mapped to institution
    // ----------------------------------------------------------------------------
    let institutionSectorIds = [];
    if (institutionId) {
      const sectorsQuery = await pool.query(
        `SELECT s.id, s.sector_number, s.sector_name
         FROM institution_sectors ins
         JOIN sectors s ON ins.sector_id = s.id
         WHERE ins.institution_id = $1
           AND s.is_active = true
           AND s.deleted_at IS NULL
         ORDER BY s.sector_number`,
        [institutionId]
      );
      institutionSectorIds = sectorsQuery.rows.map((s) => s.id);
    }

    // Detectăm dacă instituția este PMB (are toate cele 6 sectoare)
    const isPMB = isPMBInstitution(institutionSectorIds);

    // ----------------------------------------------------------------------------
    // STEP 4: Build userAccess object based on role
    // ----------------------------------------------------------------------------

    // === PLATFORM_ADMIN ===
    if (role === ROLES.PLATFORM_ADMIN) {
      req.userAccess = {
        role,
        userId,
        accessLevel: 'ALL',
        
        // Sector data
        sectorIdsAll,
        institutionSectorIds: sectorIdsAll,
        visibleSectorIds: sectorIdsAll, // pentru backwards compatibility
        
        // Institution data
        institutionId: null, // PLATFORM_ADMIN nu este legat de o instituție specifică
        institutionName: 'ADIGIDMB',
        institutionType: 'ASSOCIATION',
        isPMB: false,
        
        // Permissions
        canEdit: true,
        canCreate: true,
        canDelete: true,
        canExport: true,
        
        // Per-page scopes (explicit pentru claritate)
        scopes: {
          landfill: 'ALL',
          tmb: 'ALL',
          reports: 'ALL',
          sectors: 'ALL',
          profileContracts: 'ALL',
          users: 'ALL',
          institutions: 'ALL',
        },
      };
      return next();
    }

    // === REGULATOR_VIEWER ===
    if (role === ROLES.REGULATOR_VIEWER) {
      req.userAccess = {
        role,
        userId,
        accessLevel: 'ALL',
        
        // Sector data - vede toate sectoarele
        sectorIdsAll,
        institutionSectorIds: sectorIdsAll,
        visibleSectorIds: sectorIdsAll,
        
        // Institution data
        institutionId,
        institutionName: institutionName || 'Autoritate Publică',
        institutionType,
        isPMB: false,
        
        // Permissions - doar read-only
        canEdit: false,
        canCreate: false,
        canDelete: false,
        canExport: true,
        
        // Per-page scopes
        scopes: {
          landfill: 'ALL',           // ✅ Vede toate sectoarele
          tmb: 'ALL',                // ✅ Vede toate sectoarele
          reports: 'NONE',           // ❌ Nu vede pagina Rapoarte
          sectors: 'ALL',            // ✅ Vede toate sectoarele (conform cerințelor actualizate)
          profileContracts: 'NONE',  // ❌ Nu vede secțiunea Contracte din profil
          users: 'NONE',             // ❌ Nu vede pagina Utilizatori
          institutions: 'NONE',      // ❌ Nu vede pagina Instituții
        },
      };
      return next();
    }

    // === INSTITUTION_ADMIN și EDITOR_INSTITUTION ===
    // Aceste roluri TREBUIE să aibă o instituție asociată
    if (role === ROLES.INSTITUTION_ADMIN || role === ROLES.EDITOR_INSTITUTION) {
      if (!institutionId) {
        return res.status(403).json({ 
          success: false, 
          message: 'Utilizator fără instituție asociată' 
        });
      }

      // --- INSTITUTION_ADMIN (PMB) ---
      if (role === ROLES.INSTITUTION_ADMIN) {
        req.userAccess = {
          role,
          userId,
          accessLevel: 'ALL',
          
          // Sector data - INSTITUTION_ADMIN vede toate sectoarele
          sectorIdsAll,
          institutionSectorIds,
          visibleSectorIds: sectorIdsAll, // Vede toate pentru Landfill/TMB/Sectoare
          
          // Institution data
          institutionId,
          institutionName,
          institutionType,
          isPMB,
          
          // Permissions - read-only (nu poate modifica)
          canEdit: false,
          canCreate: false,
          canDelete: false,
          canExport: true,
          
          // Per-page scopes
          scopes: {
            landfill: 'ALL',           // ✅ Vede toate sectoarele
            tmb: 'ALL',                // ✅ Vede toate sectoarele
            reports: 'ALL',            // ✅ Vede toate sectoarele (deoarece este PMB)
            sectors: 'ALL',            // ✅ Vede toate sectoarele
            profileContracts: 'ALL',   // ✅ Vede toate contractele
            users: 'NONE',             // ❌ Nu vede pagina Utilizatori
            institutions: 'NONE',      // ❌ Nu vede pagina Instituții
          },
        };
        return next();
      }

      // --- EDITOR_INSTITUTION (Primării Sectoare) ---
      if (role === ROLES.EDITOR_INSTITUTION) {
        // Determină ce sectoare vede:
        // - Pentru Landfill/TMB: toate sectoarele
        // - Pentru Rapoarte/Contracte/Sectoare: doar sectoarele sale
        
        req.userAccess = {
          role,
          userId,
          accessLevel: 'SECTOR',
          
          // Sector data
          sectorIdsAll,
          institutionSectorIds,
          visibleSectorIds: institutionSectorIds, // Doar sectoarele sale pentru filtrare
          
          // Institution data
          institutionId,
          institutionName,
          institutionType,
          isPMB,
          
          // Permissions - read-only
          canEdit: false,
          canCreate: false,
          canDelete: false,
          canExport: true,
          
          // Per-page scopes
          scopes: {
            landfill: 'ALL',           // ✅ Vede toate sectoarele
            tmb: 'ALL',                // ✅ Vede toate sectoarele
            reports: 'SECTOR',         // ⚠️ Vede doar sectorul său
            sectors: 'SECTOR',         // ⚠️ Vede doar sectorul său
            profileContracts: 'SECTOR',// ⚠️ Vede doar contractele sectorului său
            users: 'NONE',             // ❌ Nu vede pagina Utilizatori
            institutions: 'NONE',      // ❌ Nu vede pagina Instituții
          },
        };
        return next();
      }
    }

    // === UNKNOWN ROLE ===
    return res.status(403).json({ 
      success: false, 
      message: `Rol necunoscut sau invalid: ${role}` 
    });

  } catch (err) {
    console.error('[resolveUserAccess] Error:', err);
    return res.status(500).json({ 
      success: false, 
      message: 'Eroare la calculul permisiunilor de acces' 
    });
  }
};

// ----------------------------------------------------------------------------
// Helper: Verifică dacă utilizatorul are acces la un sector specific
// ----------------------------------------------------------------------------
export const hasAccessToSector = (userAccess, sectorId) => {
  if (!userAccess || !sectorId) return false;
  
  // PLATFORM_ADMIN și cei cu accessLevel ALL au acces la orice sector
  if (userAccess.accessLevel === 'ALL') return true;
  
  // Verifică dacă sectorul este în lista de sectoare vizibile
  return userAccess.visibleSectorIds.includes(sectorId);
};

// ----------------------------------------------------------------------------
// Helper: Verifică dacă utilizatorul poate edita date
// ----------------------------------------------------------------------------
export const canEditData = (userAccess) => {
  return userAccess?.canEdit === true;
};

// ----------------------------------------------------------------------------
// EXPORT
// ----------------------------------------------------------------------------
export default { 
  resolveUserAccess,
  hasAccessToSector,
  canEditData,
};