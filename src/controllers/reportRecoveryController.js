// src/controllers/reportRecoveryController.js
// ============================================================================
// REPORT: RECOVERY OUTPUT TICKETS (RBAC via req.userAccess, UUID sector scoping)
// Route: GET /api/reports/tmb/recovery
// Table: waste_tickets_recovery
// ============================================================================

import pool from '../config/database.js';

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

  // ✅ IMPORTANT:
  // - sectorWhere MUST NOT start with "AND" because buildFilters joins with " AND "
  // - placeholders must be literal "${{}}" (escaped as \${{}}) so applyParamIndex can replace them
  if (requestedSectorUuid) {
    sectorWhere = `${alias}.sector_id = \${{}}`;
    sectorParams.push(requestedSectorUuid);
  } else if (!isAll) {
    sectorWhere = `${alias}.sector_id = ANY(\${{}})`;
    sectorParams.push(visibleSectorIds);
  }

  return { sectorWhere, sectorParams };
};

const applyParamIndex = (sqlWithPlaceholders, startIndex) => {
  let idx = startIndex;
  return sqlWithPlaceholders.replace(/\$\{\{\}\}/g, () => `$${idx++}`);
};

const buildFilters = (req, alias = 't') => {
  const { year, from, to, supplier_id, recipient_id, waste_code_id, search } = req.query;

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

  const scope = buildSectorScope(req, alias);
  if (scope.sectorWhere) {
    where.push(applyParamIndex(scope.sectorWhere, p));
    params.push(...scope.sectorParams);
    p += scope.sectorParams.length;
  }

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
  if (isNonEmpty(search)) {
    where.push(`(${alias}.ticket_number ILIKE $${p} OR ${alias}.vehicle_number ILIKE $${p})`);
    params.push(`%${String(search).trim()}%`);
    p++;
  }

  return { whereSql: where.join(' AND '), params, nextIndex: p, startDate, endDate, year: y };
};

