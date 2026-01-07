// src/controllers/wasteTicketsLandfillController.js
// ============================================================================
// LANDFILL TICKETS CONTROLLER (RBAC via req.userAccess, UUID sector scoping)
// ============================================================================
// Middleware expectations (from routes):
// - authenticateToken
// - resolveUserAccess => sets req.userAccess { accessLevel, sectorIds, ... }
// - enforceSectorAccess => validates requested sector & sets req.requestedSectorUuid
// - authorizeAdminOnly on POST/PUT/DELETE (routes handle CRUD restriction)
//
// IMPORTANT:
// - waste_tickets_landfill.sector_id is UUID
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
    waste_code_id,
    vehicle_number,
    ticket_number,
    generator_type,
    operation_type,
    contract_type,
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

  if (isNonEmpty(generator_type)) {
    where.push(`${alias}.generator_type = $${p++}`);
    params.push(String(generator_type));
  }

  if (isNonEmpty(operation_type)) {
    where.push(`${alias}.operation_type = $${p++}`);
    params.push(String(operation_type));
  }

  if (isNonEmpty(contract_type)) {
    where.push(`${alias}.contract_type = $${p++}`);
    params.push(String(contract_type));
  }

  if (isNonEmpty(search)) {
    where.push(
      `(${alias}.ticket_number ILIKE $${p} OR ${alias}.vehicle_number ILIKE $${p})`
    );
    params.push(`%${String(search).trim()}%`);
    p++;
  }

  return {
    whereSql: where.join(' AND '),
    params,
    nextIndex: p,
    startDate,
    endDate,
    year: y,
    requestedSectorUuid: scope.requestedSectorUuid,
  };
};

