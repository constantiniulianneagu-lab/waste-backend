// src/controllers/institutionController.js
import pool from '../config/database.js';

// GET ALL INSTITUTIONS (with sectors)
// GET ALL INSTITUTIONS (with sectors) + SCOPE FILTERING
export const getAllInstitutions = async (req, res) => {
  try {
    const { limit = 1000, type, search } = req.query;

    const access = req.userAccess; // setat de resolveUserAccess
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
      whereConditions.push(`(i.name ILIKE $${paramCount} OR i.short_name ILIKE $${paramCount})`);
      params.push(`%${search}%`);
      paramCount++;
    }

    // ------------------------------------------------------------
    // VISIBILITY SCOPE:
    // - PLATFORM_ADMIN: vede tot
    // - ADMIN/EDITOR (PMB): vede tot
    // - ADMIN/EDITOR (S1..S6): vede doar:
    //   a) instituțiile asociate în institution_sectors la sectorul lor
    //   b) instituțiile care apar în tichete pe sectorul lor (supplier/recipient/operator)
    //   c) propria instituție (ca fallback)
    // ------------------------------------------------------------
    if (access.accessLevel !== 'ALL') {
      // $X = institutionId
      const instParam = paramCount;
      params.push(access.institutionId);
      paramCount++;

      // $Y = sectorIds uuid[]
      const sectorParam = paramCount;
      params.push(access.sectorIds);
      paramCount++;

      whereConditions.push(`
        (
          i.id = $${instParam}
          OR EXISTS (
            SELECT 1
            FROM institution_sectors ins
            WHERE ins.institution_id = i.id
              AND ins.sector_id = ANY($${sectorParam}::uuid[])
          )
          OR EXISTS (
            SELECT 1
            FROM waste_tickets_landfill w
            WHERE w.deleted_at IS NULL
              AND w.sector_id = ANY($${sectorParam}::uuid[])
              AND w.supplier_id = i.id
          )
          OR EXISTS (
            SELECT 1
            FROM waste_tickets_tmb w
            WHERE w.deleted_at IS NULL
              AND w.sector_id = ANY($${sectorParam}::uuid[])
              AND (w.supplier_id = i.id OR w.operator_id = i.id)
          )
          OR EXISTS (
            SELECT 1
            FROM waste_tickets_recycling w
            WHERE w.deleted_at IS NULL
              AND w.sector_id = ANY($${sectorParam}::uuid[])
              AND (w.supplier_id = i.id OR w.recipient_id = i.id)
          )
          OR EXISTS (
            SELECT 1
            FROM waste_tickets_recovery w
            WHERE w.deleted_at IS NULL
              AND w.sector_id = ANY($${sectorParam}::uuid[])
              AND (w.supplier_id = i.id OR w.recipient_id = i.id)
          )
          OR EXISTS (
            SELECT 1
            FROM waste_tickets_disposal w
            WHERE w.deleted_at IS NULL
              AND w.sector_id = ANY($${sectorParam}::uuid[])
              AND (w.supplier_id = i.id OR w.recipient_id = i.id)
          )
          OR EXISTS (
            SELECT 1
            FROM waste_tickets_rejected w
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


// GET SINGLE INSTITUTION + SCOPE CHECK
export const getInstitutionById = async (req, res) => {
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
              SELECT 1
              FROM institution_sectors ins
              WHERE ins.institution_id = i.id
                AND ins.sector_id = ANY($3::uuid[])
            )
            OR EXISTS (
              SELECT 1
              FROM waste_tickets_landfill w
              WHERE w.deleted_at IS NULL
                AND w.sector_id = ANY($3::uuid[])
                AND w.supplier_id = i.id
            )
            OR EXISTS (
              SELECT 1
              FROM waste_tickets_tmb w
              WHERE w.deleted_at IS NULL
                AND w.sector_id = ANY($3::uuid[])
                AND (w.supplier_id = i.id OR w.operator_id = i.id)
            )
            OR EXISTS (
              SELECT 1
              FROM waste_tickets_recycling w
              WHERE w.deleted_at IS NULL
                AND w.sector_id = ANY($3::uuid[])
                AND (w.supplier_id = i.id OR w.recipient_id = i.id)
            )
            OR EXISTS (
              SELECT 1
              FROM waste_tickets_recovery w
              WHERE w.deleted_at IS NULL
                AND w.sector_id = ANY($3::uuid[])
                AND (w.supplier_id = i.id OR w.recipient_id = i.id)
            )
            OR EXISTS (
              SELECT 1
              FROM waste_tickets_disposal w
              WHERE w.deleted_at IS NULL
                AND w.sector_id = ANY($3::uuid[])
                AND (w.supplier_id = i.id OR w.recipient_id = i.id)
            )
            OR EXISTS (
              SELECT 1
              FROM waste_tickets_rejected w
              WHERE w.deleted_at IS NULL
                AND w.sector_id = ANY($3::uuid[])
                AND (w.supplier_id = i.id OR w.operator_id = i.id)
            )
          )
        LIMIT 1
        `,
        [id, access.institutionId, access.sectorIds]
      );

      if (canSeeQ.rows.length === 0) {
        return res.status(403).json({
          success: false,
          message: 'Nu aveți acces la această instituție'
        });
      }
    }

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
        COUNT(*) FILTER (WHERE type = 'WASTE_COLLECTOR') as collectors
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
// ÎNLOCUIEȘTE funcția getInstitutionContracts din institutionController.js
// (de la linia ~330 până la sfârșit)
// CU ACEASTĂ VERSIUNE:
// ============================================================================

// GET INSTITUTION CONTRACTS - SIMPLIFIED (returns empty, use specific endpoints)
// Frontend trebuie să folosească endpoint-uri specifice:
// - /api/institutions/:id/tmb-contracts
// - /api/institutions/:id/waste-contracts
// - /api/institutions/:id/sorting-contracts
// - /api/institutions/:id/disposal-contracts
export const getInstitutionContracts = async (req, res) => {
  try {
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