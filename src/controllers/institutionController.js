// src/controllers/institutionController.js
/**
 * ============================================================================
 * INSTITUTION CONTROLLER - FIXED & IMPROVED
 * ============================================================================
 * 
 * ✅ FIXES:
 * - createInstitution: salvează TOATE câmpurile
 * - updateInstitution: actualizează TOATE câmpurile
 * - deleteInstitution: curățat dead code
 * - Adăugat support pentru institution_sectors (relație many-to-many)
 * 
 * ============================================================================
 */

import pool from '../config/database.js';

// ============================================================================
// GET ALL INSTITUTIONS (with sectors) + SCOPE FILTERING
// ============================================================================
export const getAllInstitutions = async (req, res) => {
  try {
    // Check if user has access to institutions page
    const { scopes } = req.userAccess;
    if (scopes?.institutions === 'NONE') {
      return res.status(403).json({ 
        success: false, 
        message: 'Nu aveți permisiune să accesați instituțiile' 
      });
    }

    const { limit = 1000, type, search } = req.query;

    const access = req.userAccess;
    if (!access) {
      return res.status(500).json({ success: false, message: 'Missing req.userAccess' });
    }

    let whereConditions = ['i.deleted_at IS NULL'];
    const params = [];
    let paramCount = 1;

    // Filter by type
    if (type) {
      whereConditions.push(`i.type = $${paramCount}`);
      params.push(type);
      paramCount++;
    }

    // Search
    if (search) {
      whereConditions.push(`(i.name ILIKE $${paramCount} OR i.short_name ILIKE $${paramCount} OR i.fiscal_code ILIKE $${paramCount})`);
      params.push(`%${search}%`);
      paramCount++;
    }

    // VISIBILITY SCOPE
    if (access.accessLevel !== 'ALL') {
      const instParam = paramCount;
      params.push(access.institutionId);
      paramCount++;

      const sectorParam = paramCount;
      params.push(access.sectorIds);
      paramCount++;

      whereConditions.push(`
        (
          i.id = $${instParam}
          OR EXISTS (
            SELECT 1 FROM institution_sectors ins
            WHERE ins.institution_id = i.id
              AND ins.sector_id = ANY($${sectorParam}::uuid[])
          )
          OR EXISTS (
            SELECT 1 FROM waste_tickets_landfill w
            WHERE w.deleted_at IS NULL
              AND w.sector_id = ANY($${sectorParam}::uuid[])
              AND w.supplier_id = i.id
          )
          OR EXISTS (
            SELECT 1 FROM waste_tickets_tmb w
            WHERE w.deleted_at IS NULL
              AND w.sector_id = ANY($${sectorParam}::uuid[])
              AND (w.supplier_id = i.id OR w.operator_id = i.id)
          )
          OR EXISTS (
            SELECT 1 FROM waste_tickets_recycling w
            WHERE w.deleted_at IS NULL
              AND w.sector_id = ANY($${sectorParam}::uuid[])
              AND (w.supplier_id = i.id OR w.recipient_id = i.id)
          )
          OR EXISTS (
            SELECT 1 FROM waste_tickets_recovery w
            WHERE w.deleted_at IS NULL
              AND w.sector_id = ANY($${sectorParam}::uuid[])
              AND (w.supplier_id = i.id OR w.recipient_id = i.id)
          )
          OR EXISTS (
            SELECT 1 FROM waste_tickets_disposal w
            WHERE w.deleted_at IS NULL
              AND w.sector_id = ANY($${sectorParam}::uuid[])
              AND (w.supplier_id = i.id OR w.recipient_id = i.id)
          )
          OR EXISTS (
            SELECT 1 FROM waste_tickets_rejected w
            WHERE w.deleted_at IS NULL
              AND w.sector_id = ANY($${sectorParam}::uuid[])
              AND (w.supplier_id = i.id OR w.operator_id = i.id)
          )
        )
      `);
    }

    const whereClause = whereConditions.join(' AND ');

    const query = `
      SELECT 
        i.id,
        i.name,
        i.short_name,
        i.type,
        i.contact_email,
        i.contact_phone,
        i.address,
        i.website,
        i.fiscal_code,
        i.registration_no,
        i.is_active,
        i.created_at,
        i.updated_at,
        
        -- Sectoare asociate ca string (pentru compatibility)
        (
          SELECT string_agg(s.sector_number::text, ',' ORDER BY s.sector_number)
          FROM institution_sectors ins
          JOIN sectors s ON ins.sector_id = s.id
          WHERE ins.institution_id = i.id
            AND s.is_active = true
            AND (s.deleted_at IS NULL OR s.deleted_at > NOW())
        ) as sector,
        
        -- Sectoare ca array pentru frontend
        (
          SELECT json_agg(
            json_build_object(
              'id', s.id,
              'sector_number', s.sector_number,
              'sector_name', s.sector_name
            ) ORDER BY s.sector_number
          )
          FROM institution_sectors ins
          JOIN sectors s ON ins.sector_id = s.id
          WHERE ins.institution_id = i.id
            AND s.is_active = true
            AND (s.deleted_at IS NULL OR s.deleted_at > NOW())
        ) as sectors
        
      FROM institutions i
      WHERE ${whereClause}
      ORDER BY i.name
      LIMIT $${paramCount}
    `;

    params.push(limit);

    const result = await pool.query(query, params);

    res.json({
      success: true,
      data: {
        institutions: result.rows,
        total: result.rows.length
      }
    });
  } catch (error) {
    console.error('Get institutions error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la obținerea instituțiilor'
    });
  }
};

