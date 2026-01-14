// src/controllers/wasteTicketsRecyclingController.js
// ============================================================================
// RECYCLING TICKETS CONTROLLER (RBAC via req.userAccess, UUID sector scoping)
// ============================================================================
// Middleware expectations (from routes):
// - authenticateToken
// - resolveUserAccess => sets req.userAccess { accessLevel, sectorIds, ... }
// - enforceSectorAccess => validates requested sector & sets req.requestedSectorUuid
// - authorizeAdminOnly on POST/PUT/DELETE (routes handle CRUD restriction)
//
// IMPORTANT:
// - waste_tickets_recycling.sector_id is UUID
// - NO role checks here.
// ============================================================================

import pool from '../config/database.js';

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------
const clampInt = (v, min, max, fallback) => {
  const n = parseInt(String(v), 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

const isNonEmpty = (v) => v !== undefined && v !== null && String(v).trim() !== '';

const isoDate = (d) => new Date(d).toISOString().split('T')[0];

const assertValidDate = (dateStr, fieldName) => {
  if (!dateStr || typeof dateStr !== 'string') throw new Error(`Invalid ${fieldName}`);
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid ${fieldName}: ${dateStr}`);
  return dateStr;
};

const buildSectorScope = (req, alias = 't') => {
  const access = req.userAccess;
  if (!access) throw new Error('Missing req.userAccess (resolveUserAccess not applied)');

  const isAll = access.accessLevel === 'ALL';
  const visibleSectorIds = Array.isArray(access.visibleSectorIds) ? access.visibleSectorIds : [];
  const requestedSectorUuid = req.requestedSectorUuid || null;

  let sectorWhere = '';
  const sectorParams = [];

  if (requestedSectorUuid) {
    sectorWhere = `AND ${alias}.sector_id = ${{}}`;
    sectorParams.push(requestedSectorUuid);
  } else if (!isAll) {
    sectorWhere = `AND ${alias}.sector_id = ANY(${{}})`;
    sectorParams.push(visibleSectorIds);
  }

  return { sectorWhere, sectorParams, requestedSectorUuid };
};

const applyParamIndex = (sqlWithPlaceholders, startIndex) => {
  let idx = startIndex;
  return sqlWithPlaceholders.replace(/\$\{\{\}\}/g, () => `$${idx++}`);
};

const buildListFilters = (req, alias = 't') => {
  const {
    year,
    from,
    to,
    supplier_id,
    recipient_id,
    waste_code_id,
    vehicle_number,
    ticket_number,
    search,
  } = req.query;

  const now = new Date();
  const y = isNonEmpty(year) ? clampInt(year, 2000, 2100, now.getFullYear()) : now.getFullYear();
  const startDate = assertValidDate(from || `${y}-01-01`, 'from');
  const endDate = assertValidDate(to || isoDate(now), 'to');

  if (new Date(startDate) > new Date(endDate)) {
    const err = new Error('`from` must be <= `to`');
    err.statusCode = 400;
    throw err;
  }

  const where = [
    `${alias}.deleted_at IS NULL`,
    `${alias}.ticket_date >= $1`,
    `${alias}.ticket_date <= $2`,
  ];

  const params = [startDate, endDate];
  let p = 3;

  // Sector scope
  const scope = buildSectorScope(req, alias);
  if (scope.sectorWhere) {
    where.push(applyParamIndex(scope.sectorWhere, p));
    params.push(...scope.sectorParams);
    p += scope.sectorParams.length;
  }

  // Optional filters
  if (isNonEmpty(supplier_id)) {
    where.push(`${alias}.supplier_id = $${p++}`);
    params.push(parseInt(String(supplier_id), 10));
  }

  if (isNonEmpty(recipient_id)) {
    where.push(`${alias}.recipient_id = $${p++}`);
    params.push(parseInt(String(recipient_id), 10));
  }

  if (isNonEmpty(waste_code_id)) {
    where.push(`${alias}.waste_code_id = $${p++}`);
    params.push(String(waste_code_id));
  }

  if (isNonEmpty(vehicle_number)) {
    where.push(`${alias}.vehicle_number ILIKE $${p++}`);
    params.push(`%${String(vehicle_number).trim()}%`);
  }

  if (isNonEmpty(ticket_number)) {
    where.push(`${alias}.ticket_number ILIKE $${p++}`);
    params.push(`%${String(ticket_number).trim()}%`);
  }

  if (isNonEmpty(search)) {
    where.push(`(${alias}.ticket_number ILIKE $${p} OR ${alias}.vehicle_number ILIKE $${p})`);
    params.push(`%${String(search).trim()}%`);
    p++;
  }

  return { whereSql: where.join(' AND '), params, nextIndex: p, startDate, endDate, year: y, requestedSectorUuid: scope.requestedSectorUuid };
};

// ----------------------------------------------------------------------------
// READ: GET /api/tickets/recycling
// ----------------------------------------------------------------------------
export const getAllRecyclingTickets = async (req, res) => {
  try {
    // Check if user has access to TMB page
    const { scopes } = req.userAccess;
    if (scopes?.tmb === 'NONE') {
      return res.status(403).json({ 
        success: false, 
        message: 'Nu aveți permisiune să accesați pagina TMB' 
      });
    }

    const { page = 1, limit = 50, sort_by = 'ticket_date', sort_dir = 'desc' } = req.query;

    const pageNum = clampInt(page, 1, 1000000, 1);
    const limitNum = clampInt(limit, 1, 500, 50);
    const offset = (pageNum - 1) * limitNum;

    const f = buildListFilters(req, 't');

    const sortMap = {
      ticket_date: 't.ticket_date',
      ticket_number: 't.ticket_number',
      sector_number: 's.sector_number',
      supplier_name: 'sup.name',
      recipient_name: 'rec.name',
      delivered_quantity_tons: 't.delivered_quantity_tons',
      accepted_quantity_tons: 't.accepted_quantity_tons',
      vehicle_number: 't.vehicle_number',
      created_at: 't.created_at',
    };
    const sortCol = sortMap[sort_by] || 't.ticket_date';
    const dir = String(sort_dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    const countSql = `
      SELECT COUNT(*)::INTEGER AS total
      FROM waste_tickets_recycling t
      JOIN sectors s ON t.sector_id = s.id
      JOIN institutions sup ON t.supplier_id = sup.id
      JOIN institutions rec ON t.recipient_id = rec.id
      JOIN waste_codes wc ON t.waste_code_id = wc.id
      WHERE ${f.whereSql}
    `;
    const countRes = await pool.query(countSql, f.params);
    const total = countRes.rows[0]?.total || 0;

    const listParams = [...f.params];
    const pLimit = f.nextIndex;
    const pOffset = f.nextIndex + 1;
    listParams.push(limitNum, offset);

    const listSql = `
      SELECT
        t.id,
        t.ticket_number,
        t.ticket_date,
        t.ticket_time,
        s.id as sector_id,
        s.sector_number,
        s.sector_name,
        sup.id as supplier_id,
        sup.name as supplier_name,
        rec.id as recipient_id,
        rec.name as recipient_name,
        wc.id as waste_code_id,
        wc.code as waste_code,
        wc.description as waste_description,
        t.vehicle_number,
        t.delivered_quantity_kg,
        t.accepted_quantity_kg,
        t.delivered_quantity_tons,
        t.accepted_quantity_tons,
        t.difference_tons,
        t.stock_month,
        t.created_at,
        t.updated_at
      FROM waste_tickets_recycling t
      JOIN sectors s ON t.sector_id = s.id
      JOIN institutions sup ON t.supplier_id = sup.id
      JOIN institutions rec ON t.recipient_id = rec.id
      JOIN waste_codes wc ON t.waste_code_id = wc.id
      WHERE ${f.whereSql}
      ORDER BY ${sortCol} ${dir}, t.created_at ${dir}
      LIMIT $${pLimit} OFFSET $${pOffset}
    `;
    const listRes = await pool.query(listSql, listParams);

    return res.json({
      success: true,
      data: {
        items: listRes.rows,
        pagination: {
          total,
          page: pageNum,
          limit: limitNum,
          totalPages: Math.ceil(total / limitNum),
        },
        filters_applied: {
          from: f.startDate,
          to: f.endDate,
          year: f.year,
          sector_uuid: f.requestedSectorUuid || null,
        },
      },
    });
  } catch (err) {
    console.error('getAllRecyclingTickets error:', err);
    const code = err.statusCode || 500;
    return res.status(code).json({ success: false, message: 'Failed to fetch recycling tickets', error: err.message });
  }
};

// ----------------------------------------------------------------------------
// READ: GET /api/tickets/recycling/:id
// ----------------------------------------------------------------------------
export const getRecyclingTicketById = async (req, res) => {
  try {
    // Check if user has access to TMB page
    const { scopes } = req.userAccess;
    if (scopes?.tmb === 'NONE') {
      return res.status(403).json({ 
        success: false, 
        message: 'Nu aveți permisiune să accesați pagina TMB' 
      });
    }

    const { id } = req.params;
    const ticketId = parseInt(String(id), 10);

    if (Number.isNaN(ticketId)) {
      return res.status(400).json({ success: false, message: 'Invalid ticket id' });
    }

    // RBAC scope for single-item
    const scope = buildSectorScope(req, 't');

    let sql = `
      SELECT
        t.id,
        t.ticket_number,
        t.ticket_date,
        t.ticket_time,
        s.id as sector_id,
        s.sector_number,
        s.sector_name,
        sup.id as supplier_id,
        sup.name as supplier_name,
        rec.id as recipient_id,
        rec.name as recipient_name,
        wc.id as waste_code_id,
        wc.code as waste_code,
        wc.description as waste_description,
        t.vehicle_number,
        t.delivered_quantity_kg,
        t.accepted_quantity_kg,
        t.delivered_quantity_tons,
        t.accepted_quantity_tons,
        t.difference_tons,
        t.stock_month,
        t.created_at,
        t.updated_at
      FROM waste_tickets_recycling t
      JOIN sectors s ON t.sector_id = s.id
      JOIN institutions sup ON t.supplier_id = sup.id
      JOIN institutions rec ON t.recipient_id = rec.id
      JOIN waste_codes wc ON t.waste_code_id = wc.id
      WHERE t.deleted_at IS NULL
        AND t.id = $1
    `;

    const params = [ticketId];
    let p = 2;

    if (scope.sectorWhere) {
      sql += ` ${applyParamIndex(scope.sectorWhere, p)}`;
      params.push(...scope.sectorParams);
      p += scope.sectorParams.length;
    }

    const result = await pool.query(sql, params);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Ticket not found' });
    }

    return res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error('getRecyclingTicketById error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch ticket', error: err.message });
  }
};

// ----------------------------------------------------------------------------
// STATS: GET /api/tickets/recycling/stats
// ----------------------------------------------------------------------------
export const getRecyclingStats = async (req, res) => {
  try {
    // Check if user has access to TMB page
    const { scopes } = req.userAccess;
    if (scopes?.tmb === 'NONE') {
      return res.status(403).json({ 
        success: false, 
        message: 'Nu aveți permisiune să accesați pagina TMB' 
      });
    }

    const f = buildListFilters(req, 't');

    const summarySql = `
      SELECT
        COUNT(*)::INTEGER as total_tickets,
        COALESCE(SUM(t.delivered_quantity_tons), 0) as delivered_tons,
        COALESCE(SUM(t.accepted_quantity_tons), 0) as accepted_tons,
        COALESCE(SUM(t.difference_tons), 0) as difference_tons
      FROM waste_tickets_recycling t
      WHERE ${f.whereSql}
    `;
    const summaryRes = await pool.query(summarySql, f.params);
    const s = summaryRes.rows[0] || {};
    const delivered = Number(s.delivered_tons || 0);
    const accepted = Number(s.accepted_tons || 0);
    const rate = delivered > 0 ? (accepted / delivered) * 100 : 0;

    const bySectorSql = `
      SELECT
        s.sector_number,
        s.sector_name,
        COUNT(*)::INTEGER as ticket_count,
        COALESCE(SUM(t.delivered_quantity_tons), 0) as delivered_tons,
        COALESCE(SUM(t.accepted_quantity_tons), 0) as accepted_tons
      FROM waste_tickets_recycling t
      JOIN sectors s ON t.sector_id = s.id
      WHERE ${f.whereSql}
      GROUP BY s.sector_number, s.sector_name
      ORDER BY s.sector_number
    `;
    const bySectorRes = await pool.query(bySectorSql, f.params);

    const byWasteSql = `
      SELECT
        wc.code as waste_code,
        wc.description as waste_description,
        COUNT(*)::INTEGER as ticket_count,
        COALESCE(SUM(t.accepted_quantity_tons), 0) as accepted_tons
      FROM waste_tickets_recycling t
      JOIN waste_codes wc ON t.waste_code_id = wc.id
      WHERE ${f.whereSql}
      GROUP BY wc.code, wc.description
      ORDER BY accepted_tons DESC
      LIMIT 10
    `;
    const byWasteRes = await pool.query(byWasteSql, f.params);

    return res.json({
      success: true,
      data: {
        summary: {
          total_tickets: s.total_tickets || 0,
          delivered_tons: delivered,
          accepted_tons: accepted,
          acceptance_rate_percent: Number(rate.toFixed(2)),
          difference_tons: Number(s.difference_tons || 0),
          date_range: { from: f.startDate, to: f.endDate },
        },
        by_sector: bySectorRes.rows.map((r) => ({
          sector_number: r.sector_number,
          sector_name: r.sector_name,
          ticket_count: r.ticket_count,
          delivered_tons: Number(r.delivered_tons || 0),
          accepted_tons: Number(r.accepted_tons || 0),
        })),
        top_waste_codes: byWasteRes.rows.map((r) => ({
          waste_code: r.waste_code,
          waste_description: r.waste_description,
          ticket_count: r.ticket_count,
          accepted_tons: Number(r.accepted_tons || 0),
        })),
      },
    });
  } catch (err) {
    console.error('getRecyclingStats error:', err);
    const code = err.statusCode || 500;
    return res.status(code).json({ success: false, message: 'Failed to fetch recycling stats', error: err.message });
  }
};

// ----------------------------------------------------------------------------
// CREATE: POST /api/tickets/recycling (blocked in routes by authorizeAdminOnly)
// ----------------------------------------------------------------------------
export const createRecyclingTicket = async (req, res) => {
  try {
    // Check permission
    const { canCreateData } = req.userAccess;
    if (!canCreateData) {
      return res.status(403).json({ 
        success: false, 
        message: 'Nu aveți permisiune să creați înregistrări' 
      });
    }

    const {
      ticket_number,
      ticket_date,
      ticket_time,
      supplier_id,
      recipient_id,
      waste_code_id,
      sector_id, // UUID expected
      vehicle_number,
      delivered_quantity_kg,
      accepted_quantity_kg,
      stock_month, // optional
      notes, // optional (if you later add)
    } = req.body;

    if (!isNonEmpty(ticket_date)) {
      return res.status(400).json({ success: false, message: 'ticket_date este obligatoriu' });
    }
    if (!isNonEmpty(supplier_id) || !isNonEmpty(recipient_id) || !isNonEmpty(waste_code_id) || !isNonEmpty(sector_id)) {
      return res.status(400).json({ success: false, message: 'supplier_id, recipient_id, waste_code_id, sector_id sunt obligatorii' });
    }
    if (!isNonEmpty(delivered_quantity_kg) || Number(delivered_quantity_kg) < 0) {
      return res.status(400).json({ success: false, message: 'delivered_quantity_kg invalid' });
    }
    if (!isNonEmpty(accepted_quantity_kg) || Number(accepted_quantity_kg) < 0) {
      return res.status(400).json({ success: false, message: 'accepted_quantity_kg invalid' });
    }

    const createdBy = req.user?.id;

    const insertSql = `
      INSERT INTO waste_tickets_recycling (
        ticket_number,
        ticket_date,
        ticket_time,
        supplier_id,
        recipient_id,
        waste_code_id,
        sector_id,
        vehicle_number,
        delivered_quantity_kg,
        accepted_quantity_kg,
        stock_month,
        notes,
        created_by,
        created_at,
        updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, NOW(), NOW()
      )
      RETURNING id
    `;

    const params = [
      ticket_number ? String(ticket_number).trim() : null,
      String(ticket_date),
      ticket_time ? String(ticket_time) : null,
      String(supplier_id),  // UUID
      String(recipient_id), // UUID
      String(waste_code_id),
      String(sector_id),
      vehicle_number ? String(vehicle_number).trim() : null,
      Number(delivered_quantity_kg),
      Number(accepted_quantity_kg),
      stock_month ? String(stock_month) : null,
      notes ? String(notes) : null,
      createdBy,
    ];

    const result = await pool.query(insertSql, params);
    return res.status(201).json({ success: true, message: 'Ticket created', data: { id: result.rows[0].id } });
  } catch (err) {
    console.error('createRecyclingTicket error:', err);
    return res.status(500).json({ success: false, message: 'Failed to create ticket', error: err.message });
  }
};

// ----------------------------------------------------------------------------
// UPDATE: PUT /api/tickets/recycling/:id (blocked in routes by authorizeAdminOnly)
// ----------------------------------------------------------------------------
export const updateRecyclingTicket = async (req, res) => {
  try {
    // Check permission
    const { canEditData } = req.userAccess;
    if (!canEditData) {
      return res.status(403).json({ 
        success: false, 
        message: 'Nu aveți permisiune să editați înregistrări' 
      });
    }

    const { id } = req.params;
    const ticketId = parseInt(String(id), 10);
    if (Number.isNaN(ticketId)) {
      return res.status(400).json({ success: false, message: 'Invalid ticket id' });
    }

    const updatable = [
      'ticket_number',
      'ticket_date',
      'ticket_time',
      'supplier_id',
      'recipient_id',
      'waste_code_id',
      'sector_id',
      'vehicle_number',
      'delivered_quantity_kg',
      'accepted_quantity_kg',
      'stock_month',
      'notes',
    ];

    const setParts = [];
    const params = [];
    let p = 1;

    for (const key of updatable) {
      if (req.body[key] !== undefined) {
        setParts.push(`${key} = $${p++}`);
        params.push(req.body[key]);
      }
    }

    if (setParts.length === 0) {
      return res.status(400).json({ success: false, message: 'No fields to update' });
    }

    // DB auto-recalcs delivered_quantity_tons, accepted_quantity_tons, difference_tons (GENERATED COLUMNS)
    // No manual calculation needed

    setParts.push(`updated_at = NOW()`);

    params.push(ticketId);
    const updateSql = `
      UPDATE waste_tickets_recycling
      SET ${setParts.join(', ')}
      WHERE id = $${p} AND deleted_at IS NULL
      RETURNING id
    `;

    const result = await pool.query(updateSql, params);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Ticket not found' });
    }

    return res.json({ success: true, message: 'Ticket updated', data: { id: result.rows[0].id } });
  } catch (err) {
    console.error('updateRecyclingTicket error:', err);
    return res.status(500).json({ success: false, message: 'Failed to update ticket', error: err.message });
  }
};

// ----------------------------------------------------------------------------
// DELETE (soft): DELETE /api/tickets/recycling/:id (blocked in routes by authorizeAdminOnly)
// ----------------------------------------------------------------------------
export const deleteRecyclingTicket = async (req, res) => {
  try {
    // Check permission
    const { canDeleteData } = req.userAccess;
    if (!canDeleteData) {
      return res.status(403).json({ 
        success: false, 
        message: 'Nu aveți permisiune să ștergeți înregistrări' 
      });
    }

    const { id } = req.params;
    const ticketId = parseInt(String(id), 10);
    if (Number.isNaN(ticketId)) {
      return res.status(400).json({ success: false, message: 'Invalid ticket id' });
    }

    const result = await pool.query(
      `UPDATE waste_tickets_recycling
       SET deleted_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND deleted_at IS NULL
       RETURNING id`,
      [ticketId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Ticket not found' });
    }

    return res.json({ success: true, message: 'Ticket deleted', data: { id: result.rows[0].id } });
  } catch (err) {
    console.error('deleteRecyclingTicket error:', err);
    return res.status(500).json({ success: false, message: 'Failed to delete ticket', error: err.message });
  }
};

export default {
  getAllRecyclingTickets,
  getRecyclingTicketById,
  createRecyclingTicket,
  updateRecyclingTicket,
  deleteRecyclingTicket,
  getRecyclingStats,
};