// src/controllers/institutionController.js
import pool from '../config/database.js';

// GET ALL INSTITUTIONS
export const getAllInstitutions = async (req, res) => {
  try {
    const { page = 1, limit = 10, type, sector, search } = req.query;
    const offset = (page - 1) * limit;

    let query = `
      SELECT id, name, short_name, type, sector, contact_email, contact_phone,
             address, website, fiscal_code, registration_no, is_active, 
             created_at, updated_at
      FROM institutions 
      WHERE deleted_at IS NULL
    `;
    const params = [];
    let paramCount = 1;

    // Filter by type
    if (type) {
      query += ` AND type = $${paramCount}`;
      params.push(type);
      paramCount++;
    }

    // Filter by sector
    if (sector) {
      query += ` AND sector = $${paramCount}`;
      params.push(sector);
      paramCount++;
    }

    // Search by name or email
    if (search) {
      query += ` AND (name ILIKE $${paramCount} OR contact_email ILIKE $${paramCount})`;
      params.push(`%${search}%`);
      paramCount++;
    }

    // Get total count
    const countResult = await pool.query(
      query.replace('SELECT id, name, short_name, type, sector, contact_email, contact_phone, address, website, fiscal_code, registration_no, is_active, created_at, updated_at', 'SELECT COUNT(*)'),
      params
    );
    const total = parseInt(countResult.rows[0].count);

    // Add pagination
    query += ` ORDER BY created_at DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    res.json({
      success: true,
      data: {
        institutions: result.rows,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          totalPages: Math.ceil(total / limit)
        }
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

// GET SINGLE INSTITUTION
export const getInstitutionById = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT id, name, short_name, type, sector, contact_email, contact_phone,
              address, website, fiscal_code, registration_no, is_active, 
              created_at, updated_at
       FROM institutions 
       WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );

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

// CREATE INSTITUTION - păstrăm așa cum e (nu schimbăm)
export const createInstitution = async (req, res) => {
  try {
    const { name, type, sector, contactEmail } = req.body;

    // Validare
    if (!name || !type || !sector || !contactEmail) {
      return res.status(400).json({
        success: false,
        message: 'Toate câmpurile sunt obligatorii'
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

    // Inserează instituție
    const result = await pool.query(
      `INSERT INTO institutions (name, type, sector, contact_email, is_active)
       VALUES ($1, $2, $3, $4, true)
       RETURNING id, name, type, sector, contact_email, is_active, created_at`,
      [name, type, sector, contactEmail.toLowerCase()]
    );

    res.status(201).json({
      success: true,
      message: 'Instituție creată cu succes',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Create institution error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la crearea instituției'
    });
  }
};

// UPDATE INSTITUTION - păstrăm așa cum e (nu schimbăm)
export const updateInstitution = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, type, sector, contactEmail, isActive } = req.body;

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

    // Verifică dacă noul nume e deja folosit
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

    // Construiește query dinamic
    const updates = [];
    const params = [];
    let paramCount = 1;

    if (name) {
      updates.push(`name = $${paramCount}`);
      params.push(name);
      paramCount++;
    }
    if (type) {
      updates.push(`type = $${paramCount}`);
      params.push(type);
      paramCount++;
    }
    if (sector) {
      updates.push(`sector = $${paramCount}`);
      params.push(sector);
      paramCount++;
    }
    if (contactEmail) {
      updates.push(`contact_email = $${paramCount}`);
      params.push(contactEmail.toLowerCase());
      paramCount++;
    }
    if (isActive !== undefined) {
      updates.push(`is_active = $${paramCount}`);
      params.push(isActive);
      paramCount++;
    }

    updates.push(`updated_at = NOW()`);
    params.push(id);

    const query = `
      UPDATE institutions 
      SET ${updates.join(', ')}
      WHERE id = $${paramCount}
      RETURNING id, name, type, sector, contact_email, is_active, updated_at
    `;

    const result = await pool.query(query, params);

    res.json({
      success: true,
      message: 'Instituție actualizată cu succes',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Update institution error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la actualizarea instituției'
    });
  }
};

// DELETE INSTITUTION - păstrăm așa cum e (nu schimbăm)
export const deleteInstitution = async (req, res) => {
  try {
    const { id } = req.params;

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

    // Soft delete
    await pool.query(
      'UPDATE institutions SET deleted_at = NOW() WHERE id = $1',
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

// GET INSTITUTION STATISTICS - păstrăm așa cum e (nu schimbăm)
export const getInstitutionStats = async (req, res) => {
  try {
    const stats = await pool.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE is_active = true) as active,
        COUNT(*) FILTER (WHERE type = 'MUNICIPALITY') as municipalities,
        COUNT(*) FILTER (WHERE type = 'WASTE_OPERATOR') as operators
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

// GET INSTITUTION CONTRACTS (TMB) - CONTRACTS FOR BOTH PRIMARY AND SECONDARY
export const getInstitutionContracts = async (req, res) => {
  try {
    const { id } = req.params;
    
    console.log('Getting contracts for institution:', id);
    
    // 1. Get institution to check type
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
    console.log('Institution:', institution);
    
    // 2. Only TMB operators have contracts
    if (institution.type !== 'TMB_OPERATOR') {
      return res.json({
        success: true,
        data: [],
        metadata: {
          total_contracts: 0,
          active_contracts: 0,
          total_value: 0
        }
      });
    }
    
    // 3. Get associations WHERE THIS INSTITUTION IS PRIMARY **OR** SECONDARY OPERATOR
    // ✅ FIX: Include BOTH primary_operator_id AND secondary_operator_id
    const associationsResult = await pool.query(
      `SELECT 
        a.sector_id, 
        s.sector_name,
        CASE 
          WHEN a.primary_operator_id = $1 THEN 'PRIMARY'
          WHEN a.secondary_operator_id = $1 THEN 'SECONDARY'
        END as role
       FROM tmb_associations a
       LEFT JOIN sectors s ON s.id = a.sector_id
       WHERE (a.primary_operator_id = $1 OR a.secondary_operator_id = $1)
       AND a.is_active = true`,
      [id]
    );
    
    console.log('Associations found:', associationsResult.rows.length);
    console.log('Association roles:', associationsResult.rows);
    
    const sectorIds = associationsResult.rows.map(a => a.sector_id);
    
    if (sectorIds.length === 0) {
      return res.json({
        success: true,
        data: [],
        metadata: {
          total_contracts: 0,
          active_contracts: 0,
          total_value: 0
        }
      });
    }
    
    console.log('Sector IDs:', sectorIds);
    
    // 4. Get contracts for these sectors
    const placeholders = sectorIds.map((_, i) => `$${i + 1}`).join(',');
    const contractsResult = await pool.query(
      `SELECT 
        c.*,
        COALESCE(s.sector_name, s.sector_number::text, c.sector_id::text) as sector_name,
        -- ✅ Determină dacă contractul e activ pe bază de date
        CASE 
          WHEN c.is_active = false THEN false
          WHEN c.contract_date_end IS NOT NULL AND c.contract_date_end < CURRENT_DATE THEN false
          WHEN c.contract_date_start > CURRENT_DATE THEN false
          ELSE true
        END as is_currently_active
       FROM tmb_contracts c
       LEFT JOIN sectors s ON s.id = c.sector_id
       WHERE c.sector_id IN (${placeholders})
       AND c.deleted_at IS NULL
       ORDER BY c.contract_date_start DESC`,
      sectorIds
    );
    
    console.log('Contracts found:', contractsResult.rows.length);
    
    const contracts = contractsResult.rows;
    
    // 5. Get amendments for these contracts
    const contractIds = contracts.map(c => c.id);
    let amendments = [];
    
    if (contractIds.length > 0) {
      const amendmentPlaceholders = contractIds.map((_, i) => `$${i + 1}`).join(',');
      const amendmentsResult = await pool.query(
        `SELECT *
         FROM tmb_contract_amendments
         WHERE contract_id IN (${amendmentPlaceholders})
         AND deleted_at IS NULL
         ORDER BY amendment_date DESC`,
        contractIds
      );
      amendments = amendmentsResult.rows;
      console.log('Amendments found:', amendments.length);
    }
    
    // 6. Group amendments by contract
    const amendmentsByContract = {};
    amendments.forEach(a => {
      if (!amendmentsByContract[a.contract_id]) {
        amendmentsByContract[a.contract_id] = [];
      }
      amendmentsByContract[a.contract_id].push(a);
    });
    
    // 7. Attach amendments to contracts și folosește is_currently_active
    const contractsWithAmendments = contracts.map(c => ({
      ...c,
      is_active: c.is_currently_active, // ✅ Folosește statusul calculat pe bază de date
      amendments: amendmentsByContract[c.id] || []
    }));
    
    // 8. Calculate metadata
    const totalValue = contractsWithAmendments.reduce((sum, c) => {
      return sum + (parseFloat(c.contract_value) || 0);
    }, 0);
    
    const activeContracts = contractsWithAmendments.filter(c => c.is_active).length;
    
    console.log('Returning contracts:', {
      total: contractsWithAmendments.length,
      active: activeContracts,
      total_value: totalValue
    });
    
    res.json({
      success: true,
      data: contractsWithAmendments,
      metadata: {
        total_contracts: contractsWithAmendments.length,
        active_contracts: activeContracts,
        total_value: totalValue
      }
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