// src/utils/accessControl.js
// ============================================================================
// ACCESS CONTROL SYSTEM
// ============================================================================
// Versiune SIMPLIFICATĂ (fără user_permissions)
// Bazată pe: role + institution_sectors
// 
// VIITOR: Când adăugăm OPERATOR_USER, vom integra user_permissions

import pool from '../config/database.js';
import { isPlatformAdmin, isRegulator } from '../constants/roles.js';

// ============================================================================
// FUNCȚIA PRINCIPALĂ - getAccessibleSectors
// ============================================================================

/**
 * Calculează sectoarele accesibile pentru un user
 * Returnează: { sectorIds, accessType, institutionId, canEdit, canCreate, canDelete }
 * 
 * @param {string} userId - UUID user
 * @param {string} userRole - Rol user (PLATFORM_ADMIN, ADMIN_INSTITUTION, etc.)
 * @returns {Object} Access info
 */
export const getAccessibleSectors = async (userId, userRole) => {
  try {
    // ========================================================================
    // 1. PLATFORM_ADMIN (ADIGIDMB) → ACCES TOTAL
    // ========================================================================
    if (isPlatformAdmin(userRole)) {
      const allSectors = await pool.query(
        'SELECT id FROM sectors WHERE is_active = true ORDER BY sector_number'
      );

      return {
        sectorIds: allSectors.rows.map(r => r.id),
        accessType: 'PLATFORM_ALL',
        institutionId: null,
        institutionName: 'ADIGIDMB',
        canEdit: true,
        canCreate: true,
        canDelete: true,
        isPMB: false
      };
    }

    // ========================================================================
    // 2. REGULATOR_VIEWER (Autoritate Publică)
    // ========================================================================
    if (isRegulator(userRole)) {
      // TEMPORAR: Toți regulatorii văd toate sectoarele
      // În VIITOR: vom filtra prin user_permissions (access_type, sector_id)
      
      const allSectors = await pool.query(
        'SELECT id FROM sectors WHERE is_active = true ORDER BY sector_number'
      );

      // Găsește instituția userului (pentru info)
      const userInstitution = await pool.query(
        `SELECT i.id, i.name 
         FROM user_institutions ui
         JOIN institutions i ON ui.institution_id = i.id
         WHERE ui.user_id = $1 AND ui.deleted_at IS NULL`,
        [userId]
      );

      const institutionId = userInstitution.rows.length > 0 
        ? userInstitution.rows[0].id 
        : null;
      const institutionName = userInstitution.rows.length > 0 
        ? userInstitution.rows[0].name 
        : 'Autoritate Publică';

      return {
        sectorIds: allSectors.rows.map(r => r.id),
        accessType: 'REGULATOR_ALL',
        institutionId: institutionId,
        institutionName: institutionName,
        canEdit: false,
        canCreate: false,
        canDelete: false,
        isPMB: false
      };
    }

    // ========================================================================
    // 3. INSTITUTION_ADMIN / EDITOR_INSTITUTION (PMB sau Sector)
    // ========================================================================

    // 3a. Găsește instituția userului
    const userInstitution = await pool.query(
      `SELECT ui.institution_id, i.name, i.type
       FROM user_institutions ui
       JOIN institutions i ON ui.institution_id = i.id
       WHERE ui.user_id = $1 AND ui.deleted_at IS NULL`,
      [userId]
    );

    if (userInstitution.rows.length === 0) {
      throw new Error('User not associated with any institution');
    }

    const institutionId = userInstitution.rows[0].institution_id;
    const institutionName = userInstitution.rows[0].name;
    const institutionType = userInstitution.rows[0].type;

    // 3b. Găsește sectoarele instituției
    const institutionSectors = await pool.query(
      `SELECT s.id, s.sector_number, s.sector_name
       FROM institution_sectors ins
       JOIN sectors s ON ins.sector_id = s.id
       WHERE ins.institution_id = $1
       ORDER BY s.sector_number`,
      [institutionId]
    );

    if (institutionSectors.rows.length === 0) {
      // Instituție fără sectoare atribuite
      console.warn(`⚠️ Institution ${institutionId} (${institutionName}) has no sectors assigned`);
      
      return {
        sectorIds: [],
        accessType: 'NO_SECTORS',
        institutionId: institutionId,
        institutionName: institutionName,
        canEdit: false,
        canCreate: false,
        canDelete: false,
        isPMB: false
      };
    }

    const sectorIds = institutionSectors.rows.map(r => r.id);
    const sectorNumbers = institutionSectors.rows.map(r => r.sector_number);

    // 3c. Determină dacă e PMB (toate cele 6 sectoare)
    const isPMB = sectorIds.length === 6;
    const accessType = isPMB ? 'PMB_ALL' : 'SECTOR_SPECIFIC';

    console.log(`📊 Access calculated for user ${userId}:`, {
      institutionName,
      institutionType,
      isPMB,
      sectors: sectorNumbers.join(', ')
    });

    return {
      sectorIds: sectorIds,
      accessType: accessType,
      institutionId: institutionId,
      institutionName: institutionName,
      canEdit: false,      // DOAR vizualizare momentan (până la teste/feedback)
      canCreate: false,    // DOAR vizualizare momentan
      canDelete: false,    // DOAR vizualizare momentan
      isPMB: isPMB,
      sectorNumbers: sectorNumbers  // Pentru debugging/UI
    };

  } catch (error) {
    console.error('❌ getAccessibleSectors error:', error);
    throw error;
  }
};

