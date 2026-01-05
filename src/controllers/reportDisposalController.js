// src/controllers/reportDisposalController.js
// ============================================================================
// REPORT: DISPOSAL / LANDFILL TICKETS
// Route: GET /api/reports/tmb/disposal
// ============================================================================

import pool from '../config/database.js';

/* utilitare – IDENTICE cu celelalte controllere */
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
  if (!access) throw new Error('Missing req.userAccess');

  const isAll = access.accessLevel === 'ALL';
  const sectorIds = Array.isArray(access.sectorIds) ? access.sectorIds : [];
  const requestedSectorUuid = req.requestedSectorUuid || null;

  let sectorWhere = '';
  const sectorParams = [];

  if (requestedSectorUuid) {
    sectorWhere = `${alias}.sector_id = \${{}}`;
    sectorParams.push(requestedSectorUuid);
  } else if (!isAll) {
    sectorWhere = `${alias}.sector_id = ANY(\${{}})`;
    sectorParams.push(sectorIds);
  }

  return { sectorWhere, sectorParams };
};

const applyParamIndex = (sql, start) => {
  let i = start;
  return sql.replace(/\$\{\{\}\}/g, () => `$${i++}`);
};

const buildFilters = (req, alias = 't') => {
  const { year, from, to, supplier_id, recipient_id } = req.query;

  const now = new Date();
  const y = isNonEmpty(year) ? clampInt(year, 2000, 2100, now.getFullYear()) : now.getFullYear();
  const startDate = assertValidDate(from || `${y}-01-01`, 'from');
  const endDate = assertValidDate(to || isoDate(now), 'to');

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
    params.push(parseInt(supplier_id, 10));
  }
  if (isNonEmpty(recipient_id)) {
    where.push(`${alias}.recipient_id = $${p++}`);
    params.push(parseInt(recipient_id, 10));
  }

  return { whereSql: where.join(' AND '), params, nextIndex: p };
};

/* ============================================================================
   EXPORT CERUT DE RUTĂ: getDisposalTickets
============================================================================ */
export const getDisposalTickets = async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;

    const pageNum = clampInt(page, 1, 1_000_000, 1);
    const limitNum = clampInt(limit, 1, 500, 50);
    const offset = (pageNum - 1) * limitNum;

    const f = buildFilters(req, 't');

    const listParams = [...f.params, limitNum, offset];

    const sql = `
      SELECT
        t.id,
        t.ticket_number,
        t.ticket_date,
        t.vehicle_number,
        t.net_weight_tons,
        s.sector_number,
        s.sector_name
      FROM waste_tickets_landfill t
      JOIN sectors s ON s.id = t.sector_id
      WHERE ${f.whereSql}
      ORDER BY t.ticket_date DESC
      LIMIT $${f.nextIndex} OFFSET $${f.nextIndex + 1}
    `;

    const result = await pool.query(sql, listParams);
    return res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('getDisposalTickets error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

export default { getDisposalTickets };
