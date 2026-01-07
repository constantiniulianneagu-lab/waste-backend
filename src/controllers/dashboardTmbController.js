// ============================================================================
// TMB DASHBOARD CONTROLLER (RBAC via req.userAccess, UUID sector scoping)
// ============================================================================
// REQUIREMENTS:
// - Route must include: authenticateToken + resolveUserAccess
//   e.g. router.get('/stats', authenticateToken, resolveUserAccess, getTmbStats)
// - sector_id query param supported as 1..6 (mapped to UUID).
// - Uses ONLY parameterized SQL (no unsafe interpolation for user inputs).
// ============================================================================

import pool from '../config/database.js';

const formatNumber = (num) => {
  const n = Number(num || 0);
  return n.toFixed(2);
};

const isoDate = (d) => new Date(d).toISOString().split('T')[0];

const parseSectorNumber = (sector_id) => {
  if (sector_id === undefined || sector_id === null || String(sector_id).trim() === '') return null;
  const n = parseInt(String(sector_id), 10);
  if (Number.isNaN(n) || n < 1 || n > 6) {
    return { error: `Invalid sector_id: ${sector_id}. Must be between 1 and 6.` };
  }
  return { value: n };
};

const buildDateWhere = ({ year, start_date, end_date, alias = '' }) => {
  const col = alias ? `${alias}.ticket_date` : 'ticket_date';
  const del = alias ? `${alias}.deleted_at` : 'deleted_at';

  const where = [`${del} IS NULL`];
  const params = [];

  if (year) {
    const y = parseInt(String(year), 10);
    if (Number.isNaN(y)) return { error: `Invalid year: ${year}` };
    params.push(y);
    where.push(`EXTRACT(YEAR FROM ${col}) = $${params.length}`);
    return { where: where.join(' AND '), params };
  }

  if (start_date) {
    params.push(start_date);
    where.push(`${col} >= $${params.length}`);
  }
  if (end_date) {
    params.push(end_date);
    where.push(`${col} <= $${params.length}`);
  }

  return { where: where.join(' AND '), params };
};

const applySectorScope = ({
  baseWhere,
  baseParams,
  alias = '',
  isAll,
  allowedSectorUuids,
  requestedSectorUuid
}) => {
  const col = alias ? `${alias}.sector_id` : 'sector_id';

  let where = baseWhere;
  const params = [...baseParams];

  if (requestedSectorUuid) {
    params.push(requestedSectorUuid);
    where += ` AND ${col} = $${params.length}`;
  } else if (!isAll) {
    params.push(allowedSectorUuids);
    where += ` AND ${col} = ANY($${params.length})`;
  }

  return { where, params };
};