// ============================================================================
// GET SINGLE INSTITUTION + SCOPE CHECK
// ============================================================================
export const getInstitutionById = async (req, res) => {
  const { scopes } = req.userAccess;
  if (scopes?.institutions === 'NONE') {
    return res.status(403).json({ 
      success: false, 
      message: 'Nu aveți permisiune să accesați instituțiile' 
    });
  }

  try {
    const { id } = req.params;

    const access = req.userAccess;
    if (!access) {
      return res.status(500).json({ success: false, message: 'Missing req.userAccess' });
    }

    // Dacă user-ul nu are ALL, verificăm dacă instituția e în aria lui
    if (access.accessLevel !== 'ALL') {
      const canSeeQ = await pool.query(
        `
        SELECT 1
        FROM institutions i
        WHERE i.id = $1 AND i.deleted_at IS NULL
          AND (
            i.id = $2
            OR EXISTS (
              SELECT 1 FROM institution_sectors ins
              WHERE ins.institution_id = i.id
                AND ins.sector_id = ANY($3::uuid[])
            )
          )
        LIMIT 1
        `,
        [id, access.institutionId, access.sectorIds]
      );

      if (canSeeQ.rows.length === 0) {
        return res.status(403).json({
          success: false,
          message: 'Access denied to this institution'
        });
      }
    }

    const query = `
      SELECT 
        i.*,
        (
          SELECT string_agg(s.sector_number::text, ',' ORDER BY s.sector_number)
          FROM institution_sectors ins
          JOIN sectors s ON ins.sector_id = s.id
          WHERE ins.institution_id = i.id
            AND s.is_active = true
        ) as sector,
        (
          SELECT json_agg(
            json_build_object(
              'id', s.id,
              'sector_number', s.sector_number,
              'sector_name', s.sector_name
            ) ORDER BY s.sector_number
          )
          FROM institution_sectors ins
          JOIN sectors s ON ins.sector_id = s.id
          WHERE ins.institution_id = i.id
            AND s.is_active = true
        ) as sectors
      FROM institutions i
      WHERE i.id = $1 AND i.deleted_at IS NULL
    `;

    const result = await pool.query(query, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Instituție negăsită'
      });
    }

    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Get institution error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la obținerea instituției'
    });
  }
};

