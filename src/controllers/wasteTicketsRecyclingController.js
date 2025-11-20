// src/controllers/wasteTicketsRecyclingController.js
import pool from '../config/database.js';

// ============================================================================
// GET ALL RECYCLING TICKETS (with pagination & filters)
// ============================================================================
export const getAllRecyclingTickets = async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 20, 
      supplierId,
      recipientId,
      wasteCodeId,
      startDate,
      endDate,
      search 
    } = req.query;

    const offset = (page - 1) * limit;

    let query = `
      SELECT 
        wtr.id,
        wtr.ticket_number,
        wtr.ticket_date,
        wtr.ticket_time,
        wtr.supplier_id,
        is.name as supplier_name,
        is.type as supplier_type,
        wtr.recipient_id,
        ir.name as recipient_name,
        ir.type as recipient_type,
        wtr.waste_code_id,
        wc.code as waste_code,
        wc.description as waste_description,
        wc.category as waste_category,
        wtr.vehicle_number,
        wtr.delivered_quantity_kg,
        wtr.accepted_quantity_kg,
        wtr.delivered_quantity_tons,
        wtr.accepted_quantity_tons,
        wtr.difference_kg,
        wtr.difference_tons,
        wtr.notes,
        wtr.created_by,
        u.email as created_by_email,
        wtr.created_at,
        wtr.updated_at
      FROM waste_tickets_recycling wtr
      JOIN institutions is ON wtr.supplier_id = is.id
      JOIN institutions ir ON wtr.recipient_id = ir.id
      JOIN waste_codes wc ON wtr.waste_code_id = wc.id
      LEFT JOIN users u ON wtr.created_by = u.id
      WHERE wtr.deleted_at IS NULL
    `;

    const params = [];
    let paramCount = 1;

    // Filter by supplier
    if (supplierId) {
      query += ` AND wtr.supplier_id = $${paramCount}`;
      params.push(supplierId);
      paramCount++;
    }

    // Filter by recipient
    if (recipientId) {
      query += ` AND wtr.recipient_id = $${paramCount}`;
      params.push(recipientId);
      paramCount++;
    }

    // Filter by waste code
    if (wasteCodeId) {
      query += ` AND wtr.waste_code_id = $${paramCount}`;
      params.push(wasteCodeId);
      paramCount++;
    }

    // Filter by date range
    if (startDate) {
      query += ` AND wtr.ticket_date >= $${paramCount}`;
      params.push(startDate);
      paramCount++;
    }

    if (endDate) {
      query += ` AND wtr.ticket_date <= $${paramCount}`;
      params.push(endDate);
      paramCount++;
    }

    // Search by ticket number or vehicle number
    if (search) {
      query += ` AND (wtr.ticket_number ILIKE $${paramCount} OR wtr.vehicle_number ILIKE $${paramCount})`;
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
    query += ` ORDER BY wtr.ticket_date DESC, wtr.ticket_time DESC 
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
    console.error('Get recycling tickets error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la obținerea tichetelor de reciclare'
    });
  }
};

// ============================================================================
// GET SINGLE RECYCLING TICKET BY ID
// ============================================================================
export const getRecyclingTicketById = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT 
        wtr.id,
        wtr.ticket_number,
        wtr.ticket_date,
        wtr.ticket_time,
        wtr.supplier_id,
        is.name as supplier_name,
        is.type as supplier_type,
        is.contact_email as supplier_email,
        wtr.recipient_id,
        ir.name as recipient_name,
        ir.type as recipient_type,
        ir.contact_email as recipient_email,
        wtr.waste_code_id,
        wc.code as waste_code,
        wc.description as waste_description,
        wc.category as waste_category,
        wtr.vehicle_number,
        wtr.delivered_quantity_kg,
        wtr.accepted_quantity_kg,
        wtr.delivered_quantity_tons,
        wtr.accepted_quantity_tons,
        wtr.difference_kg,
        wtr.difference_tons,
        wtr.notes,
        wtr.created_by,
        u.email as created_by_email,
        u.first_name as created_by_first_name,
        u.last_name as created_by_last_name,
        wtr.created_at,
        wtr.updated_at
      FROM waste_tickets_recycling wtr
      JOIN institutions is ON wtr.supplier_id = is.id
      JOIN institutions ir ON wtr.recipient_id = ir.id
      JOIN waste_codes wc ON wtr.waste_code_id = wc.id
      LEFT JOIN users u ON wtr.created_by = u.id
      WHERE wtr.id = $1 AND wtr.deleted_at IS NULL`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Tichet de reciclare negăsit'
      });
    }

    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Get recycling ticket error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la obținerea tichetului de reciclare'
    });
  }
};

