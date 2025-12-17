// src/controllers/wasteTicketsTmbController.js
import pool from '../config/database.js';

// ============================================================================
// GET ALL TMB TICKETS (with pagination & filters)
// ============================================================================
export const getAllTmbTickets = async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 20, 
      sectorId,
      supplierId,
      tmbAssociationId,
      startDate,
      endDate,
      search 
    } = req.query;

    const offset = (page - 1) * limit;

    let query = `
      SELECT 
        wtt.id,
        wtt.ticket_number,
        wtt.ticket_date,
        wtt.ticket_time,
        wtt.supplier_id,
        i.name as supplier_name,
        i.type as supplier_type,
        wtt.tmb_association_id,
        ta.association_name,
        wtt.waste_code_id,
        wc.code as waste_code,
        wc.description as waste_description,
        wtt.sector_id,
        s.sector_name,
        wtt.vehicle_number,
        wtt.delivered_quantity_kg,
        wtt.accepted_quantity_kg,
        wtt.delivered_quantity_tons,
        wtt.accepted_quantity_tons,
        wtt.rejection_reason,
        wtt.generator_type,
        wtt.contract_type,
        wtt.created_by,
        u.email as created_by_email,
        wtt.created_at,
        wtt.updated_at
      FROM waste_tickets_tmb wtt
      JOIN institutions i ON wtt.supplier_id = i.id
      JOIN tmb_associations ta ON wtt.tmb_association_id = ta.id
      JOIN waste_codes wc ON wtt.waste_code_id = wc.id
      JOIN sectors s ON wtt.sector_id = s.id
      LEFT JOIN users u ON wtt.created_by = u.id
      WHERE wtt.deleted_at IS NULL
    `;

    const params = [];
    let paramCount = 1;

    // Filter by sector
    if (sectorId) {
      query += ` AND wtt.sector_id = $${paramCount}`;
      params.push(sectorId);
      paramCount++;
    }

    // Filter by supplier
    if (supplierId) {
      query += ` AND wtt.supplier_id = $${paramCount}`;
      params.push(supplierId);
      paramCount++;
    }

    // Filter by TMB association
    if (tmbAssociationId) {
      query += ` AND wtt.tmb_association_id = $${paramCount}`;
      params.push(tmbAssociationId);
      paramCount++;
    }

    // Filter by date range
    if (startDate) {
      query += ` AND wtt.ticket_date >= $${paramCount}`;
      params.push(startDate);
      paramCount++;
    }

    if (endDate) {
      query += ` AND wtt.ticket_date <= $${paramCount}`;
      params.push(endDate);
      paramCount++;
    }

    // Search by ticket number or vehicle number
    if (search) {
      query += ` AND (wtt.ticket_number ILIKE $${paramCount} OR wtt.vehicle_number ILIKE $${paramCount})`;
      params.push(`%${search}%`);
      paramCount++;
    }

    // Get total count
    const countQuery = query.replace(
      /SELECT .+ FROM/s, 
      'SELECT COUNT(*) FROM'
    );
    const countResult = await pool.query(countQuery, params);
    const total = parseInt(countResult.rows[0].count);

    // Add sorting and pagination
    query += ` ORDER BY wtt.ticket_date DESC, wtt.ticket_time DESC 
               LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    res.json({
      success: true,
      data: {
        tickets: result.rows,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          totalPages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    console.error('Get TMB tickets error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la obținerea tichetelor TMB'
    });
  }
};

// ============================================================================
// GET SINGLE TMB TICKET BY ID
// ============================================================================
export const getTmbTicketById = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT 
        wtt.id,
        wtt.ticket_number,
        wtt.ticket_date,
        wtt.ticket_time,
        wtt.supplier_id,
        i.name as supplier_name,
        i.type as supplier_type,
        wtt.tmb_association_id,
        ta.association_name,
        ta.primary_operator_id,
        ta.secondary_operator_id,
        io1.name as primary_operator_name,
        io2.name as secondary_operator_name,
        wtt.waste_code_id,
        wc.code as waste_code,
        wc.description as waste_description,
        wc.category as waste_category,
        wtt.sector_id,
        s.sector_name,
        s.sector_number,
        wtt.vehicle_number,
        wtt.delivered_quantity_kg,
        wtt.accepted_quantity_kg,
        wtt.delivered_quantity_tons,
        wtt.accepted_quantity_tons,
        wtt.rejection_reason,
        wtt.generator_type,
        wtt.contract_type,
        wtt.created_by,
        u.email as created_by_email,
        u.first_name as created_by_first_name,
        u.last_name as created_by_last_name,
        wtt.created_at,
        wtt.updated_at
      FROM waste_tickets_tmb wtt
      JOIN institutions i ON wtt.supplier_id = i.id
      JOIN tmb_associations ta ON wtt.tmb_association_id = ta.id
      LEFT JOIN institutions io1 ON ta.primary_operator_id = io1.id
      LEFT JOIN institutions io2 ON ta.secondary_operator_id = io2.id
      JOIN waste_codes wc ON wtt.waste_code_id = wc.id
      JOIN sectors s ON wtt.sector_id = s.id
      LEFT JOIN users u ON wtt.created_by = u.id
      WHERE wtt.id = $1 AND wtt.deleted_at IS NULL`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Tichet TMB negăsit'
      });
    }

    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Get TMB ticket error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la obținerea tichetului TMB'
    });
  }
};

