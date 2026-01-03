/**
 * ============================================================================
 * DASHBOARD LANDFILL CONTROLLER - FINAL (RBAC + SECTOR SCOPING)
 * ============================================================================
 *
 * ✅ GOALS (per cerință):
 * - NU mai calculează sectoare manual în controller (nu mai face RBAC aici).
 * - NU mai folosește roluri inexistente în DB (INSTITUTION_ADMIN / OPERATOR_USER etc.).
 * - NU mai folosește ui.deleted_at (nu există în schema ta).
 * - Folosește STRICT req.userAccess (setat de resolveUserAccess middleware).
 * - Filtrare pe sector_id UUID (waste_tickets_landfill.sector_id este UUID).
 * - Query param sector_id (1..6) este suportat (mapat la UUID din tabela sectors).
 * - Parametrizare SQL (fără string IN(...)).
 *
 * IMPORTANT:
 * - Acest controller presupune că pe rută ai: authenticateToken + resolveUserAccess
 *   Ex: router.get('/stats', authenticateToken, resolveUserAccess, getStats)
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
    '20 03 03': '#10B981',
    '17 09 04': '#EC4899',
    'ALTELE': '#06B6D4',
  };
  return colors[code] || '#F59E0B';
};

const getMonthName = (month) => {
  const months = ['Ian', 'Feb', 'Mar', 'Apr', 'Mai', 'Iun', 'Iul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return months[month - 1] || '';
};

const isoDate = (d) => new Date(d).toISOString().split('T')[0];

const assertValidDate = (dateStr, fieldName) => {
  // Acceptă YYYY-MM-DD; dacă e invalid, aruncă.
  if (!dateStr || typeof dateStr !== 'string') throw new Error(`Invalid ${fieldName}`);
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid ${fieldName}: ${dateStr}`);
  return dateStr;
};

/**
 * ============================================================================
 * MAIN
 * ============================================================================
 */