// ----------------------------------------------------------------------------
// READ: GET /api/tickets/landfill
// ----------------------------------------------------------------------------
export const getAllLandfillTickets = async (req, res) => {
  try {
    // Check if user has access to landfill page
    const { scopes } = req.userAccess;
    if (scopes?.landfill === 'NONE') {
      return res.status(403).json({ 
        success: false, 
        message: 'Nu aveți permisiune să accesați pagina Depozitare' 
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
      net_weight_tons: 't.net_weight_tons',
      vehicle_number: 't.vehicle_number',
      created_at: 't.created_at',
    };
    const sortCol = sortMap[sort_by] || 't.ticket_date';
    const dir = String(sort_dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    const countSql = `
      SELECT COUNT(*)::INTEGER AS total
      FROM waste_tickets_landfill t
      JOIN sectors s ON t.sector_id = s.id
      JOIN institutions sup ON t.supplier_id = sup.id
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
        wc.id as waste_code_id,
        wc.code as waste_code,
        wc.description as waste_description,
        t.vehicle_number,
        t.gross_weight_kg,
        t.tare_weight_kg,
        t.net_weight_kg,
        t.net_weight_tons,
        t.generator_type,
        t.operation_type,
        t.contract_type,
        t.created_at,
        t.updated_at
      FROM waste_tickets_landfill t
      JOIN sectors s ON t.sector_id = s.id
      JOIN institutions sup ON t.supplier_id = sup.id
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
    console.error('getAllLandfillTickets error:', err);
    const code = err.statusCode || 500;
    return res.status(code).json({ success: false, message: 'Failed to fetch landfill tickets', error: err.message });
  }
};

// ----------------------------------------------------------------------------
// READ: GET /api/tickets/landfill/:id
// ----------------------------------------------------------------------------
export const getLandfillTicketById = async (req, res) => {
  try {
    // Check if user has access to landfill page
    const { scopes } = req.userAccess;
    if (scopes?.landfill === 'NONE') {
      return res.status(403).json({ 
        success: false, 
        message: 'Nu aveți permisiune să accesați pagina Depozitare' 
      });
    }

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
        wc.id as waste_code_id,
        wc.code as waste_code,
        wc.description as waste_description,
        t.vehicle_number,
        t.gross_weight_kg,
        t.tare_weight_kg,
        t.net_weight_kg,
        t.net_weight_tons,
        t.generator_type,
        t.operation_type,
        t.contract_type,
        t.created_at,
        t.updated_at
      FROM waste_tickets_landfill t
      JOIN sectors s ON t.sector_id = s.id
      JOIN institutions sup ON t.supplier_id = sup.id
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
    console.error('getLandfillTicketById error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch ticket', error: err.message });
  }
};

// ----------------------------------------------------------------------------
// STATS: GET /api/tickets/landfill/stats
// ----------------------------------------------------------------------------
export const getLandfillStats = async (req, res) => {
  try {
    // Check if user has access to landfill page
    const { scopes } = req.userAccess;
    if (scopes?.landfill === 'NONE') {
      return res.status(403).json({ 
        success: false, 
        message: 'Nu aveți permisiune să accesați pagina Depozitare' 
      });
    }

    const f = buildListFilters(req, 't');

    const summarySql = `
      SELECT
        COUNT(*)::INTEGER as total_tickets,
        COALESCE(SUM(t.net_weight_tons), 0) as total_tons,
        COALESCE(AVG(t.net_weight_tons), 0) as avg_tons_per_ticket
      FROM waste_tickets_landfill t
      WHERE ${f.whereSql}
    `;
    const summaryRes = await pool.query(summarySql, f.params);
    const s = summaryRes.rows[0] || {};
    const totalTons = Number(s.total_tons || 0);

    const bySectorSql = `
      SELECT
        s.sector_number,
        s.sector_name,
        COUNT(*)::INTEGER as ticket_count,
        COALESCE(SUM(t.net_weight_tons), 0) as total_tons
      FROM waste_tickets_landfill t
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
        COALESCE(SUM(t.net_weight_tons), 0) as total_tons
      FROM waste_tickets_landfill t
      JOIN waste_codes wc ON t.waste_code_id = wc.id
      WHERE ${f.whereSql}
      GROUP BY wc.code, wc.description
      ORDER BY total_tons DESC
      LIMIT 10
    `;
    const byWasteRes = await pool.query(byWasteSql, f.params);

    return res.json({
      success: true,
      data: {
        summary: {
          total_tickets: s.total_tickets || 0,
          total_tons: totalTons,
          avg_tons_per_ticket: Number(s.avg_tons_per_ticket || 0),
          date_range: { from: f.startDate, to: f.endDate },
        },
        by_sector: bySectorRes.rows.map((r) => ({
          sector_number: r.sector_number,
          sector_name: r.sector_name,
          ticket_count: r.ticket_count,
          total_tons: Number(r.total_tons || 0),
          percentage_of_total: totalTons > 0 ? Number(((Number(r.total_tons || 0) / totalTons) * 100).toFixed(2)) : 0,
        })),
        top_waste_codes: byWasteRes.rows.map((r) => ({
          waste_code: r.waste_code,
          waste_description: r.waste_description,
          ticket_count: r.ticket_count,
          total_tons: Number(r.total_tons || 0),
          percentage_of_total: totalTons > 0 ? Number(((Number(r.total_tons || 0) / totalTons) * 100).toFixed(2)) : 0,
        })),
      },
    });
  } catch (err) {
    console.error('getLandfillStats error:', err);
    const code = err.statusCode || 500;
    return res.status(code).json({ success: false, message: 'Failed to fetch landfill stats', error: err.message });
  }
};

// ----------------------------------------------------------------------------
// CREATE: POST /api/tickets/landfill (blocked in routes by authorizeAdminOnly)
// ----------------------------------------------------------------------------
export const createLandfillTicket = async (req, res) => {
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
      waste_code_id,
      sector_id, // UUID expected
      vehicle_number,
      gross_weight_kg,
      tare_weight_kg,
      generator_type,
      operation_type,
      contract_type,
    } = req.body;

    if (!isNonEmpty(ticket_number) || !isNonEmpty(ticket_date) || !isNonEmpty(ticket_time)) {
      return res.status(400).json({ success: false, message: 'ticket_number, ticket_date, ticket_time sunt obligatorii' });
    }
    if (!isNonEmpty(supplier_id) || !isNonEmpty(waste_code_id) || !isNonEmpty(sector_id)) {
      return res.status(400).json({ success: false, message: 'supplier_id, waste_code_id, sector_id sunt obligatorii' });
    }
    if (!isNonEmpty(gross_weight_kg) || Number(gross_weight_kg) <= 0) {
      return res.status(400).json({ success: false, message: 'gross_weight_kg invalid' });
    }
    if (!isNonEmpty(tare_weight_kg) || Number(tare_weight_kg) < 0) {
      return res.status(400).json({ success: false, message: 'tare_weight_kg invalid' });
    }

    const gross = Number(gross_weight_kg);
    const tare = Number(tare_weight_kg);
    const net = gross - tare;

    if (net <= 0) {
      return res.status(400).json({ success: false, message: 'net_weight_kg invalid (gross - tare must be > 0)' });
    }

    const createdBy = req.user?.id;

    const insertSql = `
      INSERT INTO waste_tickets_landfill (
        ticket_number,
        ticket_date,
        ticket_time,
        supplier_id,
        waste_code_id,
        sector_id,
        vehicle_number,
        gross_weight_kg,
        tare_weight_kg,
        net_weight_kg,
        net_weight_tons,
        generator_type,
        operation_type,
        contract_type,
        created_by,
        created_at,
        updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,($8-$9),(($8-$9)/1000.0),
        $10,$11,$12,
        $13, NOW(), NOW()
      )
      RETURNING id
    `;

    const params = [
      String(ticket_number).trim(),
      String(ticket_date),
      String(ticket_time),
      parseInt(String(supplier_id), 10),
      String(waste_code_id),
      String(sector_id),
      vehicle_number ? String(vehicle_number).trim() : null,
      gross,
      tare,
      generator_type ? String(generator_type) : null,
      operation_type ? String(operation_type) : null,
      contract_type ? String(contract_type) : null,
      createdBy,
    ];

    const result = await pool.query(insertSql, params);
    return res.status(201).json({ success: true, message: 'Ticket created', data: { id: result.rows[0].id } });
  } catch (err) {
    console.error('createLandfillTicket error:', err);
    return res.status(500).json({ success: false, message: 'Failed to create ticket', error: err.message });
  }
};

// ----------------------------------------------------------------------------
// UPDATE: PUT /api/tickets/landfill/:id (blocked in routes by authorizeAdminOnly)
// ----------------------------------------------------------------------------
export const updateLandfillTicket = async (req, res) => {
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
      'waste_code_id',
      'sector_id',
      'vehicle_number',
      'gross_weight_kg',
      'tare_weight_kg',
      'generator_type',
      'operation_type',
      'contract_type',
    ];

    const setParts = [];
    const params = [];
    let p = 1;

    const grossProvided = req.body.gross_weight_kg !== undefined;
    const tareProvided = req.body.tare_weight_kg !== undefined;

    for (const key of updatable) {
      if (req.body[key] !== undefined) {
        setParts.push(`${key} = $${p++}`);
        params.push(req.body[key]);
      }
    }

    if (setParts.length === 0) {
      return res.status(400).json({ success: false, message: 'No fields to update' });
    }

    // If weights change, recompute net based on final values
    if (grossProvided || tareProvided) {
      const existingRes = await pool.query(
        `SELECT gross_weight_kg, tare_weight_kg
         FROM waste_tickets_landfill
         WHERE id = $1 AND deleted_at IS NULL`,
        [ticketId]
      );
      if (existingRes.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Ticket not found' });
      }

      const currentGross = Number(existingRes.rows[0].gross_weight_kg);
      const currentTare = Number(existingRes.rows[0].tare_weight_kg);

      const newGross = grossProvided ? Number(req.body.gross_weight_kg) : currentGross;
      const newTare = tareProvided ? Number(req.body.tare_weight_kg) : currentTare;

      if (!Number.isFinite(newGross) || newGross <= 0 || !Number.isFinite(newTare) || newTare < 0) {
        return res.status(400).json({ success: false, message: 'Weights invalid' });
      }

      const net = newGross - newTare;
      if (net <= 0) {
        return res.status(400).json({ success: false, message: 'net_weight_kg invalid (gross - tare must be > 0)' });
      }

      setParts.push(`net_weight_kg = ${net}`);
      setParts.push(`net_weight_tons = (${net}/1000.0)`);
    }

    setParts.push(`updated_at = NOW()`);

    params.push(ticketId);
    const updateSql = `
      UPDATE waste_tickets_landfill
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
    console.error('updateLandfillTicket error:', err);
    return res.status(500).json({ success: false, message: 'Failed to update ticket', error: err.message });
  }
};

// ----------------------------------------------------------------------------
// DELETE (soft): DELETE /api/tickets/landfill/:id (blocked in routes by authorizeAdminOnly)
// ----------------------------------------------------------------------------
export const deleteLandfillTicket = async (req, res) => {
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
      `UPDATE waste_tickets_landfill
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
    console.error('deleteLandfillTicket error:', err);
    return res.status(500).json({ success: false, message: 'Failed to delete ticket', error: err.message });
  }
};

export default {
  getAllLandfillTickets,
  getLandfillTicketById,
  createLandfillTicket,
  updateLandfillTicket,
  deleteLandfillTicket,
  getLandfillStats,
};