// ============================================================================
// CREATE TMB TICKET
// ============================================================================
export const createTmbTicket = async (req, res) => {
  try {
    const {
      ticketNumber,
      ticketDate,
      ticketTime,
      supplierId,
      tmbAssociationId,
      wasteCodeId,
      sectorId,
      vehicleNumber,
      deliveredQuantityKg,
      acceptedQuantityKg,
      rejectionReason,
      generatorType,
      contractType
    } = req.body;

    // ========== VALIDATION ==========

    // Required fields
    if (!ticketNumber || !ticketDate || !ticketTime || !supplierId || 
        !tmbAssociationId || !wasteCodeId || !sectorId || 
        !vehicleNumber || !deliveredQuantityKg || acceptedQuantityKg === undefined ||
        !generatorType || !contractType) {
      return res.status(400).json({
        success: false,
        message: 'Toate câmpurile obligatorii trebuie completate'
      });
    }

    // Validate quantities
    const delivered = parseFloat(deliveredQuantityKg);
    const accepted = parseFloat(acceptedQuantityKg);

    if (isNaN(delivered) || delivered <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Cantitatea livrată trebuie să fie mai mare decât 0'
      });
    }

    if (isNaN(accepted) || accepted < 0) {
      return res.status(400).json({
        success: false,
        message: 'Cantitatea acceptată nu poate fi negativă'
      });
    }

    if (accepted > delivered) {
      return res.status(400).json({
        success: false,
        message: 'Cantitatea acceptată nu poate fi mai mare decât cantitatea livrată'
      });
    }

    // Validate contract type
    if (!['Taxa', 'Tarif'].includes(contractType)) {
      return res.status(400).json({
        success: false,
        message: 'Tip contract invalid. Valori acceptate: Taxa, Tarif'
      });
    }

    // Check if ticket number already exists
    const existingTicket = await pool.query(
      'SELECT id FROM waste_tickets_tmb WHERE ticket_number = $1 AND deleted_at IS NULL',
      [ticketNumber]
    );

    if (existingTicket.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Numărul de tichet există deja în sistem'
      });
    }

    // ========== VALIDATE SUPPLIER = WASTE_COLLECTOR ==========
    const supplierResult = await pool.query(
      'SELECT id, type, name FROM institutions WHERE id = $1 AND deleted_at IS NULL',
      [supplierId]
    );

    if (supplierResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Furnizorul specificat nu există'
      });
    }

    const supplier = supplierResult.rows[0];

    if (supplier.type !== 'WASTE_COLLECTOR') {
      return res.status(400).json({
        success: false,
        message: `Furnizorul trebuie să fie de tip WASTE_COLLECTOR. Tip actual: ${supplier.type}`
      });
    }

    // ========== CRITICAL: VALIDATE WASTE CODE = '20 03 01' ONLY ==========
    const wasteCodeResult = await pool.query(
      'SELECT id, code, description FROM waste_codes WHERE id = $1 AND is_active = true',
      [wasteCodeId]
    );

    if (wasteCodeResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Codul de deșeu specificat nu există sau nu este activ'
      });
    }

    const wasteCode = wasteCodeResult.rows[0];

    // CRITICAL VALIDATION: TMB accepts ONLY code 20 03 01
    if (wasteCode.code !== '20 03 01') {
      return res.status(400).json({
        success: false,
        message: `TMB acceptă DOAR codul de deșeu 20 03 01 (deșeuri municipale amestecate). Cod specificat: ${wasteCode.code}`
      });
    }

    // ========== VALIDATE TMB ASSOCIATION MATCHES SECTOR ==========
    const tmbAssociationResult = await pool.query(
      `SELECT ta.id, ta.sector_id, ta.association_name, ta.is_active,
              s.sector_name
       FROM tmb_associations ta
       JOIN sectors s ON ta.sector_id = s.id
       WHERE ta.id = $1`,
      [tmbAssociationId]
    );

    if (tmbAssociationResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Asocierea TMB specificată nu există'
      });
    }

    const tmbAssociation = tmbAssociationResult.rows[0];

    if (!tmbAssociation.is_active) {
      return res.status(400).json({
        success: false,
        message: 'Asocierea TMB specificată nu este activă'
      });
    }

    // CRITICAL: Verify TMB association sector matches ticket sector
    if (tmbAssociation.sector_id !== sectorId) {
      return res.status(400).json({
        success: false,
        message: `Asocierea TMB (${tmbAssociation.association_name}) nu corespunde sectorului specificat. Asocierea este pentru sectorul: ${tmbAssociation.sector_name}`
      });
    }

    // Validate sector exists
    const sectorResult = await pool.query(
      'SELECT id FROM sectors WHERE id = $1 AND is_active = true',
      [sectorId]
    );

    if (sectorResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Sectorul specificat nu există sau nu este activ'
      });
    }

    // ========== INSERT TICKET ==========
    const result = await pool.query(
      `INSERT INTO waste_tickets_tmb (
        ticket_number,
        ticket_date,
        ticket_time,
        supplier_id,
        tmb_association_id,
        waste_code_id,
        sector_id,
        vehicle_number,
        delivered_quantity_kg,
        accepted_quantity_kg,
        rejection_reason,
        generator_type,
        contract_type,
        created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING 
        id,
        ticket_number,
        ticket_date,
        ticket_time,
        supplier_id,
        tmb_association_id,
        waste_code_id,
        sector_id,
        vehicle_number,
        delivered_quantity_kg,
        accepted_quantity_kg,
        delivered_quantity_tons,
        accepted_quantity_tons,
        rejection_reason,
        generator_type,
        contract_type,
        created_by,
        created_at`,
      [
        ticketNumber,
        ticketDate,
        ticketTime,
        supplierId,
        tmbAssociationId,
        wasteCodeId,
        sectorId,
        vehicleNumber,
        delivered,
        accepted,
        rejectionReason || null,
        generatorType,
        contractType,
        req.user.userId // from auth middleware
      ]
    );

    res.status(201).json({
      success: true,
      message: 'Tichet TMB creat cu succes',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Create TMB ticket error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la crearea tichetului TMB'
    });
  }
};