// ============================================================================
// CREATE INSTITUTION - FIXED: salvează TOATE câmpurile
// ============================================================================
export const createInstitution = async (req, res) => {
  try {
    // Check permission
    const { canCreateData } = req.userAccess;
    if (!canCreateData) {
      return res.status(403).json({ 
        success: false, 
        message: 'Nu aveți permisiune să creați instituții' 
      });
    }

    const { 
      name, 
      short_name,
      type, 
      sector,  // poate fi "1,2,3" sau array [1,2,3]
      contact_email,
      contact_phone,
      address,
      website,
      fiscal_code,
      registration_no,
      is_active = true
    } = req.body;

    // Validare minimă
    if (!name || !type) {
      return res.status(400).json({
        success: false,
        message: 'Numele și tipul sunt obligatorii'
      });
    }

    // Verifică dacă numele există
    const existingInstitution = await pool.query(
      'SELECT id FROM institutions WHERE name = $1 AND deleted_at IS NULL',
      [name]
    );

    if (existingInstitution.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'O instituție cu acest nume există deja'
      });
    }

    // Inserează instituție cu TOATE câmpurile
    const result = await pool.query(
      `INSERT INTO institutions (
        name, 
        short_name, 
        type, 
        contact_email, 
        contact_phone,
        address,
        website,
        fiscal_code,
        registration_no,
        is_active,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
      RETURNING *`,
      [
        name,
        short_name || null,
        type,
        contact_email ? contact_email.toLowerCase() : null,
        contact_phone || null,
        address || null,
        website || null,
        fiscal_code || null,
        registration_no || null,
        is_active
      ]
    );

    const newInstitution = result.rows[0];

    // Procesează sectoarele dacă sunt specificate
    if (sector) {
      await updateInstitutionSectors(newInstitution.id, sector);
    }

    // Reîncarcă instituția cu sectoarele
    const finalResult = await pool.query(`
      SELECT 
        i.*,
        (
          SELECT string_agg(s.sector_number::text, ',' ORDER BY s.sector_number)
          FROM institution_sectors ins
          JOIN sectors s ON ins.sector_id = s.id
          WHERE ins.institution_id = i.id
        ) as sector
      FROM institutions i
      WHERE i.id = $1
    `, [newInstitution.id]);

    res.status(201).json({
      success: true,
      message: 'Instituție creată cu succes',
      data: finalResult.rows[0]
    });
  } catch (error) {
    console.error('Create institution error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la crearea instituției',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
};

// ============================================================================
// UPDATE INSTITUTION - FIXED: actualizează TOATE câmpurile
// ============================================================================
export const updateInstitution = async (req, res) => {
  try {
    // Check permission
    const { canEditData } = req.userAccess;
    if (!canEditData) {
      return res.status(403).json({ 
        success: false, 
        message: 'Nu aveți permisiune să editați instituții' 
      });
    }

    const { id } = req.params;
    const { 
      name, 
      short_name,
      type, 
      sector,
      contact_email,
      contact_phone,
      address,
      website,
      fiscal_code,
      registration_no,
      is_active
    } = req.body;

    // Verifică dacă instituția există
    const existingInstitution = await pool.query(
      'SELECT id FROM institutions WHERE id = $1 AND deleted_at IS NULL',
      [id]
    );

    if (existingInstitution.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Instituție negăsită'
      });
    }

    // Verifică dacă noul nume e deja folosit de altă instituție
    if (name) {
      const nameCheck = await pool.query(
        'SELECT id FROM institutions WHERE name = $1 AND id != $2 AND deleted_at IS NULL',
        [name, id]
      );

      if (nameCheck.rows.length > 0) {
        return res.status(400).json({
          success: false,
          message: 'O instituție cu acest nume există deja'
        });
      }
    }

    // Construiește query dinamic pentru câmpurile trimise
    const updates = [];
    const params = [];
    let paramCount = 1;

    const addUpdate = (field, value) => {
      if (value !== undefined) {
        updates.push(`${field} = $${paramCount}`);
        params.push(value);
        paramCount++;
      }
    };

    addUpdate('name', name);
    addUpdate('short_name', short_name);
    addUpdate('type', type);
    addUpdate('contact_email', contact_email ? contact_email.toLowerCase() : contact_email);
    addUpdate('contact_phone', contact_phone);
    addUpdate('address', address);
    addUpdate('website', website);
    addUpdate('fiscal_code', fiscal_code);
    addUpdate('registration_no', registration_no);
    
    if (is_active !== undefined) {
      addUpdate('is_active', is_active);
    }

    updates.push(`updated_at = NOW()`);

    if (updates.length === 1) {
      // Doar updated_at, nimic de actualizat
      return res.status(400).json({
        success: false,
        message: 'Niciun câmp de actualizat'
      });
    }

    params.push(id);

    const query = `
      UPDATE institutions 
      SET ${updates.join(', ')}
      WHERE id = $${paramCount} AND deleted_at IS NULL
      RETURNING *
    `;

    const result = await pool.query(query, params);

    // Actualizează sectoarele dacă sunt specificate
    if (sector !== undefined) {
      await updateInstitutionSectors(id, sector);
    }

    // Reîncarcă instituția cu sectoarele
    const finalResult = await pool.query(`
      SELECT 
        i.*,
        (
          SELECT string_agg(s.sector_number::text, ',' ORDER BY s.sector_number)
          FROM institution_sectors ins
          JOIN sectors s ON ins.sector_id = s.id
          WHERE ins.institution_id = i.id
        ) as sector
      FROM institutions i
      WHERE i.id = $1
    `, [id]);

    res.json({
      success: true,
      message: 'Instituție actualizată cu succes',
      data: finalResult.rows[0]
    });
  } catch (error) {
    console.error('Update institution error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la actualizarea instituției',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
};

// ============================================================================
// DELETE INSTITUTION - FIXED: curățat dead code
// ============================================================================
export const deleteInstitution = async (req, res) => {
  try {
    // Check permission
    const { canDeleteData } = req.userAccess;
    if (!canDeleteData) {
      return res.status(403).json({ 
        success: false, 
        message: 'Nu aveți permisiune să ștergeți instituții' 
      });
    }

    const { scopes } = req.userAccess;
    if (scopes?.institutions === 'NONE') {
      return res.status(403).json({ 
        success: false, 
        message: 'Nu aveți permisiune să accesați instituțiile' 
      });
    }

    const { id } = req.params;

    // Verifică dacă instituția există
    const existingInstitution = await pool.query(
      'SELECT id, name FROM institutions WHERE id = $1 AND deleted_at IS NULL',
      [id]
    );

    if (existingInstitution.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Instituție negăsită'
      });
    }

    // Verifică dacă instituția are tichete asociate
    const ticketsCheck = await pool.query(`
      SELECT COUNT(*) as count FROM (
        SELECT id FROM waste_tickets_landfill WHERE supplier_id = $1 AND deleted_at IS NULL
        UNION ALL
        SELECT id FROM waste_tickets_tmb WHERE (supplier_id = $1 OR operator_id = $1) AND deleted_at IS NULL
        UNION ALL
        SELECT id FROM waste_tickets_recycling WHERE (supplier_id = $1 OR recipient_id = $1) AND deleted_at IS NULL
        UNION ALL
        SELECT id FROM waste_tickets_recovery WHERE (supplier_id = $1 OR recipient_id = $1) AND deleted_at IS NULL
        UNION ALL
        SELECT id FROM waste_tickets_disposal WHERE (supplier_id = $1 OR recipient_id = $1) AND deleted_at IS NULL
      ) t
    `, [id]);

    const ticketCount = parseInt(ticketsCheck.rows[0].count, 10);

    if (ticketCount > 0) {
      return res.status(400).json({
        success: false,
        message: `Nu se poate șterge instituția. Are ${ticketCount} tichete asociate. Dezactivați-o în schimb.`
      });
    }

    // Soft delete
    await pool.query(
      'UPDATE institutions SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1',
      [id]
    );

    // Șterge și legăturile cu sectoarele
    await pool.query(
      'DELETE FROM institution_sectors WHERE institution_id = $1',
      [id]
    );

    res.json({
      success: true,
      message: 'Instituție ștearsă cu succes'
    });
  } catch (error) {
    console.error('Delete institution error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la ștergerea instituției'
    });
  }
};

