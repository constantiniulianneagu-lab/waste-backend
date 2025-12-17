// src/controllers/wasteTicketsLandfillController.js
import pool from '../config/database.js';

// ============================================================================
// GET ALL LANDFILL TICKETS (with pagination & filters)
// ============================================================================
export const getAllLandfillTickets = async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 20, 
      sectorId,
      supplierId,
      wasteCodeId,
      startDate,
      endDate,
      search 
    } = req.query;

    const offset = (page - 1) * limit;

    let query = `
      SELECT 
        wtl.id,
        wtl.ticket_number,
        wtl.ticket_date,
        wtl.ticket_time,
        wtl.supplier_id,
        i.name as supplier_name,
        i.type as supplier_type,
        wtl.waste_code_id,
        wc.code as waste_code,
        wc.description as waste_description,
        wtl.vehicle_number,
        wtl.sector_id,
        s.sector_name,
        wtl.gross_weight_kg,
        wtl.tare_weight_kg,
        wtl.net_weight_kg,
        wtl.net_weight_tons,
        wtl.generator_type,
        wtl.operation_type,
        wtl.contract_type,
        wtl.created_by,
        u.email as created_by_email,
        wtl.created_at,
        wtl.updated_at
      FROM waste_tickets_landfill wtl
      JOIN institutions i ON wtl.supplier_id = i.id
      JOIN waste_codes wc ON wtl.waste_code_id = wc.id
      JOIN sectors s ON wtl.sector_id = s.id
      LEFT JOIN users u ON wtl.created_by = u.id
      WHERE wtl.deleted_at IS NULL
    `;

    const params = [];
    let paramCount = 1;

    // Filter by sector
    if (sectorId) {
      query += ` AND wtl.sector_id = $${paramCount}`;
      params.push(sectorId);
      paramCount++;
    }

    // Filter by supplier
    if (supplierId) {
      query += ` AND wtl.supplier_id = $${paramCount}`;
      params.push(supplierId);
      paramCount++;
    }

    // Filter by waste code
    if (wasteCodeId) {
      query += ` AND wtl.waste_code_id = $${paramCount}`;
      params.push(wasteCodeId);
      paramCount++;
    }

    // Filter by date range
    if (startDate) {
      query += ` AND wtl.ticket_date >= $${paramCount}`;
      params.push(startDate);
      paramCount++;
    }

    if (endDate) {
      query += ` AND wtl.ticket_date <= $${paramCount}`;
      params.push(endDate);
      paramCount++;
    }

    // Search by ticket number or vehicle number
    if (search) {
      query += ` AND (wtl.ticket_number ILIKE $${paramCount} OR wtl.vehicle_number ILIKE $${paramCount})`;
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
    query += ` ORDER BY wtl.ticket_date DESC, wtl.ticket_time DESC 
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
    console.error('Get landfill tickets error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la obținerea tichetelor de depozitare'
    });
  }
};

// ============================================================================
// GET SINGLE LANDFILL TICKET BY ID
// ============================================================================
export const getLandfillTicketById = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT 
        wtl.id,
        wtl.ticket_number,
        wtl.ticket_date,
        wtl.ticket_time,
        wtl.supplier_id,
        i.name as supplier_name,
        i.type as supplier_type,
        wtl.waste_code_id,
        wc.code as waste_code,
        wc.description as waste_description,
        wc.category as waste_category,
        wtl.vehicle_number,
        wtl.sector_id,
        s.sector_name,
        s.sector_number,
        wtl.gross_weight_kg,
        wtl.tare_weight_kg,
        wtl.net_weight_kg,
        wtl.net_weight_tons,
        wtl.generator_type,
        wtl.operation_type,
        wtl.contract_type,
        wtl.created_by,
        u.email as created_by_email,
        u.first_name as created_by_first_name,
        u.last_name as created_by_last_name,
        wtl.created_at,
        wtl.updated_at
      FROM waste_tickets_landfill wtl
      JOIN institutions i ON wtl.supplier_id = i.id
      JOIN waste_codes wc ON wtl.waste_code_id = wc.id
      JOIN sectors s ON wtl.sector_id = s.id
      LEFT JOIN users u ON wtl.created_by = u.id
      WHERE wtl.id = $1 AND wtl.deleted_at IS NULL`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Tichet de depozitare negăsit'
      });
    }

    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Get landfill ticket error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la obținerea tichetului de depozitare'
    });
  }
};