// ============================================================================
// CREATE RECYCLING TICKET
// ============================================================================
export const createRecyclingTicket = async (req, res) => {
  try {
    const {
      ticketNumber,
      ticketDate,
      ticketTime,
      supplierId,
      recipientId,
      wasteCodeId,
      vehicleNumber,
      deliveredQuantityKg,
      acceptedQuantityKg,
      notes
    } = req.body;

    // ========== VALIDATION ==========

    // Required fields
    if (!ticketNumber || !ticketDate || !ticketTime || !supplierId || 
        !recipientId || !wasteCodeId || !vehicleNumber || 
        !deliveredQuantityKg || acceptedQuantityKg === undefined) {
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

    // Check if ticket number already exists
    const existingTicket = await pool.query(
      'SELECT id FROM waste_tickets_recycling WHERE ticket_number = $1 AND deleted_at IS NULL',
      [ticketNumber]
    );

    if (existingTicket.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Numărul de tichet există deja în sistem'
      });
    }

    // ========== VALIDATE SUPPLIER = TMB_OPERATOR ==========
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

    if (supplier.type !== 'TMB_OPERATOR') {
      return res.status(400).json({
        success: false,
        message: `Furnizorul trebuie să fie de tip TMB_OPERATOR (stație TMB). Tip actual: ${supplier.type}`
      });
    }

    // ========== VALIDATE RECIPIENT = RECYCLING_CLIENT ==========
    const recipientResult = await pool.query(
      'SELECT id, type, name FROM institutions WHERE id = $1 AND deleted_at IS NULL',
      [recipientId]
    );

    if (recipientResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Recipientul specificat nu există'
      });
    }

    const recipient = recipientResult.rows[0];

    if (recipient.type !== 'RECYCLING_CLIENT') {
      return res.status(400).json({
        success: false,
        message: `Recipientul trebuie să fie de tip RECYCLING_CLIENT (reciclator). Tip actual: ${recipient.type}`
      });
    }

    // ========== VALIDATE WASTE CODE (recyclable materials) ==========
    const wasteCodeResult = await pool.query(
      'SELECT id, code, description, category FROM waste_codes WHERE id = $1 AND is_active = true',
      [wasteCodeId]
    );

    if (wasteCodeResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Codul de deșeu specificat nu există sau nu este activ'
      });
    }

    const wasteCode = wasteCodeResult.rows[0];

    // Validate waste code is recyclable
    const validRecyclableCodes = ['19 12 04', '15 01 04', '15 01 02'];
    
    if (!validRecyclableCodes.includes(wasteCode.code)) {
      return res.status(400).json({
        success: false,
        message: `Codul de deșeu trebuie să fie unul dintre: ${validRecyclableCodes.join(', ')} (materiale reciclabile). Cod specificat: ${wasteCode.code}`
      });
    }

    // ========== INSERT TICKET ==========
    const result = await pool.query(
      `INSERT INTO waste_tickets_recycling (
        ticket_number,
        ticket_date,
        ticket_time,
        supplier_id,
        recipient_id,
        waste_code_id,
        vehicle_number,
        delivered_quantity_kg,
        accepted_quantity_kg,
        notes,
        created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING 
        id,
        ticket_number,
        ticket_date,
        ticket_time,
        supplier_id,
        recipient_id,
        waste_code_id,
        vehicle_number,
        delivered_quantity_kg,
        accepted_quantity_kg,
        delivered_quantity_tons,
        accepted_quantity_tons,
        difference_kg,
        difference_tons,
        notes,
        created_by,
        created_at`,
      [
        ticketNumber,
        ticketDate,
        ticketTime,
        supplierId,
        recipientId,
        wasteCodeId,
        vehicleNumber,
        delivered,
        accepted,
        notes || null,
        req.user.userId // from auth middleware
      ]
    );

    res.status(201).json({
      success: true,
      message: 'Tichet de reciclare creat cu succes',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Create recycling ticket error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la crearea tichetului de reciclare'
    });
  }
};

