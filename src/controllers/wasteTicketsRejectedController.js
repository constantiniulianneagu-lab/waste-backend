// src/controllers/wasteTicketsRejectedController.js
import pool from '../config/database.js';

// ============================================================================
// GET ALL REJECTED TICKETS (with pagination & filters)
// ============================================================================
export const getAllRejectedTickets = async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 20, 
      supplierId,
      tmbAssociationId,
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
        i.name as supplier_name,
        i.type as supplier_type,
        wtr.tmb_association_id,
        ta.association_name,
        wtr.waste_code_id,
        wc.code as waste_code,
        wc.description as waste_description,
        wtr.vehicle_number,
        wtr.rejected_quantity_kg,
        wtr.rejected_quantity_tons,
        wtr.rejection_reason,
        wtr.created_by,
        u.email as created_by_email,
        wtr.created_at,
        wtr.updated_at
      FROM waste_tickets_rejected wtr
      JOIN institutions i ON wtr.supplier_id = i.id
      JOIN tmb_associations ta ON wtr.tmb_association_id = ta.id
      JOIN waste_codes wc ON wtr.waste_code_id = wc.id
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

    if (tmbAssociationId) {
      query += ` AND wtr.tmb_association_id = $${paramCount}`;
      params.push(tmbAssociationId);
      paramCount++;
    }

    if (wasteCodeId) {
      query += ` AND wtr.waste_code_id = $${paramCount}`;
      params.push(wasteCodeId);
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
    console.error('Get rejected tickets error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la obținerea tichetelor refuzate'
    });
  }
};

// GET BY ID
export const getRejectedTicketById = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT wtr.*, 
              i.name as supplier_name, i.type as supplier_type,
              ta.association_name,
              wc.code as waste_code, wc.description as waste_description,
              u.email as created_by_email
       FROM waste_tickets_rejected wtr
       JOIN institutions i ON wtr.supplier_id = i.id
       JOIN tmb_associations ta ON wtr.tmb_association_id = ta.id
       JOIN waste_codes wc ON wtr.waste_code_id = wc.id
       LEFT JOIN users u ON wtr.created_by = u.id
       WHERE wtr.id = $1 AND wtr.deleted_at IS NULL`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Tichet refuzat negăsit'
      });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Get rejected ticket error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la obținerea tichetului refuzat'
    });
  }
};

// CREATE
export const createRejectedTicket = async (req, res) => {
  try {
    const {
      ticketNumber, ticketDate, ticketTime, supplierId, tmbAssociationId,
      wasteCodeId, vehicleNumber, rejectedQuantityKg, rejectionReason
    } = req.body;

    if (!ticketNumber || !ticketDate || !ticketTime || !supplierId || !tmbAssociationId ||
        !wasteCodeId || !vehicleNumber || !rejectedQuantityKg) {
      return res.status(400).json({
        success: false,
        message: 'Toate câmpurile obligatorii trebuie completate'
      });
    }

    const rejected = parseFloat(rejectedQuantityKg);

    if (rejected <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Cantitatea refuzată trebuie să fie mai mare decât 0'
      });
    }

    // Validate supplier = WASTE_COLLECTOR
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

    if (supplierResult.rows[0].type !== 'WASTE_COLLECTOR') {
      return res.status(400).json({
        success: false,
        message: 'Furnizorul trebuie să fie de tip WASTE_COLLECTOR'
      });
    }

    // Validate TMB association exists
    const tmbResult = await pool.query(
      'SELECT id FROM tmb_associations WHERE id = $1 AND is_active = true',
      [tmbAssociationId]
    );

    if (tmbResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Asocierea TMB nu există sau nu este activă'
      });
    }

    const result = await pool.query(
      `INSERT INTO waste_tickets_rejected 
       (ticket_number, ticket_date, ticket_time, supplier_id, tmb_association_id,
        waste_code_id, vehicle_number, rejected_quantity_kg, rejection_reason, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [ticketNumber, ticketDate, ticketTime, supplierId, tmbAssociationId,
       wasteCodeId, vehicleNumber, rejected, rejectionReason, req.user.userId]
    );

    res.status(201).json({
      success: true,
      message: 'Tichet refuzat creat cu succes',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Create rejected ticket error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la crearea tichetului refuzat'
    });
  }
};

// UPDATE
export const updateRejectedTicket = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = [];
    const params = [];
    let paramCount = 1;

    const fields = [
      'ticketNumber', 'ticketDate', 'ticketTime', 'supplierId', 'tmbAssociationId',
      'wasteCodeId', 'vehicleNumber', 'rejectedQuantityKg', 'rejectionReason'
    ];

    const columnMap = {
      ticketNumber: 'ticket_number',
      ticketDate: 'ticket_date',
      ticketTime: 'ticket_time',
      supplierId: 'supplier_id',
      tmbAssociationId: 'tmb_association_id',
      wasteCodeId: 'waste_code_id',
      vehicleNumber: 'vehicle_number',
      rejectedQuantityKg: 'rejected_quantity_kg',
      rejectionReason: 'rejection_reason'
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
      `UPDATE waste_tickets_rejected 
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
    console.error('Update rejected ticket error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la actualizare'
    });
  }
};

// DELETE (soft)
export const deleteRejectedTicket = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'UPDATE waste_tickets_rejected SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING id',
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
    console.error('Delete rejected ticket error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la ștergere'
    });
  }
};

// STATS
export const getRejectedStats = async (req, res) => {
  try {
    const { startDate, endDate, supplierId } = req.query;

    let query = `
      SELECT 
        COUNT(*) as total_tickets,
        SUM(rejected_quantity_tons) as total_rejected_tons,
        AVG(rejected_quantity_tons) as avg_rejected_per_ticket
      FROM waste_tickets_rejected
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

    if (supplierId) {
      query += ` AND supplier_id = $${paramCount}`;
      params.push(supplierId);
    }

    const result = await pool.query(query, params);

    res.json({
      success: true,
      data: {
        total_tickets: parseInt(result.rows[0].total_tickets) || 0,
        total_rejected_tons: parseFloat(result.rows[0].total_rejected_tons) || 0,
        avg_rejected_per_ticket: parseFloat(result.rows[0].avg_rejected_per_ticket) || 0
      }
    });
  } catch (error) {
    console.error('Get rejected stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la obținerea statisticilor'
    });
  }
};