export const getTmbStats = async (req, res) => {
  try {
    // Check if user has access to TMB page
    const { scopes } = req.userAccess;
    if (scopes?.tmb === 'NONE') {
      return res.status(403).json({ 
        success: false, 
        message: 'Nu aveți permisiune să accesați pagina TMB' 
      });
    }

    const { start_date, end_date, sector_id, year } = req.query;

    // ----------------------------------------------------------------------
    // Access from middleware
    // ----------------------------------------------------------------------
    const access = req.userAccess;
    if (!access) {
      return res.status(500).json({
        success: false,
        message: 'Missing req.userAccess (resolveUserAccess not applied)'
      });
    }

    const isAll = access.accessLevel === 'ALL';
    const allowedSectorUuids = Array.isArray(access.visibleSectorIds) ? access.visibleSectorIds : [];
    if (!isAll && allowedSectorUuids.length === 0) {
      return res.status(403).json({ success: false, message: 'Access denied: no sectors assigned' });
    }

    // ----------------------------------------------------------------------
    // Parse optional sector filter (1..6 -> UUID)
    // ----------------------------------------------------------------------
    let requestedSectorNumber = null;
    let requestedSectorUuid = null;

    const parsed = parseSectorNumber(sector_id);
    if (parsed?.error) return res.status(400).json({ success: false, message: parsed.error });

    if (parsed?.value) {
      requestedSectorNumber = parsed.value;

      const sectorQ = await pool.query(
        `SELECT id FROM sectors WHERE sector_number = $1 AND deleted_at IS NULL LIMIT 1`,
        [requestedSectorNumber]
      );

      if (sectorQ.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Sector inexistent' });
      }

      requestedSectorUuid = sectorQ.rows[0].id;

      if (!isAll && !allowedSectorUuids.includes(requestedSectorUuid)) {
        return res.status(403).json({ success: false, message: 'Access denied: sector not accessible' });
      }
    }

    // ----------------------------------------------------------------------
    // Date filters (aliases)
    // ----------------------------------------------------------------------
    const dateLandfill = buildDateWhere({ year, start_date, end_date, alias: 'wl' });
    const dateTmb = buildDateWhere({ year, start_date, end_date, alias: 'wtt' });

    if (dateLandfill.error) return res.status(400).json({ success: false, message: dateLandfill.error });
    if (dateTmb.error) return res.status(400).json({ success: false, message: dateTmb.error });

    // ----------------------------------------------------------------------
    // Get waste_code_id for '20 03 01'
    // ----------------------------------------------------------------------
    const wasteCodeQuery = await pool.query(`SELECT id FROM waste_codes WHERE code = '20 03 01' LIMIT 1`);
    const wasteCode2003Id = wasteCodeQuery.rows[0]?.id || null;

    // ----------------------------------------------------------------------
    // 1) Landfill direct (ONLY 20 03 01)
    // ----------------------------------------------------------------------
    let wlWhere = dateLandfill.where;
    let wlParams = [...dateLandfill.params];

    if (wasteCode2003Id) {
      wlParams.push(wasteCode2003Id);
      wlWhere += ` AND wl.waste_code_id = $${wlParams.length}`;
    }

    ({ where: wlWhere, params: wlParams } = applySectorScope({
      baseWhere: wlWhere,
      baseParams: wlParams,
      alias: 'wl',
      isAll,
      allowedSectorUuids,
      requestedSectorUuid
    }));

    const landfillQuery = `
      SELECT COALESCE(SUM(wl.net_weight_tons), 0) as total_landfill_direct
      FROM waste_tickets_landfill wl
      WHERE ${wlWhere}
    `;
    const landfillResult = await pool.query(landfillQuery, wlParams);
    const totalLandfillDirect = Number(landfillResult.rows[0]?.total_landfill_direct || 0);

    // ----------------------------------------------------------------------
    // 2) TMB Input (valid associations)
    // ----------------------------------------------------------------------
    let tmbWhere = dateTmb.where;
    let tmbParams = [...dateTmb.params];

    ({ where: tmbWhere, params: tmbParams } = applySectorScope({
      baseWhere: tmbWhere,
      baseParams: tmbParams,
      alias: 'wtt',
      isAll,
      allowedSectorUuids,
      requestedSectorUuid
    }));

    const tmbInputQuery = `
      SELECT COALESCE(SUM(wtt.net_weight_tons), 0) as total_tmb_input
      FROM waste_tickets_tmb wtt
      JOIN tmb_associations ta ON (
        wtt.sector_id = ta.sector_id AND
        wtt.operator_id IN (ta.primary_operator_id, ta.secondary_operator_id) AND
        wtt.ticket_date >= ta.valid_from AND
        (ta.valid_to IS NULL OR wtt.ticket_date <= ta.valid_to)
      )
      WHERE ${tmbWhere}
    `;
    const tmbInputResult = await pool.query(tmbInputQuery, tmbParams);
    const totalTmbInput = Number(tmbInputResult.rows[0]?.total_tmb_input || 0);

    const totalCollected = totalLandfillDirect + totalTmbInput;

    // ----------------------------------------------------------------------
    // 3) Output stats helper (recycling / recovery / disposal)
    // ----------------------------------------------------------------------
    const getOutputStats = async (tableName) => {
      const dateOut = buildDateWhere({ year, start_date, end_date, alias: 'wt' });
      if (dateOut.error) throw new Error(dateOut.error);

      let outWhere = dateOut.where;
      let outParams = [...dateOut.params];

      ({ where: outWhere, params: outParams } = applySectorScope({
        baseWhere: outWhere,
        baseParams: outParams,
        alias: 'wt',
        isAll,
        allowedSectorUuids,
        requestedSectorUuid
      }));

      // tableName este din map (constant), nu vine din user input
      const q = `
        SELECT
          COALESCE(SUM(wt.delivered_quantity_tons), 0) as sent,
          COALESCE(SUM(wt.accepted_quantity_tons), 0) as accepted
        FROM ${tableName} wt
        WHERE ${outWhere}
      `;
      const r = await pool.query(q, outParams);

      const sent = Number(r.rows[0]?.sent || 0);
      const accepted = Number(r.rows[0]?.accepted || 0);
      const rate = sent > 0 ? (accepted / sent) * 100 : 0;

      return {
        sent: Number(sent.toFixed(2)),
        accepted: Number(accepted.toFixed(2)),
        acceptance_rate: Number(rate.toFixed(2)),
      };
    };

    const recyclingStat = await getOutputStats('waste_tickets_recycling');
    const recoveryStat = await getOutputStats('waste_tickets_recovery');
    const disposalStat = await getOutputStats('waste_tickets_disposal');

    // ----------------------------------------------------------------------
    // 4) Stock difference
    // ----------------------------------------------------------------------
    const totalOutputSent = recyclingStat.sent + recoveryStat.sent + disposalStat.sent;
    const stockDifference = totalTmbInput - totalOutputSent;

    // Percentages (din TMB Input)
    const recyclingPercent = totalTmbInput > 0 ? (recyclingStat.sent / totalTmbInput) * 100 : 0;
    const recoveryPercent = totalTmbInput > 0 ? (recoveryStat.sent / totalTmbInput) * 100 : 0;
    const disposalPercent = totalTmbInput > 0 ? (disposalStat.sent / totalTmbInput) * 100 : 0;

    // ----------------------------------------------------------------------
    // 5) Monthly evolution (TMB vs Landfill direct)
    // ----------------------------------------------------------------------
    const tmbMonthlyDate = buildDateWhere({ year, start_date, end_date, alias: 'wtt' });
    if (tmbMonthlyDate.error) throw new Error(tmbMonthlyDate.error);

    let tmbMonthlyWhere = tmbMonthlyDate.where;
    let tmbMonthlyParams = [...tmbMonthlyDate.params];

    ({ where: tmbMonthlyWhere, params: tmbMonthlyParams } = applySectorScope({
      baseWhere: tmbMonthlyWhere,
      baseParams: tmbMonthlyParams,
      alias: 'wtt',
      isAll,
      allowedSectorUuids,
      requestedSectorUuid
    }));

    const wlMonthlyDate = buildDateWhere({ year, start_date, end_date, alias: 'wl' });
    if (wlMonthlyDate.error) throw new Error(wlMonthlyDate.error);

    let wlMonthlyWhere = wlMonthlyDate.where;
    let wlMonthlyParams = [...wlMonthlyDate.params];

    if (wasteCode2003Id) {
      wlMonthlyParams.push(wasteCode2003Id);
      wlMonthlyWhere += ` AND wl.waste_code_id = $${wlMonthlyParams.length}`;
    }

    ({ where: wlMonthlyWhere, params: wlMonthlyParams } = applySectorScope({
      baseWhere: wlMonthlyWhere,
      baseParams: wlMonthlyParams,
      alias: 'wl',
      isAll,
      allowedSectorUuids,
      requestedSectorUuid
    }));

    const tmbMonthlyQuery = `
      SELECT DATE_TRUNC('month', wtt.ticket_date) as month,
             COALESCE(SUM(wtt.net_weight_tons), 0) as tmb_total
      FROM waste_tickets_tmb wtt
      JOIN tmb_associations ta ON (
        wtt.sector_id = ta.sector_id AND
        wtt.operator_id IN (ta.primary_operator_id, ta.secondary_operator_id) AND
        wtt.ticket_date >= ta.valid_from AND
        (ta.valid_to IS NULL OR wtt.ticket_date <= ta.valid_to)
      )
      WHERE ${tmbMonthlyWhere}
      GROUP BY 1
      ORDER BY 1
    `;

    const wlMonthlyQuery = `
      SELECT DATE_TRUNC('month', wl.ticket_date) as month,
             COALESCE(SUM(wl.net_weight_tons), 0) as landfill_total
      FROM waste_tickets_landfill wl
      WHERE ${wlMonthlyWhere}
      GROUP BY 1
      ORDER BY 1
    `;

    const [tmbMonthlyRes, wlMonthlyRes] = await Promise.all([
      pool.query(tmbMonthlyQuery, tmbMonthlyParams),
      pool.query(wlMonthlyQuery, wlMonthlyParams),
    ]);

    const monthlyMap = new Map(); // key=YYYY-MM-DD (month)
    for (const r of tmbMonthlyRes.rows) {
      monthlyMap.set(isoDate(r.month), {
        month: r.month,
        tmb_total: Number(r.tmb_total || 0),
        landfill_total: 0
      });
    }
    for (const r of wlMonthlyRes.rows) {
      const key = isoDate(r.month);
      const existing = monthlyMap.get(key) || {
        month: r.month,
        tmb_total: 0,
        landfill_total: 0
      };
      existing.landfill_total = Number(r.landfill_total || 0);
      monthlyMap.set(key, existing);
    }

    const monthly_evolution = [...monthlyMap.values()]
      .sort((a, b) => new Date(a.month) - new Date(b.month))
      .map((x) => ({
        month: new Date(x.month).toLocaleString('en-US', { month: 'short' }),
        tmb_total: Number(x.tmb_total.toFixed(2)),
        landfill_total: Number(x.landfill_total.toFixed(2)),
      }));

    // ----------------------------------------------------------------------
    // 6) Sector distribution (TMB vs landfill 20 03 01)
    // ----------------------------------------------------------------------
    let sectorsWhere = `s.deleted_at IS NULL AND s.is_active = true`;
    const sectorsParams = [];

    if (requestedSectorUuid) {
      sectorsParams.push(requestedSectorUuid);
      sectorsWhere += ` AND s.id = $${sectorsParams.length}`;
    } else if (!isAll) {
      sectorsParams.push(allowedSectorUuids);
      sectorsWhere += ` AND s.id = ANY($${sectorsParams.length})`;
    }

    const sectorsListRes = await pool.query(
      `SELECT id, sector_name, sector_number
       FROM sectors s
       WHERE ${sectorsWhere}
       ORDER BY sector_number`,
      sectorsParams
    );
    const sectorsList = sectorsListRes.rows;

    const tmbBySectorQuery = `
      SELECT wtt.sector_id, COALESCE(SUM(wtt.net_weight_tons),0) as tmb_tons
      FROM waste_tickets_tmb wtt
      JOIN tmb_associations ta ON (
        wtt.sector_id = ta.sector_id AND
        wtt.operator_id IN (ta.primary_operator_id, ta.secondary_operator_id) AND
        wtt.ticket_date >= ta.valid_from AND
        (ta.valid_to IS NULL OR wtt.ticket_date <= ta.valid_to)
      )
      WHERE ${tmbWhere}
      GROUP BY wtt.sector_id
    `;

    const wlBySectorQuery = `
      SELECT wl.sector_id, COALESCE(SUM(wl.net_weight_tons),0) as landfill_tons
      FROM waste_tickets_landfill wl
      WHERE ${wlWhere}
      GROUP BY wl.sector_id
    `;

    const [tmbBySectorRes, wlBySectorRes] = await Promise.all([
      pool.query(tmbBySectorQuery, tmbParams),
      pool.query(wlBySectorQuery, wlParams),
    ]);

    const tmbSectorMap = new Map(tmbBySectorRes.rows.map(r => [r.sector_id, Number(r.tmb_tons || 0)]));
    const wlSectorMap = new Map(wlBySectorRes.rows.map(r => [r.sector_id, Number(r.landfill_tons || 0)]));

    const sector_distribution = sectorsList.map(s => ({
      sector_name: s.sector_name,
      sector_number: s.sector_number,
      tmb_tons: Number((tmbSectorMap.get(s.id) || 0).toFixed(2)),
      landfill_tons: Number((wlSectorMap.get(s.id) || 0).toFixed(2)),
    }));

    // ----------------------------------------------------------------------
    // 7) Operators table (suppliers) – ✅ include sector_numbers for each operator
    // ----------------------------------------------------------------------
    // TMB suppliers grouped + sector_numbers from sectors join
    const tmbSuppliersQuery = `
      SELECT 
        wtt.supplier_id as institution_id,
        COALESCE(SUM(wtt.net_weight_tons),0) as tmb_total_tons,
        ARRAY_AGG(DISTINCT s.sector_number ORDER BY s.sector_number) as sector_numbers
      FROM waste_tickets_tmb wtt
      JOIN tmb_associations ta ON (
        wtt.sector_id = ta.sector_id AND
        wtt.operator_id IN (ta.primary_operator_id, ta.secondary_operator_id) AND
        wtt.ticket_date >= ta.valid_from AND
        (ta.valid_to IS NULL OR wtt.ticket_date <= ta.valid_to)
      )
      JOIN sectors s ON s.id = wtt.sector_id
      WHERE ${tmbWhere}
      GROUP BY wtt.supplier_id
    `;

    // Landfill suppliers grouped + sector_numbers from sectors join
    const wlSuppliersQuery = `
      SELECT 
        wl.supplier_id as institution_id,
        COALESCE(SUM(wl.net_weight_tons),0) as landfill_total_tons,
        ARRAY_AGG(DISTINCT s.sector_number ORDER BY s.sector_number) as sector_numbers
      FROM waste_tickets_landfill wl
      JOIN sectors s ON s.id = wl.sector_id
      WHERE ${wlWhere}
      GROUP BY wl.supplier_id
    `;

    const [tmbSupRes, wlSupRes] = await Promise.all([
      pool.query(tmbSuppliersQuery, tmbParams),
      pool.query(wlSuppliersQuery, wlParams),
    ]);

    // institution_id -> { tmb, landfill, sectors:Set }
    const suppliersMap = new Map();

    for (const r of tmbSupRes.rows) {
      suppliersMap.set(r.institution_id, {
        tmb: Number(r.tmb_total_tons || 0),
        landfill: 0,
        sectors: new Set((r.sector_numbers || []).map(Number)),
      });
    }

    for (const r of wlSupRes.rows) {
      const existing = suppliersMap.get(r.institution_id) || {
        tmb: 0,
        landfill: 0,
        sectors: new Set(),
      };
      existing.landfill = Number(r.landfill_total_tons || 0);
      (r.sector_numbers || []).forEach((sn) => existing.sectors.add(Number(sn)));
      suppliersMap.set(r.institution_id, existing);
    }

    const ids = [...suppliersMap.keys()];
    let operators = [];

    if (ids.length) {
      const namesRes = await pool.query(
        `SELECT id, name FROM institutions WHERE id = ANY($1)`,
        [ids]
      );
      const nameMap = new Map(namesRes.rows.map(r => [r.id, r.name]));

      operators = ids
        .map((id) => {
          const v = suppliersMap.get(id);
          const total = v.tmb + v.landfill;
          const sector_numbers = Array.from(v.sectors).filter(Boolean).sort((a, b) => a - b);

          return {
            id,
            name: nameMap.get(id) || 'N/A',
            sector_numbers, // ✅ AICI e ce-ți trebuie în tabel (în loc de 1..n)
            tmb_total_tons: Number(v.tmb.toFixed(2)),
            landfill_total_tons: Number(v.landfill.toFixed(2)),
            total_tons: Number(total.toFixed(2)),
            tmb_percent: total > 0 ? Number(((v.tmb / total) * 100).toFixed(2)) : 0,
            landfill_percent: total > 0 ? Number(((v.landfill / total) * 100).toFixed(2)) : 0,
          };
        })
        .filter(o => o.total_tons > 0)
        .sort((a, b) => b.total_tons - a.total_tons);
    }

    // ----------------------------------------------------------------------
    // 8) AVAILABLE YEARS + ALL SECTORS (for filters)
    // ----------------------------------------------------------------------
    let yearsWhere = '';
    let yearsParams = [];

    if (requestedSectorUuid) {
      yearsWhere = `AND sector_id = $1`;
      yearsParams = [requestedSectorUuid];
    } else if (!isAll) {
      yearsWhere = `AND sector_id = ANY($1)`;
      yearsParams = [allowedSectorUuids];
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
    if (!availableYears.includes(currentYearInt)) availableYears.unshift(currentYearInt);

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
    const allSectorsParams = !isAll ? [allowedSectorUuids] : [];
    const allSectorsRes = await pool.query(allSectorsQuery, allSectorsParams);

    // ----------------------------------------------------------------------
    // Response
    // ----------------------------------------------------------------------
    return res.json({
      success: true,
      data: {
        summary: {
          total_collected: formatNumber(totalCollected),
          total_landfill_direct: formatNumber(totalLandfillDirect),
          total_tmb_input: formatNumber(totalTmbInput),
          stock_difference: formatNumber(stockDifference),
          landfill_percent: totalCollected > 0 ? formatNumber((totalLandfillDirect / totalCollected) * 100) : '0.00',
          tmb_percent: totalCollected > 0 ? formatNumber((totalTmbInput / totalCollected) * 100) : '0.00',
        },
        outputs: {
          recycling: recyclingStat,
          recovery: recoveryStat,
          disposal: disposalStat,
          percentages: {
            recycling: formatNumber(recyclingPercent),
            recovery: formatNumber(recoveryPercent),
            disposal: formatNumber(disposalPercent),
          },
        },
        monthly_evolution,
        sector_distribution,
        operators,
        all_sectors: allSectorsRes.rows.map(s => ({
          sector_id: s.sector_id,
          sector_number: s.sector_number,
          sector_name: s.sector_name,
        })),
        available_years: availableYears,
      },
      filters_applied: {
        year: year ? Number(year) : null,
        start_date: start_date || null,
        end_date: end_date || null,
        sector_id: requestedSectorNumber || 'all',
      },
    });
  } catch (error) {
    console.error('❌ TMB Stats error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch TMB statistics',
      error: error.message,
    });
  }
};

