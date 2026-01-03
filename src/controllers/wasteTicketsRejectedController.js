// src/controllers/wasteTicketsRejectedController.js
// ============================================================================
// REJECTED TICKETS CONTROLLER (RBAC via req.userAccess, UUID sector scoping)
// ============================================================================
// Middleware expectations (from routes):
// - authenticateToken
// - resolveUserAccess => sets req.userAccess { accessLevel, sectorIds, ... }
// - enforceSectorAccess => validates requested sector & sets req.requestedSectorUuid
// - authorizeAdminOnly on POST/PUT/DELETE (routes handle CRUD restriction)
//
// IMPORTANT:
// - waste_tickets_rejected.sector_id is UUID
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
  const sectorIds = Array.isArray(access.sectorIds) ? access.sectorIds : [];
  const requestedSectorUuid = req.requestedSectorUuid || null;

  let sectorWhere = '';
  const sectorParams = [];

  if (requestedSectorUuid) {
    sectorWhere = `AND ${alias}.sector_id = ${{}}`;
    sectorParams.push(requestedSectorUuid);
  } else if (!isAll) {
    sectorWhere = `AND ${alias}.sector_id = ANY(${{}})`;
    sectorParams.push(sectorIds);
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
    operator_id,
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

  if (isNonEmpty(operator_id)) {
    where.push(`${alias}.operator_id = $${p++}`);
    params.push(parseInt(String(operator_id), 10));
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
// READ: GET /api/tickets/rejected
// ----------------------------------------------------------------------------
export const getAllRejectedTickets = async (req, res) => {
  try {
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
      operator_name: 'op.name',
      rejected_quantity_tons: 't.rejected_quantity_tons',
      vehicle_number: 't.vehicle_number',
      created_at: 't.created_at',
    };
    const sortCol = sortMap[sort_by] || 't.ticket_date';
    const dir = String(sort_dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    const countSql = `
      SELECT COUNT(*)::INTEGER AS total
      FROM waste_tickets_rejected t
      JOIN sectors s ON t.sector_id = s.id
      JOIN institutions sup ON t.supplier_id = sup.id
      JOIN institutions op ON t.operator_id = op.id
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
        op.id as operator_id,
        op.name as operator_name,
        wc.id as waste_code_id,
        wc.code as waste_code,
        wc.description as waste_description,
        t.vehicle_number,
        t.rejected_quantity_kg,
        t.rejected_quantity_tons,
        t.rejection_reason,
        t.created_at,
        t.updated_at
      FROM waste_tickets_rejected t
      JOIN sectors s ON t.sector_id = s.id
      JOIN institutions sup ON t.supplier_id = sup.id
      JOIN institutions op ON t.operator_id = op.id
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
    console.error('getAllRejectedTickets error:', err);
    const code = err.statusCode || 500;
    return res.status(code).json({ success: false, message: 'Failed to fetch rejected tickets', error: err.message });
  }
};

// ----------------------------------------------------------------------------
// READ: GET /api/tickets/rejected/:id
// ----------------------------------------------------------------------------
export const getRejectedTicketById = async (req, res) => {
  try {
    const { id } = req.params;
    const ticketId = parseInt(String(id), 10);

    if (Number.isNaN(ticketId)) {
      return res.status(400).json({ success: false, message: 'Invalid ticket id' });
    }

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
        op.id as operator_id,
        op.name as operator_name,
        wc.id as waste_code_id,
        wc.code as waste_code,
        wc.description as waste_description,
        t.vehicle_number,
        t.rejected_quantity_kg,
        t.rejected_quantity_tons,
        t.rejection_reason,
        t.created_at,
        t.updated_at
      FROM waste_tickets_rejected t
      JOIN sectors s ON t.sector_id = s.id
      JOIN institutions sup ON t.supplier_id = sup.id
      JOIN institutions op ON t.operator_id = op.id
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
    console.error('getRejectedTicketById error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch ticket', error: err.message });
  }
};

// ----------------------------------------------------------------------------
// STATS: GET /api/tickets/rejected/stats
// ----------------------------------------------------------------------------
export const getRejectedStats = async (req, res) => {
  try {
    const f = buildListFilters(req, 't');

    const summarySql = `
      SELECT
        COUNT(*)::INTEGER as total_tickets,
        COALESCE(SUM(t.rejected_quantity_tons), 0) as rejected_tons
      FROM waste_tickets_rejected t
      WHERE ${f.whereSql}
    `;
    const summaryRes = await pool.query(summarySql, f.params);
    const s = summaryRes.rows[0] || {};

    const bySectorSql = `
      SELECT
        s.sector_number,
        s.sector_name,
        COUNT(*)::INTEGER as ticket_count,
        COALESCE(SUM(t.rejected_quantity_tons), 0) as rejected_tons
      FROM waste_tickets_rejected t
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
        COALESCE(SUM(t.rejected_quantity_tons), 0) as rejected_tons
      FROM waste_tickets_rejected t
      JOIN waste_codes wc ON t.waste_code_id = wc.id
      WHERE ${f.whereSql}
      GROUP BY wc.code, wc.description
      ORDER BY rejected_tons DESC
      LIMIT 10
    `;
    const byWasteRes = await pool.query(byWasteSql, f.params);

    return res.json({
      success: true,
      data: {
        summary: {
          total_tickets: s.total_tickets || 0,
          rejected_tons: Number(s.rejected_tons || 0),
          date_range: { from: f.startDate, to: f.endDate },
        },
        by_sector: bySectorRes.rows.map((r) => ({
          sector_number: r.sector_number,
          sector_name: r.sector_name,
          ticket_count: r.ticket_count,
          rejected_tons: Number(r.rejected_tons || 0),
        })),
        top_waste_codes: byWasteRes.rows.map((r) => ({
          waste_code: r.waste_code,
          waste_description: r.waste_description,
          ticket_count: r.ticket_count,
          rejected_tons: Number(r.rejected_tons || 0),
        })),
      },
    });
  } catch (err) {
    console.error('getRejectedStats error:', err);
    const code = err.statusCode || 500;
    return res.status(code).json({ success: false, message: 'Failed to fetch rejected stats', error: err.message });
  }
};

// ----------------------------------------------------------------------------
// CREATE: POST /api/tickets/rejected (blocked in routes by authorizeAdminOnly)
// ----------------------------------------------------------------------------
export const createRejectedTicket = async (req, res) => {
  try {
    const {
      ticket_number,
      ticket_date,
      ticket_time,
      supplier_id,
      operator_id,
      waste_code_id,
      sector_id, // UUID expected
      vehicle_number,
      rejected_quantity_kg,
      rejection_reason,
    } = req.body;

    if (!isNonEmpty(ticket_number) || !isNonEmpty(ticket_date) || !isNonEmpty(ticket_time)) {
      return res.status(400).json({ success: false, message: 'ticket_number, ticket_date, ticket_time sunt obligatorii' });
    }
    if (!isNonEmpty(supplier_id) || !isNonEmpty(operator_id) || !isNonEmpty(waste_code_id) || !isNonEmpty(sector_id)) {
      return res.status(400).json({ success: false, message: 'supplier_id, operator_id, waste_code_id, sector_id sunt obligatorii' });
    }
    if (!isNonEmpty(vehicle_number)) {
      return res.status(400).json({ success: false, message: 'vehicle_number este obligatoriu' });
    }
    if (!isNonEmpty(rejected_quantity_kg) || Number(rejected_quantity_kg) <= 0) {
      return res.status(400).json({ success: false, message: 'rejected_quantity_kg invalid' });
    }

    const createdBy = req.user?.id;

    const insertSql = `
      INSERT INTO waste_tickets_rejected (
        ticket_number,
        ticket_date,
        ticket_time,
        supplier_id,
        operator_id,
        waste_code_id,
        sector_id,
        vehicle_number,
        rejected_quantity_kg,
        rejected_quantity_tons,
        rejection_reason,
        created_by,
        created_at,
        updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,($9/1000.0),$10,$11, NOW(), NOW()
      )
      RETURNING id
    `;

    const params = [
      String(ticket_number).trim(),
      String(ticket_date),
      String(ticket_time),
      parseInt(String(supplier_id), 10),
      parseInt(String(operator_id), 10),
      String(waste_code_id),
      String(sector_id),
      String(vehicle_number).trim(),
      Number(rejected_quantity_kg),
      rejection_reason ? String(rejection_reason) : null,
      createdBy,
    ];

    const result = await pool.query(insertSql, params);
    return res.status(201).json({ success: true, message: 'Ticket created', data: { id: result.rows[0].id } });
  } catch (err) {
    console.error('createRejectedTicket error:', err);
    return res.status(500).json({ success: false, message: 'Failed to create ticket', error: err.message });
  }
};

// ----------------------------------------------------------------------------
// UPDATE: PUT /api/tickets/rejected/:id (blocked in routes by authorizeAdminOnly)
// ----------------------------------------------------------------------------
export const updateRejectedTicket = async (req, res) => {
  try {
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
      'operator_id',
      'waste_code_id',
      'sector_id',
      'vehicle_number',
      'rejected_quantity_kg',
      'rejection_reason',
    ];

    const setParts = [];
    const params = [];
    let p = 1;

    const qtyProvided = req.body.rejected_quantity_kg !== undefined;

    for (const key of updatable) {
      if (req.body[key] !== undefined) {
        setParts.push(`${key} = $${p++}`);
        params.push(req.body[key]);
      }
    }

    if (setParts.length === 0) {
      return res.status(400).json({ success: false, message: 'No fields to update' });
    }

    if (qtyProvided) {
      const kg = Number(req.body.rejected_quantity_kg);
      if (!Number.isFinite(kg) || kg <= 0) {
        return res.status(400).json({ success: false, message: 'rejected_quantity_kg invalid' });
      }
      setParts.push(`rejected_quantity_tons = ($${p - 1}/1000.0)`);
    }

    setParts.push(`updated_at = NOW()`);

    params.push(ticketId);
    const updateSql = `
      UPDATE waste_tickets_rejected
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
    console.error('updateRejectedTicket error:', err);
    return res.status(500).json({ success: false, message: 'Failed to update ticket', error: err.message });
  }
};

// ----------------------------------------------------------------------------
// DELETE (soft): DELETE /api/tickets/rejected/:id (blocked in routes by authorizeAdminOnly)
// ----------------------------------------------------------------------------
export const deleteRejectedTicket = async (req, res) => {
  try {
    const { id } = req.params;
    const ticketId = parseInt(String(id), 10);
    if (Number.isNaN(ticketId)) {
      return res.status(400).json({ success: false, message: 'Invalid ticket id' });
    }

    const result = await pool.query(
      `UPDATE waste_tickets_rejected
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
    console.error('deleteRejectedTicket error:', err);
    return res.status(500).json({ success: false, message: 'Failed to delete ticket', error: err.message });
  }
};

export default {
  getAllRejectedTickets,
  getRejectedTicketById,
  createRejectedTicket,
  updateRejectedTicket,
  deleteRejectedTicket,
  getRejectedStats,
};