export const getRecoveryTickets = async (req, res) => {
  try {
    // Check if user has access to reports page
    const { scopes } = req.userAccess;
    if (scopes?.reports === 'NONE') {
      return res.status(403).json({ 
        success: false, 
        message: 'Nu aveți permisiune să accesați pagina Rapoarte' 
      });
    }

    const { page = 1, limit = 50, sort_by = 'ticket_date', sort_dir = 'desc' } = req.query;

    const pageNum = clampInt(page, 1, 1000000, 1);
    const limitNum = clampInt(limit, 1, 500, 50);
    const offset = (pageNum - 1) * limitNum;

    const f = buildFilters(req, 't');

    const sortMap = {
      ticket_date: 't.ticket_date',
      ticket_number: 't.ticket_number',
      sector_number: 's.sector_number',
      supplier_name: 'sup.name',
      recipient_name: 'rec.name',
      delivered_quantity_tons: 't.delivered_quantity_tons',
      accepted_quantity_tons: 't.accepted_quantity_tons',
    };
    const sortCol = sortMap[sort_by] || 't.ticket_date';
    const dir = String(sort_dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    const countSql = `
      SELECT COUNT(*)::INTEGER AS total
      FROM waste_tickets_recovery t
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
        t.delivered_quantity_tons,
        t.accepted_quantity_tons,
        t.difference_tons,
        t.created_at
      FROM waste_tickets_recovery t
      JOIN sectors s ON t.sector_id = s.id
      JOIN institutions sup ON t.supplier_id = sup.id
      JOIN institutions rec ON t.recipient_id = rec.id
      JOIN waste_codes wc ON t.waste_code_id = wc.id
      WHERE ${f.whereSql}
      ORDER BY ${sortCol} ${dir}, t.created_at ${dir}
      LIMIT $${pLimit} OFFSET $${pOffset}
    `;
    const listRes = await pool.query(listSql, listParams);

    const summarySql = `
      SELECT
        COUNT(*)::INTEGER as total_tickets,
        COALESCE(SUM(t.delivered_quantity_tons), 0) as delivered_tons,
        COALESCE(SUM(t.accepted_quantity_tons), 0) as accepted_tons,
        COALESCE(SUM(t.difference_tons), 0) as difference_tons
      FROM waste_tickets_recovery t
      WHERE ${f.whereSql}
    `;
    const summaryRes = await pool.query(summarySql, f.params);
    const s = summaryRes.rows[0] || {};
    const delivered = Number(s.delivered_tons || 0);
    const accepted = Number(s.accepted_tons || 0);
    const rate = delivered > 0 ? (accepted / delivered) * 100 : 0;

    // ============================================================================
    // ✅ FIX: AVAILABLE YEARS & ALL SECTORS
    // ============================================================================
    const access = req.userAccess;
    const isAll = access.accessLevel === 'ALL';
    const allowedSectorIds = Array.isArray(access.visibleSectorIds) ? access.visibleSectorIds : [];
    const requestedSectorUuid = req.requestedSectorUuid || null;

    let yearsWhere = '';
    let yearsParams = [];

    if (requestedSectorUuid) {
      yearsWhere = `AND sector_id = $1`;
      yearsParams = [requestedSectorUuid];
    } else if (!isAll) {
      yearsWhere = `AND sector_id = ANY($1)`;
      yearsParams = [allowedSectorIds];
    }

    const yearsQuery = `
      SELECT DISTINCT EXTRACT(YEAR FROM ticket_date)::INTEGER AS year
      FROM waste_tickets_recovery
      WHERE deleted_at IS NULL
        ${yearsWhere}
      ORDER BY year DESC
    `;
    
    const yearsRes = await pool.query(yearsQuery, yearsParams);
    let availableYears = yearsRes.rows.map((r) => r.year);

    const currentYearInt = new Date().getFullYear();
    if (!availableYears.includes(currentYearInt)) {
      availableYears.unshift(currentYearInt);
    }

    const minYears = 3;
    while (availableYears.length < minYears) {
      const lastYear = availableYears[availableYears.length - 1] || currentYearInt;
      availableYears.push(lastYear - 1);
    }

    availableYears.sort((a, b) => b - a);

    const allSectorsQuery = `
      SELECT 
        s.id AS sector_id,
        s.sector_number,
        s.sector_name
      FROM sectors s
      WHERE s.is_active = true 
        AND s.deleted_at IS NULL
        ${!isAll ? 'AND s.id = ANY($1)' : ''}
      ORDER BY s.sector_number
    `;

    const allSectorsParams = !isAll ? [allowedSectorIds] : [];
    const allSectorsRes = await pool.query(allSectorsQuery, allSectorsParams);

    // Suppliers & Clients pentru cards
    const suppliersSql = `
      SELECT 
        sup.name,
        wc.code as waste_code,
        COALESCE(SUM(t.delivered_quantity_tons), 0) as total_tons
      FROM waste_tickets_recovery t
      JOIN institutions sup ON t.supplier_id = sup.id
      LEFT JOIN waste_codes wc ON t.waste_code_id = wc.id
      WHERE ${f.whereSql}
      GROUP BY sup.name, wc.code
      ORDER BY total_tons DESC
    `;
    const suppliersRes = await pool.query(suppliersSql, f.params);

    const clientsSql = `
      SELECT 
        rec.name,
        wc.code as waste_code,
        COALESCE(SUM(t.accepted_quantity_tons), 0) as total_tons
      FROM waste_tickets_recovery t
      JOIN institutions rec ON t.recipient_id = rec.id
      LEFT JOIN waste_codes wc ON t.waste_code_id = wc.id
      WHERE ${f.whereSql}
      GROUP BY rec.name, wc.code
      ORDER BY total_tons DESC
    `;
    const clientsRes = await pool.query(clientsSql, f.params);

    return res.json({
      success: true,
      data: {
        items: listRes.rows,
        pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
        summary: {
          total_tickets: s.total_tickets || 0,
          total_delivered: delivered,
          total_accepted: accepted,
          acceptance_rate_percent: Number(rate.toFixed(2)),
          difference_tons: Number(s.difference_tons || 0),
          date_range: { from: f.startDate, to: f.endDate },
        },
        suppliers: suppliersRes.rows.map(s => ({
          name: s.name,
          code: s.waste_code,
          total_tons: Number(s.total_tons || 0),
        })),
        clients: clientsRes.rows.map(c => ({
          name: c.name,
          code: c.waste_code,
          total_tons: Number(c.total_tons || 0),
        })),
        all_sectors: allSectorsRes.rows.map(s => ({
          sector_id: s.sector_id,
          sector_number: s.sector_number,
          sector_name: s.sector_name,
        })),
        available_years: availableYears,
      },
    });
  } catch (err) {
    console.error('getRecoveryTickets error:', err);
    const code = err.statusCode || 500;
    return res.status(code).json({ success: false, message: 'Failed to fetch Recovery report', error: err.message });
  }
};

export default { getRecoveryTickets };