// ============================================================================
// UPDATE TMB TICKET
// ============================================================================
export const updateTmbTicket = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      ticketNumber,
      ticketDate,
      ticketTime,
      supplierId,
      tmbAssociationId,
      wasteCodeId,
      sectorId,
      vehicleNumber,
      deliveredQuantityKg,
      acceptedQuantityKg,
      rejectionReason,
      generatorType,
      contractType
    } = req.body;

    // Check if ticket exists
    const existingTicket = await pool.query(
      'SELECT id FROM waste_tickets_tmb WHERE id = $1 AND deleted_at IS NULL',
      [id]
    );

    if (existingTicket.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Tichet TMB negăsit'
      });
    }

    // Validate ticket number uniqueness (if changed)
    if (ticketNumber) {
      const duplicateCheck = await pool.query(
        'SELECT id FROM waste_tickets_tmb WHERE ticket_number = $1 AND id != $2 AND deleted_at IS NULL',
        [ticketNumber, id]
      );

      if (duplicateCheck.rows.length > 0) {
        return res.status(400).json({
          success: false,
          message: 'Numărul de tichet există deja în sistem'
        });
      }
    }

    // Validate quantities if provided
    if (deliveredQuantityKg !== undefined && acceptedQuantityKg !== undefined) {
      const delivered = parseFloat(deliveredQuantityKg);
      const accepted = parseFloat(acceptedQuantityKg);

      if (accepted > delivered) {
        return res.status(400).json({
          success: false,
          message: 'Cantitatea acceptată nu poate fi mai mare decât cantitatea livrată'
        });
      }
    }

    // Validate supplier = WASTE_COLLECTOR (if changed)
    if (supplierId) {
      const supplierResult = await pool.query(
        'SELECT id, type FROM institutions WHERE id = $1 AND deleted_at IS NULL',
        [supplierId]
      );

      if (supplierResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Furnizorul specificat nu există'
        });
      }

      if (supplierResult.rows[0].type !== 'WASTE_COLLECTOR') {
        return res.status(400).json({
          success: false,
          message: 'Furnizorul trebuie să fie de tip WASTE_COLLECTOR'
        });
      }
    }

    // CRITICAL: Validate waste code = 20 03 01 (if changed)
    if (wasteCodeId) {
      const wasteCodeResult = await pool.query(
        'SELECT id, code FROM waste_codes WHERE id = $1 AND is_active = true',
        [wasteCodeId]
      );

      if (wasteCodeResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Codul de deșeu specificat nu există sau nu este activ'
        });
      }

      if (wasteCodeResult.rows[0].code !== '20 03 01') {
        return res.status(400).json({
          success: false,
          message: `TMB acceptă DOAR codul de deșeu 20 03 01. Cod specificat: ${wasteCodeResult.rows[0].code}`
        });
      }
    }

    // Validate TMB association matches sector (if changed)
    if (tmbAssociationId && sectorId) {
      const tmbAssociationResult = await pool.query(
        'SELECT sector_id FROM tmb_associations WHERE id = $1 AND is_active = true',
        [tmbAssociationId]
      );

      if (tmbAssociationResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Asocierea TMB specificată nu există sau nu este activă'
        });
      }

      if (tmbAssociationResult.rows[0].sector_id !== sectorId) {
        return res.status(400).json({
          success: false,
          message: 'Asocierea TMB nu corespunde sectorului specificat'
        });
      }
    }

    // Validate contract type (if changed)
    if (contractType && !['Taxa', 'Tarif'].includes(contractType)) {
      return res.status(400).json({
        success: false,
        message: 'Tip contract invalid. Valori acceptate: Taxa, Tarif'
      });
    }

    // Build dynamic update query
    const updates = [];
    const params = [];
    let paramCount = 1;

    if (ticketNumber) {
      updates.push(`ticket_number = $${paramCount}`);
      params.push(ticketNumber);
      paramCount++;
    }
    if (ticketDate) {
      updates.push(`ticket_date = $${paramCount}`);
      params.push(ticketDate);
      paramCount++;
    }
    if (ticketTime) {
      updates.push(`ticket_time = $${paramCount}`);
      params.push(ticketTime);
      paramCount++;
    }
    if (supplierId) {
      updates.push(`supplier_id = $${paramCount}`);
      params.push(supplierId);
      paramCount++;
    }
    if (tmbAssociationId) {
      updates.push(`tmb_association_id = $${paramCount}`);
      params.push(tmbAssociationId);
      paramCount++;
    }
    if (wasteCodeId) {
      updates.push(`waste_code_id = $${paramCount}`);
      params.push(wasteCodeId);
      paramCount++;
    }
    if (sectorId) {
      updates.push(`sector_id = $${paramCount}`);
      params.push(sectorId);
      paramCount++;
    }
    if (vehicleNumber) {
      updates.push(`vehicle_number = $${paramCount}`);
      params.push(vehicleNumber);
      paramCount++;
    }
    if (deliveredQuantityKg !== undefined) {
      updates.push(`delivered_quantity_kg = $${paramCount}`);
      params.push(parseFloat(deliveredQuantityKg));
      paramCount++;
    }
    if (acceptedQuantityKg !== undefined) {
      updates.push(`accepted_quantity_kg = $${paramCount}`);
      params.push(parseFloat(acceptedQuantityKg));
      paramCount++;
    }
    if (rejectionReason !== undefined) {
      updates.push(`rejection_reason = $${paramCount}`);
      params.push(rejectionReason);
      paramCount++;
    }
    if (generatorType) {
      updates.push(`generator_type = $${paramCount}`);
      params.push(generatorType);
      paramCount++;
    }
    if (contractType) {
      updates.push(`contract_type = $${paramCount}`);
      params.push(contractType);
      paramCount++;
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Nicio modificare specificată'
      });
    }

    updates.push(`updated_at = NOW()`);
    params.push(id);

    const query = `
      UPDATE waste_tickets_tmb 
      SET ${updates.join(', ')}
      WHERE id = $${paramCount}
      RETURNING 
        id,
        ticket_number,
        ticket_date,
        ticket_time,
        supplier_id,
        tmb_association_id,
        waste_code_id,
        sector_id,
        vehicle_number,
        delivered_quantity_kg,
        accepted_quantity_kg,
        delivered_quantity_tons,
        accepted_quantity_tons,
        rejection_reason,
        generator_type,
        contract_type,
        updated_at
    `;

    const result = await pool.query(query, params);

    res.json({
      success: true,
      message: 'Tichet TMB actualizat cu succes',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Update TMB ticket error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la actualizarea tichetului TMB'
    });
  }
};

