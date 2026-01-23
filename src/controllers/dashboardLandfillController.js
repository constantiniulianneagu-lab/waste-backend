/** 
 * ============================================================================
 * DASHBOARD LANDFILL CONTROLLER - FIXED VERSION
 * ============================================================================
 * 
 * ✅ FIXES:
 * - Available years include always current year + minimum 3 years
 * - All sectors returned separately for dropdown
 * - Per sector data includes all accessible sectors (even with 0 data)
 * 
 * ✅ NEW:
 * - Monthly evolution by sectors (stacked series)
 * - Monthly evolution by waste codes (top N + ALTELE)
 * 
 * ============================================================================
 */

import db from '../config/database.js';

/**
 * ============================================================================
 * HELPERS
 * ============================================================================
 */
const formatTons = (num) => {
  const n = Number(num || 0);
  return n.toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const getSectorColor = (sectorNumber) => {
  const colors = {
    1: '#7C3AED',
    2: '#E5E7EB',
    3: '#10B981',
    4: '#F59E0B',
    5: '#EC4899',
    6: '#06B6D4',
  };
  return colors[sectorNumber] || '#6B7280';
};

const getWasteCodeColor = (code) => {
  const colors = {
    '20 03 01': '#7C3AED',
    '20 03 07': '#10B981',
    '19 12 12': '#F59E0B',
    '19 05 99': '#EC4899',
  };
  return colors[code] || '#6B7280';
};

const getMonthName = (month) => {
  const months = ['Ian', 'Feb', 'Mar', 'Apr', 'Mai', 'Iun', 'Iul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return months[Number(month) - 1] || '';
};

const getDateRangeFromYear = (year) => {
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  return { from, to };
};

/**
 * ============================================================================
 * MAIN CONTROLLER
 * ============================================================================
 */
const getStats = async (req, res) => {
  try {
    const debug = req.query.debug === '1';

    // ----------------------------------------------------------------------
    // 1) User & Sector Access
    // ----------------------------------------------------------------------
    const user = req.user;
    const userSectors = user?.accessible_sectors || [];
    const isAll = userSectors.includes('all');

    // Sector filter from request (can be UUID or sector_number)
    const requestedSector = req.query.sector_id || 'all';
    const requestedSectorUuid = (requestedSector && requestedSector !== 'all' && requestedSector.length > 10) ? requestedSector : null;
    const requestedSectorNumber = (requestedSector && requestedSector !== 'all' && requestedSector.length <= 10) ? Number(requestedSector) : null;

    // Resolve sector number -> uuid if needed
    let resolvedSectorUuid = null;
    if (requestedSectorNumber) {
      const secRes = await db.query(`
        SELECT id
        FROM sectors
        WHERE sector_number = $1
        LIMIT 1
      `, [requestedSectorNumber]);
      resolvedSectorUuid = secRes.rows?.[0]?.id || null;
    }

    const effectiveSectorUuid = requestedSectorUuid || resolvedSectorUuid;

    // ----------------------------------------------------------------------
    // 2) Year / Date filters
    // ----------------------------------------------------------------------
    const currentYear = Number(req.query.year) || new Date().getFullYear();

    let startDate = req.query.from;
    let endDate = req.query.to;

    if (!startDate || !endDate) {
      const range = getDateRangeFromYear(currentYear);
      startDate = range.from;
      endDate = range.to;
    }

    // ----------------------------------------------------------------------
    // 3) Sector WHERE clause + params
    // ----------------------------------------------------------------------
    // sectorWhere always begins with AND (safe in our query templates)
    let sectorWhere = '';
    let paramsBase = [startDate, endDate];

    if (effectiveSectorUuid) {
      // requested one sector
      sectorWhere = `AND wtl.sector_id = $3`;
      paramsBase = [startDate, endDate, effectiveSectorUuid];
    } else if (!isAll) {
      // user has limited sectors
      sectorWhere = `AND wtl.sector_id = ANY($3)`;
      paramsBase = [startDate, endDate, userSectors];
    } else {
      // all access
      sectorWhere = '';
      paramsBase = [startDate, endDate];
    }

    // ----------------------------------------------------------------------
    // 4) Summary
    // ----------------------------------------------------------------------
    const summaryQuery = `
      SELECT
        COALESCE(SUM(wtl.net_weight_tons), 0) AS total_tons,
        COUNT(*) AS total_tickets,
        COALESCE(AVG(wtl.net_weight_tons), 0) AS avg_weight_per_ticket
      FROM waste_tickets_landfill wtl
      WHERE wtl.deleted_at IS NULL
        AND wtl.ticket_date >= $1
        AND wtl.ticket_date <= $2
        ${sectorWhere}
    `;

    const summaryRes = await db.query(summaryQuery, paramsBase);
    const summary = summaryRes.rows?.[0] || {};

    const totalTons = Number(summary.total_tons || 0);

    // ----------------------------------------------------------------------
    // 5) Treated vs Direct (if applicable in your schema; kept as-is)
    // ----------------------------------------------------------------------
    // (Controller original logic preserved)
    const treatedWasteTons = 0;
    const treatedWastePercentage = 0;
    const directWasteTons = totalTons;
    const directWastePercentage = 100;

    // ----------------------------------------------------------------------
    // 6) Waste categories
    // ----------------------------------------------------------------------
    const wasteCategoriesQuery = `
      SELECT
        wc.code AS waste_code,
        wc.description AS waste_description,
        COALESCE(SUM(wtl.net_weight_tons), 0) AS total_tons
      FROM waste_tickets_landfill wtl
      JOIN waste_codes wc ON wtl.waste_code_id = wc.id
      WHERE wtl.deleted_at IS NULL
        AND wtl.ticket_date >= $1
        AND wtl.ticket_date <= $2
        ${sectorWhere}
      GROUP BY wc.code, wc.description
      ORDER BY total_tons DESC
      LIMIT 10
    `;
    const wasteCategoriesRes = await db.query(wasteCategoriesQuery, paramsBase);
    const wasteCategories = wasteCategoriesRes.rows.map((r) => ({
      waste_code: r.waste_code,
      waste_description: r.waste_description,
      total_tons: Number(r.total_tons || 0),
      total_tons_formatted: formatTons(r.total_tons),
      color: getWasteCodeColor(r.waste_code),
    }));

    // ----------------------------------------------------------------------
    // 7) Per sector (include all accessible sectors even 0)
    // ----------------------------------------------------------------------
    const allSectorsRes = await db.query(`
      SELECT
        s.id AS sector_id,
        s.sector_number,
        s.name AS sector_name
      FROM sectors s
      ORDER BY s.sector_number
    `);

    // Which sectors are allowed for this user?
    const allowedSectors = (() => {
      if (effectiveSectorUuid) return [effectiveSectorUuid];
      if (isAll) return allSectorsRes.rows.map(r => r.sector_id);
      return userSectors; // uuid array
    })();

    const perSectorQuery = `
      SELECT
        s.id AS sector_id,
        s.sector_number,
        s.name AS sector_name,
        COALESCE(SUM(wtl.net_weight_tons), 0) AS total_tons
      FROM sectors s
      LEFT JOIN waste_tickets_landfill wtl ON wtl.sector_id = s.id
        AND wtl.deleted_at IS NULL
        AND wtl.ticket_date >= $1
        AND wtl.ticket_date <= $2
      WHERE s.id = ANY($3)
      GROUP BY s.id, s.sector_number, s.name
      ORDER BY s.sector_number
    `;

    const perSectorRes = await db.query(perSectorQuery, [startDate, endDate, allowedSectors]);
    const perSector = perSectorRes.rows.map((r) => ({
      sector_id: r.sector_id,
      sector_number: Number(r.sector_number),
      sector_name: r.sector_name,
      total_tons: Number(r.total_tons || 0),
      total_tons_formatted: formatTons(r.total_tons),
      color: getSectorColor(Number(r.sector_number)),
    }));

    // ----------------------------------------------------------------------
    // 8) MONTHLY EVOLUTION (total)
    // ----------------------------------------------------------------------
    const monthlyQuery = `
      SELECT
        EXTRACT(YEAR FROM wtl.ticket_date)::INTEGER AS year,
        EXTRACT(MONTH FROM wtl.ticket_date)::INTEGER AS month,
        COALESCE(SUM(wtl.net_weight_tons), 0) AS total_tons
      FROM waste_tickets_landfill wtl
      WHERE wtl.deleted_at IS NULL
        AND wtl.ticket_date >= $1
        AND wtl.ticket_date <= $2
        ${sectorWhere}
      GROUP BY year, month
      ORDER BY year, month
    `;

    const monthlyRes = await db.query(monthlyQuery, paramsBase);
    const monthlyEvolution = monthlyRes.rows.map((r) => {
      const tons = Number(r.total_tons || 0);
      return {
        year: r.year,
        month: r.month,
        month_name: getMonthName(r.month),
        month_label: `${getMonthName(r.month)} ${r.year}`,
        total_tons: tons,
        total_tons_formatted: formatTons(tons),
      };
    });

    // ----------------------------------------------------------------------
    // 8B) MONTHLY EVOLUTION BY SECTORS (stacked series)
    // ----------------------------------------------------------------------
    const monthlyBySectorQuery = `
      SELECT
        EXTRACT(YEAR FROM wtl.ticket_date)::INTEGER AS year,
        EXTRACT(MONTH FROM wtl.ticket_date)::INTEGER AS month,
        s.sector_number::INTEGER AS sector_number,
        COALESCE(SUM(wtl.net_weight_tons), 0) AS total_tons
      FROM waste_tickets_landfill wtl
      JOIN sectors s ON wtl.sector_id = s.id
      WHERE wtl.deleted_at IS NULL
        AND wtl.ticket_date >= $1
        AND wtl.ticket_date <= $2
        ${sectorWhere}
      GROUP BY year, month, s.sector_number
      ORDER BY year, month, s.sector_number
    `;

    const monthlyBySectorRes = await db.query(monthlyBySectorQuery, paramsBase);

    const monthly_sector_keys = Array.from(
      new Set(monthlyBySectorRes.rows.map(r => `sector_${Number(r.sector_number)}`))
    ).sort((a, b) => Number(a.replace('sector_', '')) - Number(b.replace('sector_', '')));

    const bySectorMap = new Map();
    for (const r of monthlyBySectorRes.rows) {
      const year = Number(r.year);
      const month = Number(r.month);
      const key = `${year}-${month}`;

      if (!bySectorMap.has(key)) {
        bySectorMap.set(key, {
          year,
          month,
          month_name: getMonthName(month),
          month_label: `${getMonthName(month)} ${year}`,
          total_tons: 0,
          total_tons_formatted: formatTons(0),
        });
      }

      const obj = bySectorMap.get(key);
      const sectorKey = `sector_${Number(r.sector_number)}`;
      const tons = Number(r.total_tons || 0);

      obj[sectorKey] = tons;
      obj.total_tons += tons;
    }

    const monthly_evolution_sectors = Array.from(bySectorMap.values())
      .sort((a, b) => (a.year - b.year) || (a.month - b.month))
      .map((o) => {
        for (const k of monthly_sector_keys) {
          if (typeof o[k] !== 'number') o[k] = 0;
        }
        o.total_tons_formatted = formatTons(o.total_tons);
        return o;
      });

    // ----------------------------------------------------------------------
    // 8C) MONTHLY EVOLUTION BY WASTE CODES (top N + ALTELE)
    // ----------------------------------------------------------------------
    const TOP_CODES = 6;

    const topCodesQuery = `
      SELECT
        wc.code AS waste_code,
        COALESCE(SUM(wtl.net_weight_tons), 0) AS total_tons
      FROM waste_tickets_landfill wtl
      JOIN waste_codes wc ON wtl.waste_code_id = wc.id
      WHERE wtl.deleted_at IS NULL
        AND wtl.ticket_date >= $1
        AND wtl.ticket_date <= $2
        ${sectorWhere}
      GROUP BY wc.code
      ORDER BY total_tons DESC
      LIMIT ${TOP_CODES}
    `;

    const topCodesRes = await db.query(topCodesQuery, paramsBase);
    const topCodes = topCodesRes.rows.map(r => r.waste_code).filter(Boolean);

    const monthlyByCodeQuery = `
      SELECT
        EXTRACT(YEAR FROM wtl.ticket_date)::INTEGER AS year,
        EXTRACT(MONTH FROM wtl.ticket_date)::INTEGER AS month,
        wc.code AS waste_code,
        COALESCE(SUM(wtl.net_weight_tons), 0) AS total_tons
      FROM waste_tickets_landfill wtl
      JOIN waste_codes wc ON wtl.waste_code_id = wc.id
      WHERE wtl.deleted_at IS NULL
        AND wtl.ticket_date >= $1
        AND wtl.ticket_date <= $2
        ${sectorWhere}
      GROUP BY year, month, wc.code
      ORDER BY year, month, wc.code
    `;

    const monthlyByCodeRes = await db.query(monthlyByCodeQuery, paramsBase);

    const monthly_code_keys = [...topCodes, 'ALTELE'];

    const byCodeMap = new Map();
    for (const r of monthlyByCodeRes.rows) {
      const year = Number(r.year);
      const month = Number(r.month);
      const key = `${year}-${month}`;

      if (!byCodeMap.has(key)) {
        byCodeMap.set(key, {
          year,
          month,
          month_name: getMonthName(month),
          month_label: `${getMonthName(month)} ${year}`,
          total_tons: 0,
          total_tons_formatted: formatTons(0),
        });
      }

      const obj = byCodeMap.get(key);
      const code = r.waste_code;
      const tons = Number(r.total_tons || 0);

      const bucket = topCodes.includes(code) ? code : 'ALTELE';

      obj[bucket] = (obj[bucket] || 0) + tons;
      obj.total_tons += tons;
    }

    const monthly_evolution_codes = Array.from(byCodeMap.values())
      .sort((a, b) => (a.year - b.year) || (a.month - b.month))
      .map((o) => {
        for (const k of monthly_code_keys) {
          if (typeof o[k] !== 'number') o[k] = 0;
        }
        o.total_tons_formatted = formatTons(o.total_tons);
        return o;
      });

    // ----------------------------------------------------------------------
    // Monthly stats (based on total monthlyEvolution)
    // ----------------------------------------------------------------------
    const monthlyTotals = monthlyEvolution.map((m) => Number(m.total_tons || 0));
    const maxVal = monthlyTotals.length ? Math.max(...monthlyTotals) : 0;
    const minVal = monthlyTotals.length ? Math.min(...monthlyTotals) : 0;
    const avgVal = monthlyTotals.length
      ? monthlyTotals.reduce((a, b) => a + b, 0) / monthlyTotals.length
      : 0;

    const findMonthLabel = (value) => {
      const found = monthlyEvolution.find((m) => Number(m.total_tons || 0) === value);
      return found?.month_label || 'N/A';
    };

    // trending: compare last month vs previous month
    let trending = { direction: 'up', value: 0, vs_period: 'anterior' };
    if (monthlyEvolution.length >= 2) {
      const last = Number(monthlyEvolution[monthlyEvolution.length - 1].total_tons || 0);
      const prev = Number(monthlyEvolution[monthlyEvolution.length - 2].total_tons || 0);
      const diffPct = prev > 0 ? ((last - prev) / prev) * 100 : 0;
      trending = {
        direction: diffPct < 0 ? 'down' : 'up',
        value: Number(diffPct.toFixed(1)),
        vs_period: 'luna anterioară',
      };
    }

    const monthlyStats = {
      maximum: { value: maxVal, month: findMonthLabel(maxVal) },
      minimum: { value: minVal, month: findMonthLabel(minVal) },
      average_monthly: Number(avgVal.toFixed(2)),
      trending,
    };

    // ----------------------------------------------------------------------
    // 9) Top operators
    // ----------------------------------------------------------------------
    const topOperatorsQuery = `
      SELECT
        i.name AS operator_name,
        COALESCE(SUM(wtl.net_weight_tons), 0) AS total_tons
      FROM waste_tickets_landfill wtl
      JOIN institutions i ON wtl.operator_id = i.id
      WHERE wtl.deleted_at IS NULL
        AND wtl.ticket_date >= $1
        AND wtl.ticket_date <= $2
        ${sectorWhere}
      GROUP BY i.name
      ORDER BY total_tons DESC
      LIMIT 10
    `;
    const topOperatorsRes = await db.query(topOperatorsQuery, paramsBase);
    const topOperators = topOperatorsRes.rows.map((r) => ({
      operator_name: r.operator_name,
      total_tons: Number(r.total_tons || 0),
      total_tons_formatted: formatTons(r.total_tons),
    }));

    // ----------------------------------------------------------------------
    // 10) Recent tickets
    // ----------------------------------------------------------------------
    const recentTicketsQuery = `
      SELECT
        wtl.ticket_number,
        wtl.ticket_date,
        wc.code AS waste_code,
        i.name AS operator_name,
        s.sector_number,
        COALESCE(wtl.net_weight_tons, 0) AS net_weight_tons
      FROM waste_tickets_landfill wtl
      JOIN waste_codes wc ON wtl.waste_code_id = wc.id
      JOIN institutions i ON wtl.operator_id = i.id
      JOIN sectors s ON wtl.sector_id = s.id
      WHERE wtl.deleted_at IS NULL
        AND wtl.ticket_date >= $1
        AND wtl.ticket_date <= $2
        ${sectorWhere}
      ORDER BY wtl.ticket_date DESC
      LIMIT 8
    `;
    const recentTicketsRes = await db.query(recentTicketsQuery, paramsBase);
    const recentTickets = recentTicketsRes.rows.map((r) => ({
      ticket_number: r.ticket_number,
      ticket_date: r.ticket_date,
      waste_code: r.waste_code,
      operator_name: r.operator_name,
      sector_number: Number(r.sector_number),
      net_weight_tons: Number(r.net_weight_tons || 0),
      net_weight_tons_formatted: formatTons(r.net_weight_tons),
    }));

    // ----------------------------------------------------------------------
    // 11) Available years (always include current year + minimum 3 years)
    // ----------------------------------------------------------------------
    const yearsRes = await db.query(`
      SELECT DISTINCT EXTRACT(YEAR FROM ticket_date)::INTEGER AS year
      FROM waste_tickets_landfill
      WHERE deleted_at IS NULL
      ORDER BY year DESC
      LIMIT 10
    `);

    const yearsFromDb = yearsRes.rows.map(r => Number(r.year)).filter(Boolean);
    const minYears = 3;
    const yearsSet = new Set(yearsFromDb);

    yearsSet.add(new Date().getFullYear());
    while (yearsSet.size < minYears) {
      yearsSet.add(new Date().getFullYear() - yearsSet.size);
    }

    const availableYears = Array.from(yearsSet).sort((a, b) => b - a);

    // ----------------------------------------------------------------------
    // 12) Response
    // ----------------------------------------------------------------------
    const response = {
      success: true,
      data: {
        summary: {
          total_tons: totalTons,
          total_tons_formatted: formatTons(totalTons),
          total_tickets: Number(summary.total_tickets || 0),
          avg_weight_per_ticket: Number(summary.avg_weight_per_ticket || 0),
          treated_waste: treatedWasteTons,
          treated_waste_formatted: formatTons(treatedWasteTons),
          treated_waste_percentage: treatedWastePercentage,
          direct_waste: directWasteTons,
          direct_waste_formatted: formatTons(directWasteTons),
          direct_waste_percentage: directWastePercentage,
          date_range: {
            from: startDate,
            to: endDate,
            days: Math.ceil((new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60 * 24)) + 1,
          },
        },
        waste_categories: wasteCategories,
        per_sector: perSector,
        all_sectors: allSectorsRes.rows.map(s => ({
          sector_id: s.sector_id,
          sector_number: s.sector_number,
          sector_name: s.sector_name,
        })),
        monthly_evolution: monthlyEvolution,
        monthly_stats: monthlyStats,

        // NEW:
        monthly_evolution_sectors,
        monthly_sector_keys,
        monthly_evolution_codes,
        monthly_code_keys,

        top_operators: topOperators,
        recent_tickets: recentTickets,
        available_years: availableYears,
      },
      filters_applied: {
        year: currentYear,
        from: startDate,
        to: endDate,
        sector_id: requestedSectorNumber || 'all',
      },
    };

    if (debug) {
      console.log('✅ [LANDFILL] Response OK:', {
        total_tons: totalTons,
        total_tickets: response.data.summary.total_tickets,
        per_sector: response.data.per_sector.length,
        all_sectors: response.data.all_sectors.length,
        categories: response.data.waste_categories.length,
        monthly_points: response.data.monthly_evolution.length,
      });
    }

    return res.status(200).json(response);
  } catch (error) {
    console.error('❌ [LANDFILL] Error:', error);

    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message,
      details: process.env.NODE_ENV !== 'production' ? error.stack : undefined,
    });
  }
};

export default { getStats };
