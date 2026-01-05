// src/controllers/reportTmbController.js
// ============================================================================
// REPORT: TMB INPUT TICKETS (RBAC via req.userAccess, UUID sector scoping)
// Route: GET /api/reports/tmb/tmb
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
  const sectorIds = Array.isArray(access.sectorIds) ? access.sectorIds : [];
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
    sectorParams.push(sectorIds);
  }

  return { isAll, sectorIds, requestedSectorUuid, sectorWhere, sectorParams };
};

const applyParamIndex = (sqlWithPlaceholders, startIndex) => {
  let idx = startIndex;
  return sqlWithPlaceholders.replace(/\$\{\{\}\}/g, () => `$${idx++}`);
};

const buildFilters = (req, alias = 't') => {
  const { year, from, to, supplier_id, operator_id, waste_code_id, generator_type, search } = req.query;

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
  if (isNonEmpty(operator_id)) {
    where.push(`${alias}.operator_id = $${p++}`);
    params.push(parseInt(String(operator_id), 10));
  }
  if (isNonEmpty(waste_code_id)) {
    where.push(`${alias}.waste_code_id = $${p++}`);
    params.push(String(waste_code_id));
  }
  if (isNonEmpty(generator_type)) {
    where.push(`${alias}.generator_type = $${p++}`);
    params.push(String(generator_type));
  }
  if (isNonEmpty(search)) {
    where.push(`(${alias}.ticket_number ILIKE $${p} OR ${alias}.vehicle_number ILIKE $${p})`);
    params.push(`%${String(search).trim()}%`);
    p++;
  }

  return { whereSql: where.join(' AND '), params, nextIndex: p, startDate, endDate, year: y };
};

export const getTmbTickets = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      sort_by = 'ticket_date',
      sort_dir = 'desc',
    } = req.query;

    const pageNum = clampInt(page, 1, 1000000, 1);
    const limitNum = clampInt(limit, 1, 500, 50);
    const offset = (pageNum - 1) * limitNum;

    const f = buildFilters(req, 't');

    const sortMap = {
      ticket_date: 't.ticket_date',
      ticket_number: 't.ticket_number',
      sector_number: 's.sector_number',
      supplier_name: 'sup.name',
      operator_name: 'op.name',
      net_weight_tons: 't.net_weight_tons',
    };
    const sortCol = sortMap[sort_by] || 't.ticket_date';
    const dir = String(sort_dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    const countSql = `
      SELECT COUNT(*)::INTEGER AS total
      FROM waste_tickets_tmb t
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
        t.generator_type,
        t.net_weight_kg,
        t.net_weight_tons,
        t.created_at
      FROM waste_tickets_tmb t
      JOIN sectors s ON t.sector_id = s.id
      JOIN institutions sup ON t.supplier_id = sup.id
      JOIN institutions op ON t.operator_id = op.id
      JOIN waste_codes wc ON t.waste_code_id = wc.id
      WHERE ${f.whereSql}
      ORDER BY ${sortCol} ${dir}, t.created_at ${dir}
      LIMIT $${pLimit} OFFSET $${pOffset}
    `;
    const listRes = await pool.query(listSql, listParams);

    const summarySql = `
      SELECT
        COUNT(*)::INTEGER as total_tickets,
        COALESCE(SUM(t.net_weight_tons), 0) as total_tons,
        COALESCE(AVG(t.net_weight_tons), 0) as avg_tons_per_ticket
      FROM waste_tickets_tmb t
      WHERE ${f.whereSql}
    `;
    const summaryRes = await pool.query(summarySql, f.params);

    // ============================================================================
    // ✅ FIX: AVAILABLE YEARS & ALL SECTORS
    // ============================================================================
    const access = req.userAccess;
    const isAll = access.accessLevel === 'ALL';
    const allowedSectorIds = Array.isArray(access.sectorIds) ? access.sectorIds : [];
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
      FROM waste_tickets_tmb
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

    // Suppliers & Operators pentru cards
    const suppliersSql = `
      SELECT 
        sup.name,
        wc.code as waste_code,
        COALESCE(SUM(t.net_weight_tons), 0) as total_tons
      FROM waste_tickets_tmb t
      JOIN institutions sup ON t.supplier_id = sup.id
      LEFT JOIN waste_codes wc ON t.waste_code_id = wc.id
      WHERE ${f.whereSql}
      GROUP BY sup.name, wc.code
      ORDER BY total_tons DESC
    `;
    const suppliersRes = await pool.query(suppliersSql, f.params);

    const operatorsSql = `
      SELECT 
        op.name,
        COALESCE(SUM(t.net_weight_tons), 0) as total_tons
      FROM waste_tickets_tmb t
      JOIN institutions op ON t.operator_id = op.id
      WHERE ${f.whereSql}
      GROUP BY op.name
      ORDER BY total_tons DESC
    `;
    const operatorsRes = await pool.query(operatorsSql, f.params);

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
        summary: {
          total_tickets: summaryRes.rows[0]?.total_tickets || 0,
          total_tons: Number(summaryRes.rows[0]?.total_tons || 0),
          avg_tons_per_ticket: Number(summaryRes.rows[0]?.avg_tons_per_ticket || 0),
          date_range: { from: f.startDate, to: f.endDate },
        },
        suppliers: suppliersRes.rows.map(s => ({
          name: s.name,
          code: s.waste_code,
          total_tons: Number(s.total_tons || 0),
        })),
        operators: operatorsRes.rows.map(o => ({
          name: o.name,
          total_tons: Number(o.total_tons || 0),
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
    console.error('getTmbTickets error:', err);
    const code = err.statusCode || 500;
    return res.status(code).json({ success: false, message: 'Failed to fetch TMB report', error: err.message });
  }
};

export default { getTmbTickets };
