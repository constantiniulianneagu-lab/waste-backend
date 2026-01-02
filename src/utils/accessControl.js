// src/utils/accessControl.js
// ============================================================================
// ACCESS CONTROL SYSTEM - PRODUCTION READY
// ============================================================================
// FIXED: Removed ALL references to ui.deleted_at (column doesn't exist)
// ============================================================================

import pool from '../config/database.js';
import { isPlatformAdmin, isRegulator } from '../constants/roles.js';

/**
 * Calculează sectoarele accesibile pentru un user
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
      console.log('🔍 Processing REGULATOR_VIEWER access');
      
      try {
        // REGULATOR vede toate sectoarele
        const allSectors = await pool.query(
          'SELECT id FROM sectors WHERE is_active = true ORDER BY sector_number'
        );

        console.log('✅ REGULATOR can see all sectors:', allSectors.rows.length);

        // Găsește instituția userului (OPTIONAL)
        let institutionId = null;
        let institutionName = 'Autoritate Publică';
        
        try {
          const userInstitution = await pool.query(
            `SELECT i.id, i.name 
             FROM user_institutions ui
             JOIN institutions i ON ui.institution_id = i.id
             WHERE ui.user_id = $1
             LIMIT 1`,
            [userId]
          );
          
          if (userInstitution.rows.length > 0) {
            institutionId = userInstitution.rows[0].id;
            institutionName = userInstitution.rows[0].name;
            console.log('✅ REGULATOR institution:', institutionName);
          } else {
            console.log('⚠️ REGULATOR has no institution - using defaults');
          }
        } catch (instError) {
          console.log('⚠️ Could not fetch REGULATOR institution:', instError.message);
        }

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
      } catch (sectorError) {
        console.error('❌ Error getting sectors for REGULATOR:', sectorError);
        
        return {
          sectorIds: [],
          accessType: 'REGULATOR_ALL',
          institutionId: null,
          institutionName: 'Autoritate Publică',
          canEdit: false,
          canCreate: false,
          canDelete: false,
          isPMB: false
        };
      }
    }

    // ========================================================================
    // 3. INSTITUTION_ADMIN / EDITOR_INSTITUTION (PMB sau Sector)
    // ========================================================================

    // 3a. Găsește instituția userului
    // ✅ FIXED: Removed ui.deleted_at (doesn't exist)
    const userInstitution = await pool.query(
      `SELECT ui.institution_id, i.name, i.type
       FROM user_institutions ui
       JOIN institutions i ON ui.institution_id = i.id
       WHERE ui.user_id = $1 AND i.deleted_at IS NULL`,
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
      canEdit: false,
      canCreate: false,
      canDelete: false,
      isPMB: isPMB,
      sectorNumbers: sectorNumbers
    };

  } catch (error) {
    console.error('❌ getAccessibleSectors error:', error);
    throw error;
  }
};

/**
 * Middleware pentru verificarea automată a accesului la sectoare
 */
export const enforceSectorAccess = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;

    const access = await getAccessibleSectors(userId, userRole);
    req.userAccess = access;

    const requestedSectorId = req.query.sector_id || req.body.sector_id || req.params.sector_id;
    
    if (requestedSectorId && access.accessType !== 'PLATFORM_ALL' && access.accessType !== 'REGULATOR_ALL') {
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

/**
 * Helper: Convertește sector_number → UUID
 */
export const getSectorIdFromNumber = async (sectorNumber) => {
  const result = await pool.query(
    'SELECT id FROM sectors WHERE sector_number = $1 AND is_active = true',
    [parseInt(sectorNumber)]
  );
  
  return result.rows.length > 0 ? result.rows[0].id : null;
};

/**
 * Helper: Convertește UUID → sector_number
 */
export const getSectorNumberFromId = async (sectorId) => {
  const result = await pool.query(
    'SELECT sector_number FROM sectors WHERE id = $1 AND is_active = true',
    [sectorId]
  );
  
  return result.rows.length > 0 ? result.rows[0].sector_number : null;
};

/**
 * Helper: Convertește array de sector_numbers → array de UUIDs
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

/**
 * Verifică dacă un user are acces la un sector specific
 */
export const hasAccessToSector = async (userId, userRole, sectorId) => {
  const access = await getAccessibleSectors(userId, userRole);
  
  if (access.accessType === 'PLATFORM_ALL' || access.accessType === 'REGULATOR_ALL') {
    return true;
  }
  
  return access.sectorIds.includes(sectorId);
};

/**
 * Verifică dacă un user are acces la o instituție
 */
export const hasAccessToInstitution = async (userId, userRole, institutionId) => {
  const userAccess = await getAccessibleSectors(userId, userRole);
  
  if (userAccess.accessType === 'PLATFORM_ALL' || userAccess.accessType === 'REGULATOR_ALL') {
    return true;
  }

  const institutionSectors = await pool.query(
    'SELECT sector_id FROM institution_sectors WHERE institution_id = $1',
    [institutionId]
  );

  const institutionSectorIds = institutionSectors.rows.map(r => r.sector_id);

  const hasOverlap = institutionSectorIds.some(sectorId => 
    userAccess.sectorIds.includes(sectorId)
  );

  return hasOverlap;
};

export default {
  getAccessibleSectors,
  enforceSectorAccess,
  getSectorIdFromNumber,
  getSectorNumberFromId,
  getSectorIdsFromNumbers,
  hasAccessToSector,
  hasAccessToInstitution,
};