export const getOutputDetails = async (req, res) => {
  try {
    // Check if user has access to TMB page
    const { scopes } = req.userAccess;
    if (scopes?.tmb === 'NONE') {
      return res.status(403).json({ 
        success: false, 
        message: 'Nu aveți permisiune să accesați pagina TMB' 
      });
    }

    const { output_type, start_date, end_date, sector_id, year } = req.query;

    const access = req.userAccess;
    if (!access) {
      return res.status(500).json({ success: false, message: 'Missing req.userAccess (resolveUserAccess not applied)' });
    }

    const isAll = access.accessLevel === 'ALL';
    const allowedSectorUuids = Array.isArray(access.visibleSectorIds) ? access.visibleSectorIds : [];
    if (!isAll && allowedSectorUuids.length === 0) {
      return res.status(403).json({ success: false, message: 'Access denied: no sectors assigned' });
    }

    if (!output_type) {
      return res.status(400).json({
        success: false,
        message: 'output_type is required (recycling, recovery, or disposal)',
      });
    }

    const tableMap = {
      recycling: 'waste_tickets_recycling',
      recovery: 'waste_tickets_recovery',
      disposal: 'waste_tickets_disposal',
    };

    const tableName = tableMap[output_type];
    if (!tableName) {
      return res.status(400).json({
        success: false,
        message: 'Invalid output_type. Must be: recycling, recovery, or disposal',
      });
    }

    // sector_id 1..6 -> UUID
    let requestedSectorNumber = null;
    let requestedSectorUuid = null;

    const parsed = parseSectorNumber(sector_id);
    if (parsed?.error) return res.status(400).json({ success: false, message: parsed.error });

    if (parsed?.value) {
      requestedSectorNumber = parsed.value;
      const sectorQ = await pool.query(
        `SELECT id FROM sectors WHERE sector_number = $1 AND deleted_at IS NULL LIMIT 1`,
        [requestedSectorNumber]
      );
      if (sectorQ.rows.length === 0) return res.status(404).json({ success: false, message: 'Sector inexistent' });

      requestedSectorUuid = sectorQ.rows[0].id;
      if (!isAll && !allowedSectorUuids.includes(requestedSectorUuid)) {
        return res.status(403).json({ success: false, message: 'Access denied: sector not accessible' });
      }
    }

    // Date where (alias wt)
    const dateBase = buildDateWhere({ year, start_date, end_date, alias: 'wt' });
    if (dateBase.error) return res.status(400).json({ success: false, message: dateBase.error });

    let where = dateBase.where;
    let params = [...dateBase.params];

    ({ where, params } = applySectorScope({
      baseWhere: where,
      baseParams: params,
      alias: 'wt',
      isAll,
      allowedSectorUuids,
      requestedSectorUuid
    }));

    const query = `
      SELECT
        wt.ticket_number,
        wt.ticket_date,
        wt.ticket_time,
        sup.name as supplier_name,
        rec.name as recipient_name,
        wc.code as waste_code,
        wc.description as waste_description,
        wt.delivered_quantity_tons,
        wt.accepted_quantity_tons,
        wt.vehicle_number
      FROM ${tableName} wt
      JOIN institutions sup ON wt.supplier_id = sup.id
      JOIN institutions rec ON wt.recipient_id = rec.id
      JOIN waste_codes wc ON wt.waste_code_id = wc.id
      WHERE ${where}
      ORDER BY wt.ticket_date DESC, wt.ticket_time DESC
      LIMIT 100
    `;

    const result = await pool.query(query, params);

    return res.json({
      success: true,
      data: {
        output_type,
        tickets: result.rows,
      },
      filters_applied: {
        year: year ? Number(year) : null,
        start_date: start_date || null,
        end_date: end_date || null,
        sector_id: requestedSectorNumber || 'all',
      },
    });
  } catch (error) {
    console.error('❌ Output details error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch output details',
      error: error.message,
    });
  }
};

export default { getTmbStats, getOutputDetails };