// src/controllers/reportsLandfillController.js
// ============================================================================
// LANDFILL REPORTS CONTROLLER (RBAC via req.userAccess, UUID sector scoping)
// ============================================================================
// REQUIREMENTS (already enforced by routes):
// - authenticateToken
// - resolveUserAccess (sets req.userAccess)
// - authorizeRoles excludes REGULATOR_VIEWER from /reports
// - enforceSectorAccess (optional) blocks invalid sector requests and sets req.requestedSectorUuid
//
// IMPORTANT:
// - waste_tickets_landfill.sector_id is UUID
// - No role logic or manual sector computation in this controller.
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

const buildSectorScope = (req, tableAlias = 't') => {
  const access = req.userAccess;
  if (!access) throw new Error('Missing req.userAccess (resolveUserAccess not applied)');

  const isAll = access.accessLevel === 'ALL';
  const sectorIds = Array.isArray(access.sectorIds) ? access.sectorIds : [];

  // enforceSectorAccess sets this if the user requested a specific sector (UUID)
  const requestedSectorUuid = req.requestedSectorUuid || null;

  let sectorWhere = '';
  const sectorParams = [];

  // ⚠️ IMPORTANT: WITHOUT leading "AND" (because buildFilters joins with " AND ")
  if (requestedSectorUuid) {
    sectorWhere = `${tableAlias}.sector_id = ${{}}`; // placeholder replaced later
    sectorParams.push(requestedSectorUuid);
  } else if (!isAll) {
    sectorWhere = `${tableAlias}.sector_id = ANY(${{}})`;
    sectorParams.push(sectorIds);
  }

  return {
    isAll,
    allowedSectorIds: sectorIds,
    requestedSectorUuid,
    sectorWhere,
    sectorParams,
  };
};


const applyParamIndex = (sqlWithPlaceholders, startIndex) => {
  // Replace each occurrence of ${{}} in order with $<index>
  let idx = startIndex;
  return sqlWithPlaceholders.replace(/\$\{\{\}\}/g, () => `$${idx++}`);
};

// Build WHERE + params safely
const buildFilters = (req, baseAlias = 't') => {
  const {
    year,
    from,
    to,
    supplier_id,
    waste_code_id,
    generator_type,
    operation_type,
    contract_type,
    search,
  } = req.query;

  const now = new Date();
  const currentYear = year ? clampInt(year, 2000, 2100, now.getFullYear()) : now.getFullYear();

  const startDate = assertValidDate(from || `${currentYear}-01-01`, 'from');
  const endDate = assertValidDate(to || isoDate(now), 'to');

  if (new Date(startDate) > new Date(endDate)) {
    const err = new Error('`from` must be <= `to`');
    err.statusCode = 400;
    throw err;
  }

  const where = [
    `${baseAlias}.deleted_at IS NULL`,
    `${baseAlias}.ticket_date >= $1`,
    `${baseAlias}.ticket_date <= $2`,
  ];

  const params = [startDate, endDate];
  let p = 3;

  // sector scope (UUID)
  const scope = buildSectorScope(req, baseAlias);
  if (scope.sectorWhere) {
    where.push(applyParamIndex(scope.sectorWhere, p));
    params.push(...scope.sectorParams);
    p += scope.sectorParams.length;
  }

  // other filters
  if (isNonEmpty(supplier_id)) {
    where.push(`${baseAlias}.supplier_id = $${p++}`);
    params.push(parseInt(String(supplier_id), 10));
  }

  if (isNonEmpty(waste_code_id)) {
    where.push(`${baseAlias}.waste_code_id = $${p++}`);
    params.push(String(waste_code_id));
  }

  if (isNonEmpty(generator_type)) {
    where.push(`${baseAlias}.generator_type = $${p++}`);
    params.push(String(generator_type));
  }

  if (isNonEmpty(operation_type)) {
    where.push(`${baseAlias}.operation_type = $${p++}`);
    params.push(String(operation_type));
  }

  if (isNonEmpty(contract_type)) {
    where.push(`${baseAlias}.contract_type = $${p++}`);
    params.push(String(contract_type));
  }

  if (isNonEmpty(search)) {
    // Search in ticket_number or vehicle_number
    where.push(`(${baseAlias}.ticket_number ILIKE $${p} OR ${baseAlias}.vehicle_number ILIKE $${p})`);
    params.push(`%${String(search).trim()}%`);
    p++;
  }

  return {
    startDate,
    endDate,
    currentYear,
    whereSql: where.join(' AND '),
    params,
    nextIndex: p,
    scope,
  };
};