export const getStats = async (req, res) => {
  const debug = process.env.NODE_ENV !== 'production';

  if (debug) {
    console.log('\n🚀 [LANDFILL] /stats request');
    console.log('Query:', req.query);
    console.log('User:', { id: req.user?.id, role: req.user?.role });
    console.log('UserAccess:', req.userAccess);
  }

  try {
    const { year, from, to, sector_id } = req.query;

    // ----------------------------------------------------------------------
    // 1) Date range
    // ----------------------------------------------------------------------
    const now = new Date();
    const currentYear = year ? Number(year) : now.getFullYear();
    if (Number.isNaN(currentYear) || currentYear < 2000 || currentYear > 2100) {
      return res.status(400).json({ success: false, message: `Invalid year: ${year}` });
    }

    const startDate = assertValidDate(from || `${currentYear}-01-01`, 'from');
    const endDate = assertValidDate(to || isoDate(now), 'to');

    if (new Date(startDate) > new Date(endDate)) {
      return res.status(400).json({ success: false, message: '`from` must be <= `to`' });
    }

    // ----------------------------------------------------------------------
    // 2) Access from middleware
    // ----------------------------------------------------------------------
    const access = req.userAccess;
    if (!access) {
      return res.status(500).json({
        success: false,
        message: 'Missing userAccess on request (resolveUserAccess not applied).',
      });
    }

    const isAll = access.accessLevel === 'ALL';
    const allowedSectorUuids = Array.isArray(access.sectorIds) ? access.sectorIds : [];

    if (!isAll && allowedSectorUuids.length === 0) {
      return res.status(403).json({ success: false, message: 'Access denied: no sectors assigned' });
    }

    // ----------------------------------------------------------------------
    // 3) Optional filter: sector_id (1..6) -> sector UUID
    // ----------------------------------------------------------------------
    let requestedSectorNumber = null;
    let requestedSectorUuid = null;

    if (sector_id !== undefined && sector_id !== null && String(sector_id).trim() !== '') {
      requestedSectorNumber = parseInt(String(sector_id), 10);

      if (Number.isNaN(requestedSectorNumber) || requestedSectorNumber < 1 || requestedSectorNumber > 6) {
        return res.status(400).json({
          success: false,
          message: `Invalid sector_id: ${sector_id}. Must be between 1 and 6.`,
        });
      }

      const sectorQ = await db.query(
        `SELECT id, sector_number
         FROM sectors
         WHERE sector_number = $1 AND deleted_at IS NULL
         LIMIT 1`,
        [requestedSectorNumber]
      );

      if (sectorQ.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Sector inexistent' });
      }

      requestedSectorUuid = sectorQ.rows[0].id;
    }

    // RBAC enforcement for requested sector
    if (!isAll && requestedSectorUuid && !allowedSectorUuids.includes(requestedSectorUuid)) {
      return res.status(403).json({ success: false, message: 'Access denied: sector not accessible' });
    }

    // ----------------------------------------------------------------------
    // 4) Build WHERE sector filter (UUID, parametrizat)
    // ----------------------------------------------------------------------
    // paramsBase = [startDate, endDate, sectorFilterArg?]
    let sectorWhere = '';
    let paramsBase = [startDate, endDate];

    if (requestedSectorUuid) {
      sectorWhere = `AND wtl.sector_id = $3`;
      paramsBase = [startDate, endDate, requestedSectorUuid];
    } else if (!isAll) {
      sectorWhere = `AND wtl.sector_id = ANY($3)`;
      paramsBase = [startDate, endDate, allowedSectorUuids];
    }

    if (debug) {
      console.log('[LANDFILL] DateRange:', { startDate, endDate, currentYear });
      console.log('[LANDFILL] SectorFilter:', { requestedSectorNumber, requestedSectorUuid, isAll });
      console.log('[LANDFILL] paramsBase:', paramsBase);
      console.log('[LANDFILL] sectorWhere:', sectorWhere || 'NONE');
    }

    // Helper: prev period params (same sectorWhere)
    const prevStart = new Date(startDate);
    prevStart.setFullYear(prevStart.getFullYear() - 1);
    const prevEnd = new Date(endDate);
    prevEnd.setFullYear(prevEnd.getFullYear() - 1);

    let prevParamsBase = [isoDate(prevStart), isoDate(prevEnd)];
    if (requestedSectorUuid) prevParamsBase = [isoDate(prevStart), isoDate(prevEnd), requestedSectorUuid];
    else if (!isAll) prevParamsBase = [isoDate(prevStart), isoDate(prevEnd), allowedSectorUuids];

    // ----------------------------------------------------------------------
    // 5) SUMMARY
    // ----------------------------------------------------------------------
    const summaryQuery = `
      SELECT
        COUNT(*) as total_tickets,
        COALESCE(SUM(wtl.net_weight_tons), 0) as total_tons,
        COALESCE(AVG(wtl.net_weight_tons), 0) as avg_weight_per_ticket
      FROM waste_tickets_landfill wtl
      WHERE wtl.deleted_at IS NULL
        AND wtl.ticket_date >= $1
        AND wtl.ticket_date <= $2
        ${sectorWhere}
    `;

    const summaryRes = await db.query(summaryQuery, paramsBase);
    const summary = summaryRes.rows[0];
    const totalTons = Number(summary.total_tons || 0);

    // ----------------------------------------------------------------------
    // 6) WASTE CATEGORIES (Top 5)
    // ----------------------------------------------------------------------
    const categoriesQuery = `
      SELECT
        wc.code AS waste_code,
        wc.description AS waste_description,
        wc.category,
        COUNT(*) AS ticket_count,
        COALESCE(SUM(wtl.net_weight_tons), 0) AS total_tons
      FROM waste_tickets_landfill wtl
      JOIN waste_codes wc ON wtl.waste_code_id = wc.id
      WHERE wtl.deleted_at IS NULL
        AND wtl.ticket_date >= $1
        AND wtl.ticket_date <= $2
        ${sectorWhere}
      GROUP BY wc.code, wc.description, wc.category
      ORDER BY total_tons DESC
      LIMIT 5
    `;

    const categoriesRes = await db.query(categoriesQuery, paramsBase);
    const wasteCategories = categoriesRes.rows.map((r) => {
      const tons = Number(r.total_tons || 0);
      return {
        waste_code: r.waste_code,
        waste_description: r.waste_description,
        category: r.category,
        icon_color: getWasteCodeColor(r.waste_code),
        total_tons: tons,
        total_tons_formatted: formatTons(tons),
        percentage_of_total: totalTons > 0 ? Number(((tons / totalTons) * 100).toFixed(1)) : 0,
        ticket_count: Number(r.ticket_count || 0),
      };
    });

    // ----------------------------------------------------------------------
    // 7) PER SECTOR BREAKDOWN + YoY
    // ----------------------------------------------------------------------
    const perSectorQuery = `
      SELECT
        s.id as sector_id,
        s.sector_name,
        s.sector_number,
        COUNT(*) as ticket_count,
        COALESCE(SUM(wtl.net_weight_tons), 0) as total_tons
      FROM waste_tickets_landfill wtl
      JOIN sectors s ON wtl.sector_id = s.id
      WHERE wtl.deleted_at IS NULL
        AND wtl.ticket_date >= $1
        AND wtl.ticket_date <= $2
        ${sectorWhere}
      GROUP BY s.id, s.sector_name, s.sector_number
      ORDER BY s.sector_number
    `;

    const perSectorRes = await db.query(perSectorQuery, paramsBase);

    const prevYearSectorQuery = `
      SELECT
        s.id as sector_id,
        COALESCE(SUM(wtl.net_weight_tons), 0) as total_tons
      FROM waste_tickets_landfill wtl
      JOIN sectors s ON wtl.sector_id = s.id
      WHERE wtl.deleted_at IS NULL
        AND wtl.ticket_date >= $1
        AND wtl.ticket_date <= $2
        ${sectorWhere}
      GROUP BY s.id
    `;

    const prevYearSectorRes = await db.query(prevYearSectorQuery, prevParamsBase);
    const prevMap = Object.fromEntries(prevYearSectorRes.rows.map((r) => [r.sector_id, Number(r.total_tons || 0)]));

    const perSector = perSectorRes.rows.map((r) => {
      const currentTons = Number(r.total_tons || 0);
      const prevTons = prevMap[r.sector_id] || 0;
      const variation = prevTons > 0 ? Number((((currentTons - prevTons) / prevTons) * 100).toFixed(1)) : 0;

      return {
        sector_id: r.sector_id,
        sector_number: r.sector_number,
        sector_name: r.sector_name,
        city: 'București',
        icon_color: getSectorColor(r.sector_number),
        total_tons: currentTons,
        total_tons_formatted: formatTons(currentTons),
        ticket_count: Number(r.ticket_count || 0),
        percentage_of_total: totalTons > 0 ? Number(((currentTons / totalTons) * 100).toFixed(2)) : 0,
        variation_percent: variation,
        variation_direction: variation >= 0 ? 'up' : 'down',
      };
    });

    // ----------------------------------------------------------------------
    // 8) MONTHLY EVOLUTION + STATS + TRENDING vs prev period
    // ----------------------------------------------------------------------
    const monthlyQuery = `
      SELECT
        EXTRACT(YEAR FROM wtl.ticket_date)::INTEGER as year,
        EXTRACT(MONTH FROM wtl.ticket_date)::INTEGER as month,
        COALESCE(SUM(wtl.net_weight_tons), 0) as total_tons
      FROM waste_tickets_landfill wtl
      WHERE wtl.deleted_at IS NULL
        AND wtl.ticket_date >= $1
        AND wtl.ticket_date <= $2
        ${sectorWhere}
      GROUP BY 1,2
      ORDER BY 1,2
    `;

    const monthlyRes = await db.query(monthlyQuery, paramsBase);

    const monthlyEvolution = monthlyRes.rows.map((r) => ({
      month: getMonthName(r.month),
      year: r.year,
      total_tons: Number(r.total_tons || 0),
    }));

    const monthlyTotals = monthlyRes.rows.map((r) => Number(r.total_tons || 0));
    const maxMonthly = monthlyTotals.length ? Math.max(...monthlyTotals) : 0;
    const minMonthly = monthlyTotals.length ? Math.min(...monthlyTotals) : 0;
    const avgMonthly = monthlyTotals.length
      ? monthlyTotals.reduce((a, b) => a + b, 0) / monthlyTotals.length
      : 0;

    const maxIdx = monthlyTotals.indexOf(maxMonthly);
    const minIdx = monthlyTotals.indexOf(minMonthly);

    // Prev period total
    const prevTotalQuery = `
      SELECT COALESCE(SUM(wtl.net_weight_tons), 0) as total_tons
      FROM waste_tickets_landfill wtl
      WHERE wtl.deleted_at IS NULL
        AND wtl.ticket_date >= $1
        AND wtl.ticket_date <= $2
        ${sectorWhere}
    `;
    const prevTotalRes = await db.query(prevTotalQuery, prevParamsBase);
    const prevTotal = Number(prevTotalRes.rows[0]?.total_tons || 0);

    const trendingPercent = prevTotal > 0 ? Number((((totalTons - prevTotal) / prevTotal) * 100).toFixed(1)) : 0;

    const monthlyStats = {
      maximum: {
        value: maxMonthly,
        month: monthlyRes.rows[maxIdx]
          ? `${getMonthName(monthlyRes.rows[maxIdx].month)} ${monthlyRes.rows[maxIdx].year}`
          : 'N/A',
      },
      minimum: {
        value: minMonthly,
        month: monthlyRes.rows[minIdx]
          ? `${getMonthName(monthlyRes.rows[minIdx].month)} ${monthlyRes.rows[minIdx].year}`
          : 'N/A',
      },
      average_monthly: Number(avgMonthly.toFixed(2)),
      trending: {
        value: trendingPercent,
        direction: trendingPercent >= 0 ? 'up' : 'down',
        vs_period: String(currentYear - 1),
        current_period_total: totalTons,
        previous_period_total: prevTotal,
      },
    };

    // ----------------------------------------------------------------------
    // 9) TOP OPERATORS
    // ----------------------------------------------------------------------
    const operatorsQuery = `
      SELECT
        i.id as institution_id,
        i.name as institution_name,
        ARRAY_AGG(DISTINCT s.sector_number ORDER BY s.sector_number) as sector_numbers,
        COUNT(*) as ticket_count,
        COALESCE(SUM(wtl.net_weight_tons), 0) as total_tons
      FROM waste_tickets_landfill wtl
      JOIN institutions i ON wtl.supplier_id = i.id
      JOIN sectors s ON wtl.sector_id = s.id
      WHERE wtl.deleted_at IS NULL
        AND wtl.ticket_date >= $1
        AND wtl.ticket_date <= $2
        ${sectorWhere}
      GROUP BY i.id, i.name
      ORDER BY total_tons DESC
    `;

    const operatorsRes = await db.query(operatorsQuery, paramsBase);
    const topOperators = operatorsRes.rows.map((r) => {
      const tons = Number(r.total_tons || 0);
      const sectorNumbers = r.sector_numbers || [];
      return {
        institution_id: r.institution_id,
        institution_name: r.institution_name,
        sector_numbers: sectorNumbers,
        sector_numbers_display: sectorNumbers.join(', '),
        icon_color: getSectorColor(sectorNumbers[0]),
        total_tons: tons,
        total_tons_formatted: formatTons(tons),
        ticket_count: Number(r.ticket_count || 0),
        percentage_of_total: totalTons > 0 ? Number(((tons / totalTons) * 100).toFixed(1)) : 0,
      };
    });

    // ----------------------------------------------------------------------
    // 10) RECENT TICKETS
    // ----------------------------------------------------------------------
    const recentTicketsQuery = `
      SELECT
        wtl.id as ticket_id,
        wtl.ticket_number,
        wtl.ticket_date,
        wtl.vehicle_number,
        wtl.net_weight_tons,
        wtl.created_at,
        i.name as supplier_name,
        wc.code as waste_code,
        wc.description as waste_description,
        s.id as sector_id,
        s.sector_name,
        s.sector_number
      FROM waste_tickets_landfill wtl
      JOIN institutions i ON wtl.supplier_id = i.id
      JOIN waste_codes wc ON wtl.waste_code_id = wc.id
      JOIN sectors s ON wtl.sector_id = s.id
      WHERE wtl.deleted_at IS NULL
        AND wtl.ticket_date >= $1
        AND wtl.ticket_date <= $2
        ${sectorWhere}
      ORDER BY wtl.ticket_date DESC, wtl.created_at DESC
      LIMIT 50
    `;

    const recentRes = await db.query(recentTicketsQuery, paramsBase);
    const recentTickets = recentRes.rows.map((r) => {
      const tons = Number(r.net_weight_tons || 0);
      return {
        ticket_id: r.ticket_id,
        ticket_number: r.ticket_number,
        supplier_name: r.supplier_name,
        waste_code: r.waste_code,
        waste_description: r.waste_description,
        vehicle_number: r.vehicle_number,
        net_weight_tons: tons,
        net_weight_tons_formatted: formatTons(tons),
        ticket_date: r.ticket_date,
        created_at: r.created_at,
        sector_id: r.sector_id,
        sector_number: r.sector_number,
        sector_name: r.sector_name,
        icon_color: getSectorColor(r.sector_number),
      };
    });

    // ----------------------------------------------------------------------
    // 11) AVAILABLE YEARS (respectă RBAC!)
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
      FROM waste_tickets_landfill
      WHERE deleted_at IS NULL
        ${yearsWhere}
      ORDER BY year DESC
    `;
    const yearsRes = await db.query(yearsQuery, yearsParams);
    const availableYears = yearsRes.rows.map((r) => r.year);

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
          date_range: {
            from: startDate,
            to: endDate,
            days: Math.ceil((new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60 * 24)) + 1,
          },
        },
        waste_categories: wasteCategories,
        per_sector: perSector,
        monthly_evolution: monthlyEvolution,
        monthly_stats: monthlyStats,
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
        categories: response.data.waste_categories.length,
        operators: response.data.top_operators.length,
        recent: response.data.recent_tickets.length,
        years: response.data.available_years.length,
      });
    }

    return res.status(200).json(response);
  } catch (error) {
    console.error('❌ [LANDFILL] getStats error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message,
      details: process.env.NODE_ENV !== 'production' ? error.stack : undefined,
    });
  }
};

export default { getStats };