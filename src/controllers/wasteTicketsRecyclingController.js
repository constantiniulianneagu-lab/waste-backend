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
      sectorId,
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
        wtr.sector_id,
        s.sector_name,
        s.sector_number,
        wtr.vehicle_number,
        wtr.delivered_quantity_kg,
        wtr.accepted_quantity_kg,
        wtr.delivered_quantity_tons,
        wtr.accepted_quantity_tons,
        wtr.difference_tons,
        CASE 
          WHEN wtr.delivered_quantity_tons > 0 
          THEN (wtr.accepted_quantity_tons / wtr.delivered_quantity_tons * 100)
          ELSE 0 
        END as acceptance_percentage,
        wtr.notes,
        wtr.created_by,
        u.email as created_by_email,
        wtr.created_at,
        wtr.updated_at
      FROM waste_tickets_recycling wtr
      JOIN institutions is ON wtr.supplier_id = is.id
      JOIN institutions ir ON wtr.recipient_id = ir.id
      JOIN waste_codes wc ON wtr.waste_code_id = wc.id
      JOIN sectors s ON wtr.sector_id = s.id
      LEFT JOIN users u ON wtr.created_by = u.id
      WHERE wtr.deleted_at IS NULL
    `;

    const params = [];
    let paramCount = 1;

    if (supplierId) {
      query += ` AND wtr.supplier_id = $${paramCount}`;
      params.push(supplierId);
      paramCount++;
    }

    if (recipientId) {
      query += ` AND wtr.recipient_id = $${paramCount}`;
      params.push(recipientId);
      paramCount++;
    }

    if (wasteCodeId) {
      query += ` AND wtr.waste_code_id = $${paramCount}`;
      params.push(wasteCodeId);
      paramCount++;
    }

    if (sectorId) {
      query += ` AND wtr.sector_id = $${paramCount}`;
      params.push(sectorId);
      paramCount++;
    }

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

    if (search) {
      query += ` AND (wtr.ticket_number ILIKE $${paramCount} OR wtr.vehicle_number ILIKE $${paramCount})`;
      params.push(`%${search}%`);
      paramCount++;
    }

    const countQuery = query.replace(/SELECT .+ FROM/s, 'SELECT COUNT(*) FROM');
    const countResult = await pool.query(countQuery, params);
    const total = parseInt(countResult.rows[0].count);

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
        wtr.recipient_id,
        ir.name as recipient_name,
        ir.type as recipient_type,
        wtr.waste_code_id,
        wc.code as waste_code,
        wc.description as waste_description,
        wtr.sector_id,
        s.sector_name,
        s.sector_number,
        wtr.vehicle_number,
        wtr.delivered_quantity_kg,
        wtr.accepted_quantity_kg,
        wtr.delivered_quantity_tons,
        wtr.accepted_quantity_tons,
        wtr.difference_tons,
        CASE 
          WHEN wtr.delivered_quantity_tons > 0 
          THEN (wtr.accepted_quantity_tons / wtr.delivered_quantity_tons * 100)
          ELSE 0 
        END as acceptance_percentage,
        wtr.notes,
        wtr.created_by,
        u.email as created_by_email,
        wtr.created_at,
        wtr.updated_at
      FROM waste_tickets_recycling wtr
      JOIN institutions is ON wtr.supplier_id = is.id
      JOIN institutions ir ON wtr.recipient_id = ir.id
      JOIN waste_codes wc ON wtr.waste_code_id = wc.id
      JOIN sectors s ON wtr.sector_id = s.id
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
      sectorId,
      vehicleNumber,
      deliveredQuantityKg,
      acceptedQuantityKg,
      notes
    } = req.body;

    // Required fields
    if (!ticketNumber || !ticketDate || !supplierId || !recipientId || 
        !wasteCodeId || !sectorId || !vehicleNumber || 
        !deliveredQuantityKg || acceptedQuantityKg === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Toate câmpurile obligatorii trebuie completate'
      });
    }

    const delivered = parseFloat(deliveredQuantityKg);
    const accepted = parseFloat(acceptedQuantityKg);

    if (delivered <= 0 || accepted < 0 || accepted > delivered) {
      return res.status(400).json({
        success: false,
        message: 'Cantități invalide'
      });
    }

    // Check duplicate ticket number
    const existingTicket = await pool.query(
      'SELECT id FROM waste_tickets_recycling WHERE ticket_number = $1 AND deleted_at IS NULL',
      [ticketNumber]
    );

    if (existingTicket.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Numărul de tichet există deja'
      });
    }

    // Validate supplier = TMB_OPERATOR
    const supplierResult = await pool.query(
      'SELECT type FROM institutions WHERE id = $1 AND deleted_at IS NULL',
      [supplierId]
    );

    if (supplierResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Furnizorul nu există'
      });
    }

    if (supplierResult.rows[0].type !== 'TMB_OPERATOR') {
      return res.status(400).json({
        success: false,
        message: 'Furnizorul trebuie să fie de tip TMB_OPERATOR'
      });
    }

    // Validate recipient = RECYCLING_CLIENT
    const recipientResult = await pool.query(
      'SELECT type FROM institutions WHERE id = $1 AND deleted_at IS NULL',
      [recipientId]
    );

    if (recipientResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Recipientul nu există'
      });
    }

    if (recipientResult.rows[0].type !== 'RECYCLING_CLIENT') {
      return res.status(400).json({
        success: false,
        message: 'Recipientul trebuie să fie de tip RECYCLING_CLIENT'
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

    // Insert ticket
    const result = await pool.query(
      `INSERT INTO waste_tickets_recycling (
        ticket_number, ticket_date, ticket_time, supplier_id, recipient_id,
        waste_code_id, sector_id, vehicle_number, delivered_quantity_kg, 
        accepted_quantity_kg, notes, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *`,
      [
        ticketNumber, ticketDate, ticketTime || '00:00:00', supplierId, recipientId,
        wasteCodeId, sectorId, vehicleNumber, delivered, accepted, 
        notes || null, req.user.userId
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
    const updates = [];
    const params = [];
    let paramCount = 1;

    const fields = [
      'ticketNumber', 'ticketDate', 'ticketTime', 'supplierId', 'recipientId',
      'wasteCodeId', 'sectorId', 'vehicleNumber', 'deliveredQuantityKg', 
      'acceptedQuantityKg', 'notes'
    ];

    const columnMap = {
      ticketNumber: 'ticket_number',
      ticketDate: 'ticket_date',
      ticketTime: 'ticket_time',
      supplierId: 'supplier_id',
      recipientId: 'recipient_id',
      wasteCodeId: 'waste_code_id',
      sectorId: 'sector_id',
      vehicleNumber: 'vehicle_number',
      deliveredQuantityKg: 'delivered_quantity_kg',
      acceptedQuantityKg: 'accepted_quantity_kg',
      notes: 'notes'
    };

    // Validate sector if provided
    if (req.body.sectorId) {
      const sectorResult = await pool.query(
        'SELECT id FROM sectors WHERE id = $1 AND is_active = true',
        [req.body.sectorId]
      );

      if (sectorResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Sectorul specificat nu există sau nu este activ'
        });
      }
    }

    fields.forEach(field => {
      if (req.body[field] !== undefined) {
        updates.push(`${columnMap[field]} = $${paramCount}`);
        params.push(req.body[field]);
        paramCount++;
      }
    });

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Nicio modificare specificată'
      });
    }

    updates.push(`updated_at = NOW()`);
    params.push(id);

    const result = await pool.query(
      `UPDATE waste_tickets_recycling 
       SET ${updates.join(', ')}
       WHERE id = $${paramCount} AND deleted_at IS NULL
       RETURNING *`,
      params
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Tichet negăsit'
      });
    }

    res.json({
      success: true,
      message: 'Tichet actualizat cu succes',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Update recycling ticket error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la actualizare'
    });
  }
};

// ============================================================================
// DELETE RECYCLING TICKET (SOFT DELETE)
// ============================================================================
export const deleteRecyclingTicket = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'UPDATE waste_tickets_recycling SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING id',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Tichet negăsit'
      });
    }

    res.json({
      success: true,
      message: 'Tichet șters cu succes'
    });
  } catch (error) {
    console.error('Delete recycling ticket error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la ștergere'
    });
  }
};

// ============================================================================
// GET RECYCLING STATISTICS
// ============================================================================
export const getRecyclingStats = async (req, res) => {
  try {
    const { startDate, endDate, recipientId, sectorId } = req.query;

    let query = `
      SELECT 
        COUNT(*) as total_tickets,
        SUM(delivered_quantity_tons) as total_delivered_tons,
        SUM(accepted_quantity_tons) as total_accepted_tons,
        SUM(difference_tons) as total_difference_tons
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

    if (sectorId) {
      query += ` AND sector_id = $${paramCount}`;
      params.push(sectorId);
    }

    const result = await pool.query(query, params);

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
        acceptance_rate: parseFloat(acceptanceRate)
      }
    });
  } catch (error) {
    console.error('Get recycling stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la obținerea statisticilor'
    });
  }
};