// CSV export helper
const toCsv = (rows) => {
  if (!rows || !rows.length) return '';
  const headers = Object.keys(rows[0]);
  const escape = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [headers.join(',')];
  for (const r of rows) {
    lines.push(headers.map((h) => escape(r[h])).join(','));
  }
  return lines.join('\n');
};

// ----------------------------------------------------------------------------
// 1) Auxiliary data (filters)
// GET /api/reports/landfill/auxiliary
// ----------------------------------------------------------------------------
export const getAuxiliaryData = async (req, res) => {
  try {
    // Sectors must respect RBAC
    const scope = buildSectorScope(req, 's');

    let sectorsSql = `
      SELECT s.id, s.sector_number, s.sector_name
      FROM sectors s
      WHERE s.deleted_at IS NULL AND s.is_active = true
    `;
    const sectorsParams = [];
    let p = 1;

    if (scope.requestedSectorUuid) {
      sectorsSql += ` AND s.id = $${p++}`;
      sectorsParams.push(scope.requestedSectorUuid);
    } else if (scope.isAll === false) {
      sectorsSql += ` AND s.id = ANY($${p++})`;
      sectorsParams.push(scope.allowedSectorIds);
    }

    sectorsSql += ` ORDER BY s.sector_number`;

    const [sectorsRes, suppliersRes, wasteCodesRes, yearsRes] = await Promise.all([
      pool.query(sectorsSql, sectorsParams),

      // Suppliers used in landfill tickets (no need RBAC here; RBAC applied at report query time)
      pool.query(
        `
        SELECT DISTINCT i.id, i.name
        FROM waste_tickets_landfill t
        JOIN institutions i ON t.supplier_id = i.id
        WHERE t.deleted_at IS NULL
        ORDER BY i.name
        `
      ),

      pool.query(
        `
        SELECT id, code, description, category
        FROM waste_codes
        WHERE is_active = true
        ORDER BY code
        `
      ),

      // Available years must respect RBAC scope
      (async () => {
        let yearsSql = `
          SELECT DISTINCT EXTRACT(YEAR FROM t.ticket_date)::INTEGER AS year
          FROM waste_tickets_landfill t
          WHERE t.deleted_at IS NULL
        `;
        const yearsParams = [];
        let yp = 1;

        if (req.requestedSectorUuid) {
          yearsSql += ` AND t.sector_id = $${yp++}`;
          yearsParams.push(req.requestedSectorUuid);
        } else if (req.userAccess?.accessLevel !== 'ALL') {
          yearsSql += ` AND t.sector_id = ANY($${yp++})`;
          yearsParams.push(req.userAccess?.sectorIds || []);
        }

        yearsSql += ` ORDER BY year DESC`;
        return pool.query(yearsSql, yearsParams);
      })(),
    ]);

    return res.json({
      success: true,
      data: {
        sectors: sectorsRes.rows,
        suppliers: suppliersRes.rows,
        waste_codes: wasteCodesRes.rows,
        available_years: yearsRes.rows.map((r) => r.year),
      },
    });
  } catch (err) {
    console.error('getAuxiliaryData error:', err);
    const code = err.statusCode || 500;
    return res.status(code).json({ success: false, message: 'Failed to fetch auxiliary data', error: err.message });
  }
};