// ============================================================================
// CREATE LANDFILL TICKET
// ============================================================================
export const createLandfillTicket = async (req, res) => {
  try {
    const {
      ticketNumber,
      ticketDate,
      ticketTime,
      supplierId,
      wasteCodeId,
      vehicleNumber,
      sectorId,
      grossWeightKg,
      tareWeightKg,
      generatorType,
      operationType,
      contractType
    } = req.body;

    // ========== VALIDATION ==========

    // Required fields
    if (!ticketNumber || !ticketDate || !ticketTime || !supplierId || 
        !wasteCodeId || !vehicleNumber || !sectorId || 
        !grossWeightKg || tareWeightKg === undefined || 
        !generatorType || !operationType || !contractType) {
      return res.status(400).json({
        success: false,
        message: 'Toate câmpurile obligatorii trebuie completate'
      });
    }

    // Validate weights
    const gross = parseFloat(grossWeightKg);
    const tare = parseFloat(tareWeightKg);

    if (isNaN(gross) || gross <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Greutatea brută trebuie să fie mai mare decât 0'
      });
    }

    if (isNaN(tare) || tare < 0) {
      return res.status(400).json({
        success: false,
        message: 'Greutatea tară nu poate fi negativă'
      });
    }

    if (gross <= tare) {
      return res.status(400).json({
        success: false,
        message: 'Greutatea brută trebuie să fie mai mare decât greutatea tară'
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
      'SELECT id FROM waste_tickets_landfill WHERE ticket_number = $1 AND deleted_at IS NULL',
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

    // Validate waste code exists
    const wasteCodeResult = await pool.query(
      'SELECT id FROM waste_codes WHERE id = $1 AND is_active = true',
      [wasteCodeId]
    );

    if (wasteCodeResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Codul de deșeu specificat nu există sau nu este activ'
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
      `INSERT INTO waste_tickets_landfill (
        ticket_number,
        ticket_date,
        ticket_time,
        supplier_id,
        waste_code_id,
        vehicle_number,
        sector_id,
        gross_weight_kg,
        tare_weight_kg,
        generator_type,
        operation_type,
        contract_type,
        created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING 
        id,
        ticket_number,
        ticket_date,
        ticket_time,
        supplier_id,
        waste_code_id,
        vehicle_number,
        sector_id,
        gross_weight_kg,
        tare_weight_kg,
        net_weight_kg,
        net_weight_tons,
        generator_type,
        operation_type,
        contract_type,
        created_by,
        created_at`,
      [
        ticketNumber,
        ticketDate,
        ticketTime,
        supplierId,
        wasteCodeId,
        vehicleNumber,
        sectorId,
        gross,
        tare,
        generatorType,
        operationType,
        contractType,
        req.user.userId // from auth middleware
      ]
    );

    res.status(201).json({
      success: true,
      message: 'Tichet de depozitare creat cu succes',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Create landfill ticket error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la crearea tichetului de depozitare'
    });
  }
};

// ============================================================================
// UPDATE LANDFILL TICKET
// ============================================================================
export const updateLandfillTicket = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      ticketNumber,
      ticketDate,
      ticketTime,
      supplierId,
      wasteCodeId,
      vehicleNumber,
      sectorId,
      grossWeightKg,
      tareWeightKg,
      generatorType,
      operationType,
      contractType
    } = req.body;

    // Check if ticket exists
    const existingTicket = await pool.query(
      'SELECT id FROM waste_tickets_landfill WHERE id = $1 AND deleted_at IS NULL',
      [id]
    );

    if (existingTicket.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Tichet de depozitare negăsit'
      });
    }

    // Validate ticket number uniqueness (if changed)
    if (ticketNumber) {
      const duplicateCheck = await pool.query(
        'SELECT id FROM waste_tickets_landfill WHERE ticket_number = $1 AND id != $2 AND deleted_at IS NULL',
        [ticketNumber, id]
      );

      if (duplicateCheck.rows.length > 0) {
        return res.status(400).json({
          success: false,
          message: 'Numărul de tichet există deja în sistem'
        });
      }
    }

    // Validate weights if provided
    if (grossWeightKg !== undefined && tareWeightKg !== undefined) {
      const gross = parseFloat(grossWeightKg);
      const tare = parseFloat(tareWeightKg);

      if (gross <= tare) {
        return res.status(400).json({
          success: false,
          message: 'Greutatea brută trebuie să fie mai mare decât greutatea tară'
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

    // Validate waste code (if changed)
    if (wasteCodeId) {
      const wasteCodeResult = await pool.query(
        'SELECT id FROM waste_codes WHERE id = $1 AND is_active = true',
        [wasteCodeId]
      );

      if (wasteCodeResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Codul de deșeu specificat nu există sau nu este activ'
        });
      }
    }

    // Validate sector (if changed)
    if (sectorId) {
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
    if (wasteCodeId) {
      updates.push(`waste_code_id = $${paramCount}`);
      params.push(wasteCodeId);
      paramCount++;
    }
    if (vehicleNumber) {
      updates.push(`vehicle_number = $${paramCount}`);
      params.push(vehicleNumber);
      paramCount++;
    }
    if (sectorId) {
      updates.push(`sector_id = $${paramCount}`);
      params.push(sectorId);
      paramCount++;
    }
    if (grossWeightKg !== undefined) {
      updates.push(`gross_weight_kg = $${paramCount}`);
      params.push(parseFloat(grossWeightKg));
      paramCount++;
    }
    if (tareWeightKg !== undefined) {
      updates.push(`tare_weight_kg = $${paramCount}`);
      params.push(parseFloat(tareWeightKg));
      paramCount++;
    }
    if (generatorType) {
      updates.push(`generator_type = $${paramCount}`);
      params.push(generatorType);
      paramCount++;
    }
    if (operationType) {
      updates.push(`operation_type = $${paramCount}`);
      params.push(operationType);
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
      UPDATE waste_tickets_landfill 
      SET ${updates.join(', ')}
      WHERE id = $${paramCount}
      RETURNING 
        id,
        ticket_number,
        ticket_date,
        ticket_time,
        supplier_id,
        waste_code_id,
        vehicle_number,
        sector_id,
        gross_weight_kg,
        tare_weight_kg,
        net_weight_kg,
        net_weight_tons,
        generator_type,
        operation_type,
        contract_type,
        updated_at
    `;

    const result = await pool.query(query, params);

    res.json({
      success: true,
      message: 'Tichet de depozitare actualizat cu succes',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Update landfill ticket error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la actualizarea tichetului de depozitare'
    });
  }
};

// ============================================================================
// DELETE LANDFILL TICKET (SOFT DELETE)
// ============================================================================
export const deleteLandfillTicket = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if ticket exists
    const existingTicket = await pool.query(
      'SELECT id FROM waste_tickets_landfill WHERE id = $1 AND deleted_at IS NULL',
      [id]
    );

    if (existingTicket.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Tichet de depozitare negăsit'
      });
    }

    // Soft delete (set deleted_at timestamp)
    await pool.query(
      'UPDATE waste_tickets_landfill SET deleted_at = NOW() WHERE id = $1',
      [id]
    );

    res.json({
      success: true,
      message: 'Tichet de depozitare șters cu succes'
    });
  } catch (error) {
    console.error('Delete landfill ticket error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la ștergerea tichetului de depozitare'
    });
  }
};

// ============================================================================
// GET LANDFILL STATISTICS
// ============================================================================
export const getLandfillStats = async (req, res) => {
  try {
    const { startDate, endDate, sectorId } = req.query;

    let query = `
      SELECT 
        COUNT(*) as total_tickets,
        SUM(net_weight_tons) as total_tons,
        AVG(net_weight_tons) as avg_tons_per_ticket,
        MIN(ticket_date) as first_ticket_date,
        MAX(ticket_date) as last_ticket_date
      FROM waste_tickets_landfill
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

    res.json({
      success: true,
      data: {
        total_tickets: parseInt(result.rows[0].total_tickets) || 0,
        total_tons: parseFloat(result.rows[0].total_tons) || 0,
        avg_tons_per_ticket: parseFloat(result.rows[0].avg_tons_per_ticket) || 0,
        first_ticket_date: result.rows[0].first_ticket_date,
        last_ticket_date: result.rows[0].last_ticket_date
      }
    });
  } catch (error) {
    console.error('Get landfill stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la obținerea statisticilor'
    });
  }
};