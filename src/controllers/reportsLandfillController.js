// src/controllers/reportsLandfillController.js
// ============================================================================
// LANDFILL REPORTS CONTROLLER - VERSIUNE 2026 COMPLETĂ
// ============================================================================
// ✅ Coduri deșeuri cu procente
// ✅ Operator depozitar (ECO SUD SA - id 19)
// ✅ Valori generator distincte din BD
// ✅ Contract type (Taxa/Tarif)
// ✅ Toate câmpurile pentru tabel + expand row
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

const buildSectorScope = (req) => {
  const access = req.userAccess;
  if (!access) throw new Error('Missing req.userAccess (resolveUserAccess not applied)');

  const isAll = access.accessLevel === 'ALL';
  const sectorIds = Array.isArray(access.sectorIds) ? access.sectorIds : [];
  const requestedSectorUuid = req.requestedSectorUuid || null;

  return { isAll, allowedSectorIds: sectorIds, requestedSectorUuid };
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

  // sector scope (UUID only)
  const scope = buildSectorScope(req);
  if (scope.requestedSectorUuid) {
    where.push(`${baseAlias}.sector_id = $${p++}`);
    params.push(scope.requestedSectorUuid);
  } else if (!scope.isAll) {
    where.push(`${baseAlias}.sector_id = ANY($${p++})`);
    params.push(scope.allowedSectorIds);
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
    where.push(`(${baseAlias}.ticket_number ILIKE $${p} OR ${baseAlias}.vehicle_number ILIKE $${p})`);
    params.push(`%${String(search).trim()}%`);
    p++;
  }

  return {
    whereSql: where.join(' AND '),
    params,
    nextIndex: p,
    startDate,
    endDate,
    currentYear,
  };
};