// ============================================================================
// DELETE TMB TICKET (SOFT DELETE)
// ============================================================================
export const deleteTmbTicket = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if ticket exists
    const existingTicket = await pool.query(
      'SELECT id FROM waste_tickets_tmb WHERE id = $1 AND deleted_at IS NULL',
      [id]
    );

    if (existingTicket.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Tichet TMB negăsit'
      });
    }

    // Soft delete (set deleted_at timestamp)
    await pool.query(
      'UPDATE waste_tickets_tmb SET deleted_at = NOW() WHERE id = $1',
      [id]
    );

    res.json({
      success: true,
      message: 'Tichet TMB șters cu succes'
    });
  } catch (error) {
    console.error('Delete TMB ticket error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la ștergerea tichetului TMB'
    });
  }
};

// ============================================================================
// GET TMB STATISTICS
// ============================================================================
export const getTmbStats = async (req, res) => {
  try {
    const { startDate, endDate, sectorId } = req.query;

    let query = `
      SELECT 
        COUNT(*) as total_tickets,
        SUM(delivered_quantity_tons) as total_delivered_tons,
        SUM(accepted_quantity_tons) as total_accepted_tons,
        AVG(accepted_quantity_tons) as avg_accepted_per_ticket,
        MIN(ticket_date) as first_ticket_date,
        MAX(ticket_date) as last_ticket_date
      FROM waste_tickets_tmb
      WHERE deleted_at IS NULL
    `;

    const params = [];
    let paramCount = 1;

    if (startDate) {
      query += ` AND ticket_date >= $${paramCount}`;
      params.push(startDate);
      paramCount++;
    }

    if (endDate) {
      query += ` AND ticket_date <= $${paramCount}`;
      params.push(endDate);
      paramCount++;
    }

    if (sectorId) {
      query += ` AND sector_id = $${paramCount}`;
      params.push(sectorId);
      paramCount++;
    }

    const result = await pool.query(query, params);

    // Calculate acceptance rate
    const totalDelivered = parseFloat(result.rows[0].total_delivered_tons) || 0;
    const totalAccepted = parseFloat(result.rows[0].total_accepted_tons) || 0;
    const acceptanceRate = totalDelivered > 0 
      ? ((totalAccepted / totalDelivered) * 100).toFixed(2)
      : 0;

    res.json({
      success: true,
      data: {
        total_tickets: parseInt(result.rows[0].total_tickets) || 0,
        total_delivered_tons: totalDelivered,
        total_accepted_tons: totalAccepted,
        acceptance_rate: parseFloat(acceptanceRate),
        avg_accepted_per_ticket: parseFloat(result.rows[0].avg_accepted_per_ticket) || 0,
        first_ticket_date: result.rows[0].first_ticket_date,
        last_ticket_date: result.rows[0].last_ticket_date
      }
    });
  } catch (error) {
    console.error('Get TMB stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la obținerea statisticilor TMB'
    });
  }
};