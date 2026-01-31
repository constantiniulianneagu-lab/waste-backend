// src/controllers/institutionController.js
/**
 * ============================================================================
 * INSTITUTION CONTROLLER - UPDATED WITH REPRESENTATIVE FIELDS
 * ============================================================================
 * 
 * Updated: 2025-01-24
 * - Added representative_name, representative_position, representative_phone, representative_email
 * - For operators: WASTE_COLLECTOR, SORTING_OPERATOR, TMB_OPERATOR, 
 *   AEROBIC_OPERATOR, ANAEROBIC_OPERATOR, DISPOSAL_CLIENT
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
        
        -- Representative fields (NEW!)
        i.representative_name,
        i.representative_position,
        i.representative_phone,
        i.representative_email,
        
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
// CREATE INSTITUTION - WITH REPRESENTATIVE FIELDS
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
      sector,
      contact_email,
      contact_phone,
      address,
      website,
      fiscal_code,
      registration_no,
      is_active = true,
      // NEW: Representative fields
      representative_name,
      representative_position,
      representative_phone,
      representative_email
    } = req.body;

    // Validare minimă
    if (!name || !type) {
      return res.status(400).json({
        success: false,
        message: 'Numele și tipul sunt obligatorii'
      });
    }

    // Verifică dacă există aceeași instituție pentru același TIP
// (permite același nume dacă tipul este diferit: ex. TMB_OPERATOR vs AEROBIC_OPERATOR)
const existingInstitution = await pool.query(
  `
  SELECT id
  FROM institutions
  WHERE deleted_at IS NULL
    AND lower(name) = lower($1)
    AND type = $2
  LIMIT 1
  `,
  [name, type]
);

if (existingInstitution.rows.length > 0) {
  return res.status(400).json({
    success: false,
    message: 'O instituție cu acest nume există deja pentru tipul selectat'
  });
}


    // Inserează instituție cu TOATE câmpurile inclusiv representative
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
        representative_name,
        representative_position,
        representative_phone,
        representative_email,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW(), NOW())
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
        is_active,
        representative_name || null,
        representative_position || null,
        representative_phone || null,
        representative_email ? representative_email.toLowerCase() : null
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
// UPDATE INSTITUTION - WITH REPRESENTATIVE FIELDS
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
      is_active,
      // NEW: Representative fields
      representative_name,
      representative_position,
      representative_phone,
      representative_email
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
// Dacă se trimite name și type, verificăm să nu existe deja altă instituție cu același (name + type)
if (name !== undefined && type !== undefined) {
  const dup = await pool.query(
    `
    SELECT id
    FROM institutions
    WHERE deleted_at IS NULL
      AND lower(name) = lower($1)
      AND type = $2
      AND id <> $3
    LIMIT 1
    `,
    [name, type, id]
  );

  if (dup.rows.length > 0) {
    return res.status(400).json({
      success: false,
      message: 'Există deja o instituție cu acest nume pentru tipul selectat'
    });
  }
}

    // Construiește query-ul de update dinamic
    const updateFields = [];
    const params = [];
    let paramCount = 1;

    if (name !== undefined) {
      updateFields.push(`name = $${paramCount}`);
      params.push(name);
      paramCount++;
    }
    if (short_name !== undefined) {
      updateFields.push(`short_name = $${paramCount}`);
      params.push(short_name || null);
      paramCount++;
    }
    if (type !== undefined) {
      updateFields.push(`type = $${paramCount}`);
      params.push(type);
      paramCount++;
    }
    if (contact_email !== undefined) {
      updateFields.push(`contact_email = $${paramCount}`);
      params.push(contact_email ? contact_email.toLowerCase() : null);
      paramCount++;
    }
    if (contact_phone !== undefined) {
      updateFields.push(`contact_phone = $${paramCount}`);
      params.push(contact_phone || null);
      paramCount++;
    }
    if (address !== undefined) {
      updateFields.push(`address = $${paramCount}`);
      params.push(address || null);
      paramCount++;
    }
    if (website !== undefined) {
      updateFields.push(`website = $${paramCount}`);
      params.push(website || null);
      paramCount++;
    }
    if (fiscal_code !== undefined) {
      updateFields.push(`fiscal_code = $${paramCount}`);
      params.push(fiscal_code || null);
      paramCount++;
    }
    if (registration_no !== undefined) {
      updateFields.push(`registration_no = $${paramCount}`);
      params.push(registration_no || null);
      paramCount++;
    }
    if (is_active !== undefined) {
      updateFields.push(`is_active = $${paramCount}`);
      params.push(is_active);
      paramCount++;
    }
    
    // NEW: Representative fields
    if (representative_name !== undefined) {
      updateFields.push(`representative_name = $${paramCount}`);
      params.push(representative_name || null);
      paramCount++;
    }
    if (representative_position !== undefined) {
      updateFields.push(`representative_position = $${paramCount}`);
      params.push(representative_position || null);
      paramCount++;
    }
    if (representative_phone !== undefined) {
      updateFields.push(`representative_phone = $${paramCount}`);
      params.push(representative_phone || null);
      paramCount++;
    }
    if (representative_email !== undefined) {
      updateFields.push(`representative_email = $${paramCount}`);
      params.push(representative_email ? representative_email.toLowerCase() : null);
      paramCount++;
    }

    // Adaugă updated_at
    updateFields.push(`updated_at = NOW()`);

    // Adaugă ID-ul la parametri
    params.push(id);

    const query = `
      UPDATE institutions 
      SET ${updateFields.join(', ')}
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
// DELETE INSTITUTION
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
        COUNT(*) FILTER (WHERE type = 'AEROBIC_OPERATOR') as aerobic_operators,
        COUNT(*) FILTER (WHERE type = 'ANAEROBIC_OPERATOR') as anaerobic_operators,
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
// GET INSTITUTION CONTRACTS - SUMMARY
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

    const institution = institutionResult.rows[0];
    let contracts = [];

    // Get contracts based on institution type
    switch (institution.type) {
      case 'WASTE_COLLECTOR':
        const wasteContracts = await pool.query(`
          SELECT 'WASTE_COLLECTOR' as contract_type, id, contract_number, contract_date_start, contract_date_end, is_active
          FROM waste_collector_contracts
          WHERE institution_id = $1 AND deleted_at IS NULL
          ORDER BY contract_date_start DESC
        `, [id]);
        contracts = wasteContracts.rows;
        break;

      case 'SORTING_OPERATOR':
        const sortingContracts = await pool.query(`
          SELECT 'SORTING' as contract_type, id, contract_number, contract_date_start, contract_date_end, is_active
          FROM sorting_operator_contracts
          WHERE institution_id = $1 AND deleted_at IS NULL
          ORDER BY contract_date_start DESC
        `, [id]);
        contracts = sortingContracts.rows;
        break;

      case 'TMB_OPERATOR':
      case 'AEROBIC_OPERATOR':
      case 'ANAEROBIC_OPERATOR':
        // TMB contracts are linked by sector, not institution
        // Get sectors for this institution first
        const sectorsResult = await pool.query(`
          SELECT s.id 
          FROM institution_sectors ins
          JOIN sectors s ON ins.sector_id = s.id
          WHERE ins.institution_id = $1
        `, [id]);
        
        if (sectorsResult.rows.length > 0) {
          const sectorIds = sectorsResult.rows.map(r => r.id);
          const tmbContracts = await pool.query(`
            SELECT 'TMB' as contract_type, tc.id, tc.contract_number, tc.contract_date_start, tc.contract_date_end, tc.is_active,
                   s.sector_number, s.sector_name
            FROM tmb_contracts tc
            JOIN sectors s ON tc.sector_id = s.id
            WHERE tc.sector_id = ANY($1) AND tc.deleted_at IS NULL
            ORDER BY tc.contract_date_start DESC
          `, [sectorIds]);
          contracts = tmbContracts.rows;
        }
        break;

      case 'DISPOSAL_CLIENT':
      case 'LANDFILL':
        const disposalContracts = await pool.query(`
          SELECT 'DISPOSAL' as contract_type, dc.id, dc.contract_number, dc.contract_date_start, dc.contract_date_end, dc.is_active,
                 s.sector_number, s.sector_name
          FROM disposal_contracts dc
          LEFT JOIN disposal_contract_sectors dcs ON dc.id = dcs.contract_id
          LEFT JOIN sectors s ON dcs.sector_id = s.id
          WHERE dc.institution_id = $1 AND dc.deleted_at IS NULL
          ORDER BY dc.contract_date_start DESC
        `, [id]);
        contracts = disposalContracts.rows;
        break;
    }
    
    res.json({
      success: true,
      data: contracts,
      institution_type: institution.type
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
