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
    // Check if user has access to landfill page
    const { scopes } = req.userAccess;
    if (scopes?.landfill === 'NONE') {
      return res.status(403).json({ 
        success: false, 
        message: 'Nu aveți permisiune să accesați pagina Depozitare' 
      });
    }

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
    const allowedSectorUuids = Array.isArray(access.visibleSectorIds) ? access.visibleSectorIds : [];

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

    // Helper: prev period params
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
        COUNT(*) as ticket_count,
        COALESCE(SUM(wtl.net_weight_tons), 0) as total_tons
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
        ticket_count: Number(r.ticket_count || 0),
        total_tons: tons,
        total_tons_formatted: formatTons(tons),
        percentage_of_total: totalTons > 0 ? Number(((tons / totalTons) * 100).toFixed(1)) : 0,
        color: getWasteCodeColor(r.waste_code),
      };
    });

    // ----------------------------------------------------------------------
    // 7) ✅ FIX #2: ALL SECTORS (pentru dropdown) + PER SECTOR DATA
    // ----------------------------------------------------------------------
    
    // 7a) Toate sectoarele accesibile (pentru dropdown)
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
    const allSectorsRes = await db.query(allSectorsQuery, allSectorsParams);
    
    // 7b) Date per sector (doar cele cu tichete)
    const sectorQuery = `
      SELECT
        s.id AS sector_id,
        s.sector_number,
        s.sector_name,
        COUNT(wtl.id) AS total_tickets,
        COALESCE(SUM(wtl.net_weight_tons), 0) AS total_tons
      FROM sectors s
      LEFT JOIN waste_tickets_landfill wtl 
        ON wtl.sector_id = s.id 
        AND wtl.deleted_at IS NULL
        AND wtl.ticket_date >= $1
        AND wtl.ticket_date <= $2
      WHERE s.is_active = true 
        AND s.deleted_at IS NULL
        ${!isAll ? 'AND s.id = ANY($3)' : ''}
      GROUP BY s.id, s.sector_number, s.sector_name
      ORDER BY s.sector_number
    `;

    const sectorParams = !isAll 
      ? [startDate, endDate, allowedSectorUuids]
      : [startDate, endDate];

    const sectorRes = await db.query(sectorQuery, sectorParams);

    // ========================================================================
    // CALCULATE VARIATION vs LAST YEAR (SAME PERIOD)
    // ========================================================================
    // Pentru a calcula variația, trebuie să obținem datele din anul precedent pentru aceeași perioadă
    const lastYearStartDate = new Date(startDate);
    lastYearStartDate.setFullYear(lastYearStartDate.getFullYear() - 1);
    const lastYearEndDate = new Date(endDate);
    lastYearEndDate.setFullYear(lastYearEndDate.getFullYear() - 1);

    const lastYearSectorQuery = `
      SELECT 
        s.id AS sector_id,
        COALESCE(SUM(wtl.net_weight_tons), 0) AS total_tons
      FROM sectors s
      LEFT JOIN waste_tickets_landfill wtl 
        ON s.id = wtl.sector_id 
        AND wtl.deleted_at IS NULL
        AND wtl.ticket_date >= $1 
        AND wtl.ticket_date <= $2
      WHERE s.deleted_at IS NULL
        ${!isAll ? 'AND s.id = ANY($3)' : ''}
      GROUP BY s.id
    `;

    const lastYearParams = !isAll
      ? [isoDate(lastYearStartDate), isoDate(lastYearEndDate), allowedSectorUuids]
      : [isoDate(lastYearStartDate), isoDate(lastYearEndDate)];

    const lastYearSectorRes = await db.query(lastYearSectorQuery, lastYearParams);

    // Merge: toate sectoarele cu datele lor
    const perSector = allSectorsRes.rows.map(sector => {
      const data = sectorRes.rows.find(s => s.sector_id === sector.sector_id);
      const tons = Number(data?.total_tons || 0);
      
      // Get last year data
      const lastYearData = lastYearSectorRes.rows.find(s => s.sector_id === sector.sector_id);
      const lastYearTons = Number(lastYearData?.total_tons || 0);
      
      // Calculate variation percentage
      let variation_pct = 0;
      if (lastYearTons > 0) {
        variation_pct = ((tons - lastYearTons) / lastYearTons) * 100;
      } else if (tons > 0) {
        variation_pct = 100; // Dacă anul trecut era 0 și acum avem date = +100%
      }
      
      return {
        sector_id: sector.sector_id,
        sector_number: sector.sector_number,
        sector_name: sector.sector_name,
        total_tickets: Number(data?.total_tickets || 0),
        total_tons: tons,
        total_tons_formatted: formatTons(tons),
        percentage_of_total: totalTons > 0 ? Number(((tons / totalTons) * 100).toFixed(1)) : 0,
        color: getSectorColor(sector.sector_number),
        variation_pct: Number(variation_pct.toFixed(1)),
        last_year_tons: lastYearTons,
      };
    });

    // ----------------------------------------------------------------------
    // 8) MONTHLY EVOLUTION
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
    // 11) ✅ FIX #1: AVAILABLE YEARS (include current + min 3 years)
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
    let availableYears = yearsRes.rows.map((r) => r.year);

    // ✅ Asigură anul curent este în listă
    const currentYearInt = new Date().getFullYear();
    if (!availableYears.includes(currentYearInt)) {
      availableYears.unshift(currentYearInt);
    }

    // ✅ Asigură minimum 3 ani
    const minYears = 3;
    while (availableYears.length < minYears) {
      const lastYear = availableYears[availableYears.length - 1] || currentYearInt;
      availableYears.push(lastYear - 1);
    }

    // ✅ Sortează descrescător
    availableYears.sort((a, b) => b - a);

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
        all_sectors: allSectorsRes.rows.map(s => ({  // ✅ Pentru dropdown
          sector_id: s.sector_id,
          sector_number: s.sector_number,
          sector_name: s.sector_name,
        })),
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
        all_sectors: response.data.all_sectors.length,
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