// ----------------------------------------------------------------------------
// 2) Main landfill report
// GET /api/reports/landfill
// ----------------------------------------------------------------------------
export const getLandfillReports = async (req, res) => {
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

    const filters = buildFilters(req, 't');

    // Whitelist sorting
    const sortMap = {
      ticket_date: 't.ticket_date',
      ticket_number: 't.ticket_number',
      sector_number: 's.sector_number',
      supplier_name: 'i.name',
      net_weight_tons: 't.net_weight_tons',
    };
    const sortCol = sortMap[sort_by] || 't.ticket_date';
    const dir = String(sort_dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    // COUNT
    const countSql = `
      SELECT COUNT(*)::INTEGER AS total
      FROM waste_tickets_landfill t
      JOIN sectors s ON t.sector_id = s.id
      JOIN institutions i ON t.supplier_id = i.id
      JOIN waste_codes wc ON t.waste_code_id = wc.id
      WHERE ${filters.whereSql}
    `;
    const countRes = await pool.query(countSql, filters.params);
    const total = countRes.rows[0]?.total || 0;

    // LIST
    // add LIMIT/OFFSET params
    const listParams = [...filters.params];
    const pLimit = filters.nextIndex;
    const pOffset = filters.nextIndex + 1;
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
        i.id as supplier_id,
        i.name as supplier_name,
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
        t.created_at
      FROM waste_tickets_landfill t
      JOIN sectors s ON t.sector_id = s.id
      JOIN institutions i ON t.supplier_id = i.id
      JOIN waste_codes wc ON t.waste_code_id = wc.id
      WHERE ${filters.whereSql}
      ORDER BY ${sortCol} ${dir}, t.created_at ${dir}
      LIMIT $${pLimit} OFFSET $${pOffset}
    `;
    const listRes = await pool.query(listSql, listParams);

    // SUMMARY (within filters)
    const summarySql = `
      SELECT
        COALESCE(SUM(t.net_weight_tons), 0) as total_tons,
        COUNT(*)::INTEGER as total_tickets,
        COALESCE(AVG(t.net_weight_tons), 0) as avg_tons_per_ticket
      FROM waste_tickets_landfill t
      WHERE ${filters.whereSql}
    `;
    const summaryRes = await pool.query(summarySql, filters.params);

    // BY SECTOR (within filters)
    const bySectorSql = `
      SELECT
        s.sector_number,
        s.sector_name,
        COUNT(*)::INTEGER as ticket_count,
        COALESCE(SUM(t.net_weight_tons), 0) as total_tons
      FROM waste_tickets_landfill t
      JOIN sectors s ON t.sector_id = s.id
      WHERE ${filters.whereSql}
      GROUP BY s.sector_number, s.sector_name
      ORDER BY s.sector_number
    `;
    const bySectorRes = await pool.query(bySectorSql, filters.params);

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
          total_tons: Number(summaryRes.rows[0]?.total_tons || 0),
          total_tickets: summaryRes.rows[0]?.total_tickets || 0,
          avg_tons_per_ticket: Number(summaryRes.rows[0]?.avg_tons_per_ticket || 0),
          date_range: { from: filters.startDate, to: filters.endDate },
        },
        by_sector: bySectorRes.rows.map((r) => ({
          sector_number: r.sector_number,
          sector_name: r.sector_name,
          ticket_count: r.ticket_count,
          total_tons: Number(r.total_tons || 0),
        })),
      },
      filters_applied: {
        year: filters.currentYear,
        from: filters.startDate,
        to: filters.endDate,
        sector_uuid: req.requestedSectorUuid || null,
      },
    });
  } catch (err) {
    console.error('getLandfillReports error:', err);
    const code = err.statusCode || 500;
    return res.status(code).json({
      success: false,
      message: 'Failed to fetch landfill reports',
      error: err.message,
    });
  }
};

// ----------------------------------------------------------------------------
// 3) Export landfill report (CSV)
// GET /api/reports/landfill/export
// ----------------------------------------------------------------------------
export const exportLandfillReports = async (req, res) => {
  try {
    const filters = buildFilters(req, 't');

    const exportSql = `
      SELECT
        t.ticket_number,
        t.ticket_date,
        t.ticket_time,
        s.sector_number,
        s.sector_name,
        i.name as supplier_name,
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
        t.created_at
      FROM waste_tickets_landfill t
      JOIN sectors s ON t.sector_id = s.id
      JOIN institutions i ON t.supplier_id = i.id
      JOIN waste_codes wc ON t.waste_code_id = wc.id
      WHERE ${filters.whereSql}
      ORDER BY t.ticket_date DESC, t.created_at DESC
    `;

    const exportRes = await pool.query(exportSql, filters.params);
    const csv = toCsv(exportRes.rows);

    const fileName = `raport_depozitare_${filters.startDate}_${filters.endDate}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

    return res.status(200).send(csv);
  } catch (err) {
    console.error('exportLandfillReports error:', err);
    const code = err.statusCode || 500;
    return res.status(code).json({
      success: false,
      message: 'Failed to export landfill reports',
      error: err.message,
    });
  }
};

export default {
  getLandfillReports,
  getAuxiliaryData,
  exportLandfillReports,
};
