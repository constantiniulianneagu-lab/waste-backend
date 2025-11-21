// src/controllers/wasteTicketsDisposalController.js
import pool from '../config/database.js';

// ============================================================================
// GET ALL DISPOSAL TICKETS (with pagination & filters)
// ============================================================================
export const getAllDisposalTickets = async (req, res) => {
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
        wtd.id,
        wtd.ticket_number,
        wtd.ticket_date,
        wtd.ticket_time,
        wtd.supplier_id,
        is.name as supplier_name,
        is.type as supplier_type,
        wtd.recipient_id,
        ir.name as recipient_name,
        ir.type as recipient_type,
        wtd.waste_code_id,
        wc.code as waste_code,
        wc.description as waste_description,
        wtd.vehicle_number,
        wtd.delivered_quantity_kg,
        wtd.accepted_quantity_kg,
        wtd.delivered_quantity_tons,
        wtd.accepted_quantity_tons,
        wtd.difference_kg,
        wtd.difference_tons,
        wtd.notes,
        wtd.created_by,
        u.email as created_by_email,
        wtd.created_at,
        wtd.updated_at
      FROM waste_tickets_disposal wtd
      JOIN institutions is ON wtd.supplier_id = is.id
      JOIN institutions ir ON wtd.recipient_id = ir.id
      JOIN waste_codes wc ON wtd.waste_code_id = wc.id
      LEFT JOIN users u ON wtd.created_by = u.id
      WHERE wtd.deleted_at IS NULL
    `;

    const params = [];
    let paramCount = 1;

    if (supplierId) {
      query += ` AND wtd.supplier_id = $${paramCount}`;
      params.push(supplierId);
      paramCount++;
    }

    if (recipientId) {
      query += ` AND wtd.recipient_id = $${paramCount}`;
      params.push(recipientId);
      paramCount++;
    }

    if (wasteCodeId) {
      query += ` AND wtd.waste_code_id = $${paramCount}`;
      params.push(wasteCodeId);
      paramCount++;
    }

    if (startDate) {
      query += ` AND wtd.ticket_date >= $${paramCount}`;
      params.push(startDate);
      paramCount++;
    }

    if (endDate) {
      query += ` AND wtd.ticket_date <= $${paramCount}`;
      params.push(endDate);
      paramCount++;
    }

    if (search) {
      query += ` AND (wtd.ticket_number ILIKE $${paramCount} OR wtd.vehicle_number ILIKE $${paramCount})`;
      params.push(`%${search}%`);
      paramCount++;
    }

    const countQuery = query.replace(/SELECT .+ FROM/s, 'SELECT COUNT(*) FROM');
    const countResult = await pool.query(countQuery, params);
    const total = parseInt(countResult.rows[0].count);

    query += ` ORDER BY wtd.ticket_date DESC, wtd.ticket_time DESC 
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
    console.error('Get disposal tickets error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la obținerea tichetelor de depozitare'
    });
  }
};

// GET BY ID
export const getDisposalTicketById = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT wtd.*, 
              is.name as supplier_name, is.type as supplier_type,
              ir.name as recipient_name, ir.type as recipient_type,
              wc.code as waste_code, wc.description as waste_description,
              u.email as created_by_email
       FROM waste_tickets_disposal wtd
       JOIN institutions is ON wtd.supplier_id = is.id
       JOIN institutions ir ON wtd.recipient_id = ir.id
       JOIN waste_codes wc ON wtd.waste_code_id = wc.id
       LEFT JOIN users u ON wtd.created_by = u.id
       WHERE wtd.id = $1 AND wtd.deleted_at IS NULL`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Tichet de depozitare negăsit'
      });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Get disposal ticket error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la obținerea tichetului de depozitare'
    });
  }
};

// CREATE
export const createDisposalTicket = async (req, res) => {
  try {
    const {
      ticketNumber, ticketDate, ticketTime, supplierId, recipientId,
      wasteCodeId, vehicleNumber, deliveredQuantityKg, acceptedQuantityKg, notes
    } = req.body;

    if (!ticketNumber || !ticketDate || !ticketTime || !supplierId || !recipientId ||
        !wasteCodeId || !vehicleNumber || !deliveredQuantityKg || acceptedQuantityKg === undefined) {
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

    // Validate recipient = DISPOSAL_CLIENT
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

    if (recipientResult.rows[0].type !== 'DISPOSAL_CLIENT') {
      return res.status(400).json({
        success: false,
        message: 'Recipientul trebuie să fie de tip DISPOSAL_CLIENT'
      });
    }

    const result = await pool.query(
      `INSERT INTO waste_tickets_disposal 
       (ticket_number, ticket_date, ticket_time, supplier_id, recipient_id,
        waste_code_id, vehicle_number, delivered_quantity_kg, accepted_quantity_kg,
        notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [ticketNumber, ticketDate, ticketTime, supplierId, recipientId,
       wasteCodeId, vehicleNumber, delivered, accepted, notes, req.user.userId]
    );

    res.status(201).json({
      success: true,
      message: 'Tichet de depozitare creat cu succes',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Create disposal ticket error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la crearea tichetului de depozitare'
    });
  }
};

// UPDATE
export const updateDisposalTicket = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = [];
    const params = [];
    let paramCount = 1;

    const fields = [
      'ticketNumber', 'ticketDate', 'ticketTime', 'supplierId', 'recipientId',
      'wasteCodeId', 'vehicleNumber', 'deliveredQuantityKg', 'acceptedQuantityKg', 'notes'
    ];

    const columnMap = {
      ticketNumber: 'ticket_number',
      ticketDate: 'ticket_date',
      ticketTime: 'ticket_time',
      supplierId: 'supplier_id',
      recipientId: 'recipient_id',
      wasteCodeId: 'waste_code_id',
      vehicleNumber: 'vehicle_number',
      deliveredQuantityKg: 'delivered_quantity_kg',
      acceptedQuantityKg: 'accepted_quantity_kg',
      notes: 'notes'
    };

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
      `UPDATE waste_tickets_disposal 
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
    console.error('Update disposal ticket error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la actualizare'
    });
  }
};

// DELETE (soft)
export const deleteDisposalTicket = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'UPDATE waste_tickets_disposal SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING id',
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
    console.error('Delete disposal ticket error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la ștergere'
    });
  }
};

// STATS
export const getDisposalStats = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    let query = `
      SELECT 
        COUNT(*) as total_tickets,
        SUM(delivered_quantity_tons) as total_delivered_tons,
        SUM(accepted_quantity_tons) as total_accepted_tons,
        SUM(difference_tons) as total_difference_tons
      FROM waste_tickets_disposal
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
    }

    const result = await pool.query(query, params);

    res.json({
      success: true,
      data: {
        total_tickets: parseInt(result.rows[0].total_tickets) || 0,
        total_delivered_tons: parseFloat(result.rows[0].total_delivered_tons) || 0,
        total_accepted_tons: parseFloat(result.rows[0].total_accepted_tons) || 0,
        total_difference_tons: parseFloat(result.rows[0].total_difference_tons) || 0
      }
    });
  } catch (error) {
    console.error('Get disposal stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la obținerea statisticilor'
    });
  }
};