// ============================================================================
// GET INSTITUTION STATISTICS
// ============================================================================
export const getInstitutionStats = async (req, res) => {
  try {
    const stats = await pool.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE is_active = true) as active,
        COUNT(*) FILTER (WHERE is_active = false) as inactive,
        COUNT(*) FILTER (WHERE type = 'ASSOCIATION') as associations,
        COUNT(*) FILTER (WHERE type = 'MUNICIPALITY') as municipalities,
        COUNT(*) FILTER (WHERE type = 'WASTE_COLLECTOR') as collectors,
        COUNT(*) FILTER (WHERE type = 'TMB_OPERATOR') as tmb_operators,
        COUNT(*) FILTER (WHERE type = 'SORTING_OPERATOR') as sorting_operators,
        COUNT(*) FILTER (WHERE type = 'DISPOSAL_CLIENT' OR type = 'LANDFILL') as disposal,
        COUNT(*) FILTER (WHERE type = 'RECYCLING_CLIENT') as recycling,
        COUNT(*) FILTER (WHERE type = 'RECOVERY_CLIENT') as recovery,
        COUNT(*) FILTER (WHERE type = 'REGULATOR') as regulators
      FROM institutions
      WHERE deleted_at IS NULL
    `);

    res.json({
      success: true,
      data: stats.rows[0]
    });
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la obținerea statisticilor'
    });
  }
};

// ============================================================================
// GET INSTITUTION CONTRACTS - PLACEHOLDER
// ============================================================================
export const getInstitutionContracts = async (req, res) => {
  try {
    const { scopes } = req.userAccess;
    if (scopes?.institutions === 'NONE') {
      return res.status(403).json({ 
        success: false, 
        message: 'Nu aveți permisiune să accesați instituțiile' 
      });
    }

    const { id } = req.params;
    
    // Verifică dacă instituția există
    const institutionResult = await pool.query(
      'SELECT id, name, type FROM institutions WHERE id = $1 AND deleted_at IS NULL',
      [id]
    );
    
    if (institutionResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Institution not found'
      });
    }
    
    // Returnează gol - frontend-ul va folosi endpoint-uri specifice
    res.json({
      success: true,
      data: [],
      message: 'Use specific contract endpoints based on institution type'
    });
    
  } catch (err) {
    console.error('Error in getInstitutionContracts:', err);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: err.message
    });
  }
};

// ============================================================================
// HELPER: Update institution sectors (many-to-many)
// ============================================================================
async function updateInstitutionSectors(institutionId, sectorInput) {
  // Parsează input-ul: poate fi "1,2,3" sau [1, 2, 3] sau ["1", "2", "3"]
  let sectorNumbers = [];
  
  if (typeof sectorInput === 'string') {
    sectorNumbers = sectorInput.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
  } else if (Array.isArray(sectorInput)) {
    sectorNumbers = sectorInput.map(s => parseInt(s, 10)).filter(n => !isNaN(n));
  }

  // Șterge legăturile existente
  await pool.query(
    'DELETE FROM institution_sectors WHERE institution_id = $1',
    [institutionId]
  );

  // Dacă nu sunt sectoare, gata
  if (sectorNumbers.length === 0) return;

  // Găsește UUID-urile sectoarelor
  const sectorsResult = await pool.query(
    'SELECT id, sector_number FROM sectors WHERE sector_number = ANY($1) AND is_active = true AND deleted_at IS NULL',
    [sectorNumbers]
  );

  // Inserează legăturile noi
  for (const sector of sectorsResult.rows) {
    await pool.query(
      'INSERT INTO institution_sectors (institution_id, sector_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [institutionId, sector.id]
    );
  }
}

export default {
  getAllInstitutions,
  getInstitutionById,
  createInstitution,
  updateInstitution,
  deleteInstitution,
  getInstitutionStats,
  getInstitutionContracts
};