// ============================================================================
// GET LANDFILL REPORTS
// ============================================================================
export const getLandfillReports = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      sort_by = 'ticket_date',
      sort_dir = 'desc',
    } = req.query;

    const pageNum = clampInt(page, 1, 1000000, 1);
    const limitNum = clampInt(limit, 1, 500, 10);
    const offset = (pageNum - 1) * limitNum;

    const filters = buildFilters(req, 't');

    // SORT MAP
    const sortMap = {
      ticket_date: 't.ticket_date',
      ticket_number: 't.ticket_number',
      sector_number: 's.sector_number',
      supplier_name: 'i.name',
      net_weight_tons: 't.net_weight_tons',
      contract_type: 't.contract_type',
    };
    const sortCol = sortMap[sort_by] || 't.ticket_date';
    const dir = String(sort_dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    // COUNT TOTAL
    const countSql = `
      SELECT COUNT(*)::INTEGER AS total
      FROM waste_tickets_landfill t
      WHERE ${filters.whereSql}
    `;
    const countRes = await pool.query(countSql, filters.params);
    const total = countRes.rows[0]?.total || 0;

    // LIST WITH ALL FIELDS
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
        t.created_at,
        op.name as operator_name
      FROM waste_tickets_landfill t
      JOIN sectors s ON t.sector_id = s.id
      JOIN institutions i ON t.supplier_id = i.id
      JOIN waste_codes wc ON t.waste_code_id = wc.id
      LEFT JOIN institutions op ON op.id = 19
      WHERE ${filters.whereSql}
      ORDER BY ${sortCol} ${dir}, t.created_at ${dir}
      LIMIT $${pLimit} OFFSET $${pOffset}
    `;
    const listRes = await pool.query(listSql, listParams);

    // SUMMARY
    const summarySql = `
      SELECT
        COALESCE(SUM(t.net_weight_tons), 0) as total_tons,
        COUNT(*)::INTEGER as total_tickets,
        COALESCE(AVG(t.net_weight_tons), 0) as avg_tons_per_ticket
      FROM waste_tickets_landfill t
      WHERE ${filters.whereSql}
    `;
    const summaryRes = await pool.query(summarySql, filters.params);

    // BY SECTOR
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

    // ========================================================================
    // ✅ CODURI DEȘEURI CU PROCENTE (sortate descrescător după cantitate)
    // ========================================================================
    const wasteCodesSql = `
      SELECT
        wc.code as waste_code,
        wc.description as waste_description,
        COALESCE(SUM(t.net_weight_tons), 0) as total_tons,
        COUNT(*)::INTEGER as ticket_count
      FROM waste_tickets_landfill t
      JOIN waste_codes wc ON t.waste_code_id = wc.id
      WHERE ${filters.whereSql}
      GROUP BY wc.code, wc.description
      ORDER BY total_tons DESC
    `;
    const wasteCodesRes = await pool.query(wasteCodesSql, filters.params);

    const totalTons = Number(summaryRes.rows[0]?.total_tons || 0);
    const wasteCodesWithPercent = wasteCodesRes.rows.map(row => ({
      code: row.waste_code,
      description: row.waste_description,
      total_tons: Number(row.total_tons || 0),
      ticket_count: row.ticket_count,
      percent: totalTons > 0 ? ((Number(row.total_tons) / totalTons) * 100).toFixed(2) : '0.00',
    }));

    // ========================================================================
    // ✅ FURNIZORI (operatori salubrizare) - cu coduri deșeuri
    // ========================================================================
    const suppliersSql = `
      SELECT 
        i.name,
        wc.code as waste_code,
        COALESCE(SUM(t.net_weight_tons), 0) as total_tons
      FROM waste_tickets_landfill t
      JOIN institutions i ON t.supplier_id = i.id
      LEFT JOIN waste_codes wc ON t.waste_code_id = wc.id
      WHERE ${filters.whereSql}
      GROUP BY i.name, wc.code
      ORDER BY total_tons DESC
    `;
    const suppliersRes = await pool.query(suppliersSql, filters.params);

    // ========================================================================
    // ✅ AVAILABLE YEARS & ALL SECTORS
    // ========================================================================
    const scope = buildSectorScope(req);
    let yearsWhere = '';
    let yearsParams = [];

    if (scope.requestedSectorUuid) {
      yearsWhere = `AND sector_id = $1`;
      yearsParams = [scope.requestedSectorUuid];
    } else if (!scope.isAll) {
      yearsWhere = `AND sector_id = ANY($1)`;
      yearsParams = [scope.allowedSectorIds];
    }

    const yearsQuery = `
      SELECT DISTINCT EXTRACT(YEAR FROM ticket_date)::INTEGER AS year
      FROM waste_tickets_landfill
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
        ${!scope.isAll ? 'AND s.id = ANY($1)' : ''}
      ORDER BY s.sector_number
    `;

    const allSectorsParams = !scope.isAll ? [scope.allowedSectorIds] : [];
    const allSectorsRes = await pool.query(allSectorsQuery, allSectorsParams);

    // ========================================================================
    // ✅ RETURN RESPONSE
    // ========================================================================
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
        waste_codes: wasteCodesWithPercent,
        suppliers: suppliersRes.rows.map(s => ({
          name: s.name,
          code: s.waste_code,
          total_tons: Number(s.total_tons || 0),
        })),
        all_sectors: allSectorsRes.rows.map(s => ({
          sector_id: s.sector_id,
          sector_number: s.sector_number,
          sector_name: s.sector_name,
        })),
        available_years: availableYears,
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

// ============================================================================
// GET AUXILIARY DATA (pentru formulare)
// ============================================================================
export const getAuxiliaryData = async (req, res) => {
  try {
    // ✅ WASTE CODES
    const wasteCodesQuery = `
      SELECT id, code, description, category
      FROM waste_codes
      WHERE is_active = true
      ORDER BY code
    `;
    const wasteCodesRes = await pool.query(wasteCodesQuery);

    // ✅ OPERATORS (colectori, TMB, sortatori) - exclude operatori depozitare
    const operatorsQuery = `
      SELECT id, name, institution_type
      FROM institutions
      WHERE is_active = true 
        AND deleted_at IS NULL
        AND institution_type IN ('COLLECTOR', 'TMB', 'SORTING_FACILITY')
      ORDER BY name
    `;
    const operatorsRes = await pool.query(operatorsQuery);

    // ✅ GENERATOR TYPES (valori distincte din BD)
    const generatorTypesQuery = `
      SELECT DISTINCT generator_type
      FROM waste_tickets_landfill
      WHERE deleted_at IS NULL 
        AND generator_type IS NOT NULL 
        AND generator_type != ''
      ORDER BY generator_type
    `;
    const generatorTypesRes = await pool.query(generatorTypesQuery);

    return res.json({
      success: true,
      data: {
        waste_codes: wasteCodesRes.rows,
        operators: operatorsRes.rows,
        generator_types: generatorTypesRes.rows.map(r => r.generator_type),
        contract_types: ['TAXA', 'TARIF'],
      },
    });
  } catch (err) {
    console.error('getAuxiliaryData error:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch auxiliary data',
      error: err.message,
    });
  }
};

// ============================================================================
// EXPORT (CSV) - păstrăm funcția existentă
// ============================================================================
const toCsv = (rows) => {
  if (!rows || rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const csvRows = [headers.join(',')];
  for (const row of rows) {
    const values = headers.map((h) => {
      const val = row[h];
      const escaped = String(val || '').replace(/"/g, '""');
      return `"${escaped}"`;
    });
    csvRows.push(values.join(','));
  }
  return csvRows.join('\n');
};

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