// ============================================================================
// UPDATE RECYCLING TICKET
// ============================================================================
export const updateRecyclingTicket = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      ticketNumber,
      ticketDate,
      ticketTime,
      supplierId,
      recipientId,
      wasteCodeId,
      vehicleNumber,
      deliveredQuantityKg,
      acceptedQuantityKg,
      notes
    } = req.body;

    // Check if ticket exists
    const existingTicket = await pool.query(
      'SELECT id FROM waste_tickets_recycling WHERE id = $1 AND deleted_at IS NULL',
      [id]
    );

    if (existingTicket.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Tichet de reciclare negăsit'
      });
    }

    // Validate ticket number uniqueness (if changed)
    if (ticketNumber) {
      const duplicateCheck = await pool.query(
        'SELECT id FROM waste_tickets_recycling WHERE ticket_number = $1 AND id != $2 AND deleted_at IS NULL',
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

    // Validate supplier = TMB_OPERATOR (if changed)
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

      if (supplierResult.rows[0].type !== 'TMB_OPERATOR') {
        return res.status(400).json({
          success: false,
          message: 'Furnizorul trebuie să fie de tip TMB_OPERATOR'
        });
      }
    }

    // Validate recipient = RECYCLING_CLIENT (if changed)
    if (recipientId) {
      const recipientResult = await pool.query(
        'SELECT id, type FROM institutions WHERE id = $1 AND deleted_at IS NULL',
        [recipientId]
      );

      if (recipientResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Recipientul specificat nu există'
        });
      }

      if (recipientResult.rows[0].type !== 'RECYCLING_CLIENT') {
        return res.status(400).json({
          success: false,
          message: 'Recipientul trebuie să fie de tip RECYCLING_CLIENT'
        });
      }
    }

    // Validate waste code (if changed)
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

      const validRecyclableCodes = ['19 12 04', '15 01 04', '15 01 02'];
      
      if (!validRecyclableCodes.includes(wasteCodeResult.rows[0].code)) {
        return res.status(400).json({
          success: false,
          message: `Codul de deșeu trebuie să fie unul dintre: ${validRecyclableCodes.join(', ')}`
        });
      }
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
    if (recipientId) {
      updates.push(`recipient_id = $${paramCount}`);
      params.push(recipientId);
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
    if (notes !== undefined) {
      updates.push(`notes = $${paramCount}`);
      params.push(notes);
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
      UPDATE waste_tickets_recycling 
      SET ${updates.join(', ')}
      WHERE id = $${paramCount}
      RETURNING 
        id,
        ticket_number,
        ticket_date,
        ticket_time,
        supplier_id,
        recipient_id,
        waste_code_id,
        vehicle_number,
        delivered_quantity_kg,
        accepted_quantity_kg,
        delivered_quantity_tons,
        accepted_quantity_tons,
        difference_kg,
        difference_tons,
        notes,
        updated_at
    `;

    const result = await pool.query(query, params);

    res.json({
      success: true,
      message: 'Tichet de reciclare actualizat cu succes',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Update recycling ticket error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la actualizarea tichetului de reciclare'
    });
  }
};

// ============================================================================
// DELETE RECYCLING TICKET (SOFT DELETE)
// ============================================================================
export const deleteRecyclingTicket = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if ticket exists
    const existingTicket = await pool.query(
      'SELECT id FROM waste_tickets_recycling WHERE id = $1 AND deleted_at IS NULL',
      [id]
    );

    if (existingTicket.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Tichet de reciclare negăsit'
      });
    }

    // Soft delete (set deleted_at timestamp)
    await pool.query(
      'UPDATE waste_tickets_recycling SET deleted_at = NOW() WHERE id = $1',
      [id]
    );

    res.json({
      success: true,
      message: 'Tichet de reciclare șters cu succes'
    });
  } catch (error) {
    console.error('Delete recycling ticket error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la ștergerea tichetului de reciclare'
    });
  }
};

// ============================================================================
// GET RECYCLING STATISTICS
// ============================================================================
export const getRecyclingStats = async (req, res) => {
  try {
    const { startDate, endDate, recipientId } = req.query;

    let query = `
      SELECT 
        COUNT(*) as total_tickets,
        SUM(delivered_quantity_tons) as total_delivered_tons,
        SUM(accepted_quantity_tons) as total_accepted_tons,
        SUM(difference_tons) as total_difference_tons,
        AVG(accepted_quantity_tons) as avg_accepted_per_ticket,
        MIN(ticket_date) as first_ticket_date,
        MAX(ticket_date) as last_ticket_date
      FROM waste_tickets_recycling
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

    if (recipientId) {
      query += ` AND recipient_id = $${paramCount}`;
      params.push(recipientId);
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
        total_difference_tons: parseFloat(result.rows[0].total_difference_tons) || 0,
        acceptance_rate: parseFloat(acceptanceRate),
        avg_accepted_per_ticket: parseFloat(result.rows[0].avg_accepted_per_ticket) || 0,
        first_ticket_date: result.rows[0].first_ticket_date,
        last_ticket_date: result.rows[0].last_ticket_date
      }
    });
  } catch (error) {
    console.error('Get recycling stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la obținerea statisticilor de reciclare'
    });
  }
};