// ============================================================================
// MIDDLEWARE - enforceSectorAccess
// ============================================================================

/**
 * Middleware pentru verificare automată acces sector
 * Atașează req.userAccess pentru folosire în controllere
 * 
 * Usage:
 *   router.get('/reports/tmb', authenticateToken, enforceSectorAccess, getTmbReport);
 */
export const enforceSectorAccess = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;

    // Calculează acces
    const access = await getAccessibleSectors(userId, userRole);
    
    // Atașează la request pentru folosire în controller
    req.userAccess = access;

    // Dacă request-ul cere un sector specific (query/body/params), verifică
    const requestedSectorId = req.query.sector_id || req.body.sector_id || req.params.sector_id;
    
    if (requestedSectorId && access.accessType !== 'PLATFORM_ALL') {
      // User cere un sector specific, verifică dacă are acces
      
      // Convertește sector_number → UUID dacă e necesar
      let sectorUuid = requestedSectorId;
      
      if (!isNaN(requestedSectorId) && parseInt(requestedSectorId) >= 1 && parseInt(requestedSectorId) <= 6) {
        const sectorQuery = await pool.query(
          'SELECT id FROM sectors WHERE sector_number = $1 AND is_active = true',
          [parseInt(requestedSectorId)]
        );
        if (sectorQuery.rows.length > 0) {
          sectorUuid = sectorQuery.rows[0].id;
        }
      }

      if (!access.sectorIds.includes(sectorUuid)) {
        return res.status(403).json({
          success: false,
          message: 'Nu ai acces la acest sector'
        });
      }
    }

    next();
  } catch (error) {
    console.error('❌ Sector access check error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la verificarea accesului'
    });
  }
};

// ============================================================================
// HELPER FUNCTIONS - Conversii sector_number ↔ UUID
// ============================================================================

/**
 * Convertește sector_number (1-6) în UUID
 */
export const getSectorIdFromNumber = async (sectorNumber) => {
  const result = await pool.query(
    'SELECT id FROM sectors WHERE sector_number = $1 AND is_active = true',
    [parseInt(sectorNumber)]
  );
  
  return result.rows.length > 0 ? result.rows[0].id : null;
};

/**
 * Convertește UUID în sector_number (1-6)
 */
export const getSectorNumberFromId = async (sectorId) => {
  const result = await pool.query(
    'SELECT sector_number FROM sectors WHERE id = $1 AND is_active = true',
    [sectorId]
  );
  
  return result.rows.length > 0 ? result.rows[0].sector_number : null;
};

/**
 * Convertește array de sector_numbers în array de UUIDs
 */
export const getSectorIdsFromNumbers = async (sectorNumbers) => {
  if (!sectorNumbers || sectorNumbers.length === 0) {
    return [];
  }

  const result = await pool.query(
    'SELECT id FROM sectors WHERE sector_number = ANY($1) AND is_active = true ORDER BY sector_number',
    [sectorNumbers]
  );
  
  return result.rows.map(r => r.id);
};

// ============================================================================
// HELPER FUNCTIONS - Verificări acces
// ============================================================================

/**
 * Verifică dacă un user are acces la un sector specific
 */
export const hasAccessToSector = async (userId, userRole, sectorId) => {
  const access = await getAccessibleSectors(userId, userRole);
  
  if (access.accessType === 'PLATFORM_ALL') {
    return true;
  }
  
  return access.sectorIds.includes(sectorId);
};

/**
 * Verifică dacă un user are acces la o instituție (prin sectoare comune)
 */
export const hasAccessToInstitution = async (userId, userRole, institutionId) => {
  const userAccess = await getAccessibleSectors(userId, userRole);
  
  if (userAccess.accessType === 'PLATFORM_ALL') {
    return true;
  }

  // Găsește sectoarele instituției verificate
  const institutionSectors = await pool.query(
    'SELECT sector_id FROM institution_sectors WHERE institution_id = $1',
    [institutionId]
  );

  const institutionSectorIds = institutionSectors.rows.map(r => r.sector_id);

  // Verifică dacă există overlap între sectoarele userului și cele ale instituției
  const hasOverlap = institutionSectorIds.some(sectorId => 
    userAccess.sectorIds.includes(sectorId)
  );

  return hasOverlap;
};

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  getAccessibleSectors,
  enforceSectorAccess,
  getSectorIdFromNumber,
  getSectorNumberFromId,
  getSectorIdsFromNumbers,
  hasAccessToSector,
  hasAccessToInstitution,
};