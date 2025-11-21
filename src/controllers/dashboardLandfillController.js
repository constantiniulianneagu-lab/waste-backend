/**
 * ============================================================================
 * DASHBOARD LANDFILL CONTROLLER
 * ============================================================================
 * 
 * Endpoint: GET /api/dashboard/landfill/stats
 * 
 * Provides comprehensive statistics for landfill dashboard:
 * - Summary totals
 * - Waste categories breakdown (with ALTELE and 19 * * aggregation)
 * - Per sector analysis (with year-over-year variation)
 * - Monthly evolution (with trending vs previous year)
 * - All operators list (sorted by volume)
 * - Recent 50 tickets
 * 
 * Query Filters:
 * - ?year=2025
 * - ?from=2025-01-01
 * - ?to=2025-11-21 (default: current date)
 * - ?sector_id=1
 * 
 * RBAC:
 * - PLATFORM_ADMIN: All sectors
 * - INSTITUTION_ADMIN: Only their sectors
 * - OPERATOR_USER: Only their institution
 * 
 * Created: 2025-11-21
 * ============================================================================
 */

import db from '../config/database.js';

/**
 * ============================================================================
 * HELPER FUNCTIONS
 * ============================================================================
 */

/**
 * Format number to Romanian format with comma separator
 * @param {number} num - Number to format
 * @returns {string} - Formatted number (ex: "207,778.50")
 */
const formatTons = (num) => {
  if (!num) return '0.00';
  return num.toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

/**
 * Get sector color by sector number
 * @param {number} sectorNumber - Sector number (1-6)
 * @returns {string} - Hex color code
 */
const getSectorColor = (sectorNumber) => {
  const colors = {
    1: '#7C3AED', // violet
    2: '#E5E7EB', // gray
    3: '#10B981', // green
    4: '#F59E0B', // orange
    5: '#EC4899', // pink
    6: '#06B6D4', // cyan
  };
  return colors[sectorNumber] || '#6B7280';
};

/**
 * Get waste code category color
 * @param {string} category - Waste code or category
 * @returns {string} - Hex color code
 */
const getWasteCodeColor = (category) => {
  const colors = {
    '20 03 01': '#7C3AED', // violet
    '20 03 03': '#10B981', // green
    '19 * *': '#F59E0B',   // orange
    '17 09 04': '#EC4899', // pink
    'ALTELE': '#06B6D4',   // cyan
  };
  return colors[category] || '#6B7280';
};

/**
 * Get month name in Romanian
 * @param {number} month - Month number (1-12)
 * @returns {string} - Month name (ex: "Ian", "Feb")
 */
const getMonthName = (month) => {
  const months = ['Ian', 'Feb', 'Mar', 'Apr', 'Mai', 'Iun', 'Iul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return months[month - 1] || '';
};

/**
 * ============================================================================
 * MAIN CONTROLLER FUNCTION
 * ============================================================================
 */

/**
 * GET /api/dashboard/landfill/stats
 * Get comprehensive landfill statistics
 */
export const getStats = async (req, res) => {
  try {
    const { year, from, to, sector_id } = req.query;
    const userId = req.user.id;
    const userRole = req.user.role;

    // ========================================================================
    // STEP 1: BUILD BASE FILTERS
    // ========================================================================
    
    // Default date range: current year, from Jan 1 to current date
    const currentDate = new Date();
    const currentYear = year || currentDate.getFullYear();
    const startDate = from || `${currentYear}-01-01`;
    const endDate = to || currentDate.toISOString().split('T')[0]; // Default: today

    // RBAC: Determine accessible sectors
    let sectorFilter = '';
    let sectorParams = [];

    if (userRole === 'PLATFORM_ADMIN') {
      // Platform admin sees all sectors
      if (sector_id) {
        sectorFilter = 'AND wtl.sector_id = $4';
        sectorParams = [sector_id];
      }
    } else if (userRole === 'INSTITUTION_ADMIN' || userRole === 'OPERATOR_USER') {
      // Get user's accessible sectors
      const userSectorsQuery = `
        SELECT DISTINCT is_table.sector_id
        FROM user_institutions ui
        JOIN institution_sectors is_table ON ui.institution_id = is_table.institution_id
        WHERE ui.user_id = $1 AND ui.deleted_at IS NULL
      `;
      const userSectorsResult = await db.query(userSectorsQuery, [userId]);
      const userSectorIds = userSectorsResult.rows.map(row => row.sector_id);

      if (userSectorIds.length === 0) {
        return res.status(403).json({
          success: false,
          message: 'Access denied: No sectors assigned'
        });
      }

      if (sector_id) {
        // Check if requested sector is accessible
        if (!userSectorIds.includes(parseInt(sector_id))) {
          return res.status(403).json({
            success: false,
            message: 'Access denied: Sector not accessible'
          });
        }
        sectorFilter = 'AND wtl.sector_id = $4';
        sectorParams = [sector_id];
      } else {
        sectorFilter = `AND wtl.sector_id = ANY($4)`;
        sectorParams = [userSectorIds];
      }
    }

    const baseParams = [startDate, endDate, ...sectorParams];

    // ========================================================================
    // STEP 2: GET SUMMARY TOTALS
    // ========================================================================
    
    const summaryQuery = `
      SELECT 
        COUNT(*) as total_tickets,
        COALESCE(SUM(wtl.net_weight_tons), 0) as total_tons,
        COALESCE(AVG(wtl.net_weight_tons), 0) as avg_weight_per_ticket
      FROM waste_tickets_landfill wtl
      WHERE wtl.deleted_at IS NULL
        AND wtl.ticket_date >= $1
        AND wtl.ticket_date <= $2
        ${sectorFilter}
    `;

    const summaryResult = await db.query(summaryQuery, baseParams);
    const summary = summaryResult.rows[0];

    const totalTons = parseFloat(summary.total_tons);

    // ========================================================================
    // STEP 3: GET WASTE CATEGORIES BREAKDOWN
    // ========================================================================
    
    // Get totals for each main category
    const categoriesQuery = `
      SELECT 
        CASE 
          WHEN wc.code = '20 03 01' THEN '20 03 01'
          WHEN wc.code = '20 03 03' THEN '20 03 03'
          WHEN wc.code LIKE '19%' THEN '19 * *'
          WHEN wc.code = '17 09 04' THEN '17 09 04'
          ELSE 'ALTELE'
        END as category,
        CASE 
          WHEN wc.code = '20 03 01' THEN 'Deșeuri municipale'
          WHEN wc.code = '20 03 03' THEN 'Reziduuri străzi'
          WHEN wc.code LIKE '19%' THEN 'Deșeuri de sortare'
          WHEN wc.code = '17 09 04' THEN 'Construcții'
          ELSE 'Altele'
        END as description,
        COUNT(*) as ticket_count,
        COALESCE(SUM(wtl.net_weight_tons), 0) as total_tons
      FROM waste_tickets_landfill wtl
      JOIN waste_codes wc ON wtl.waste_code_id = wc.id
      WHERE wtl.deleted_at IS NULL
        AND wtl.ticket_date >= $1
        AND wtl.ticket_date <= $2
        ${sectorFilter}
      GROUP BY 
        CASE 
          WHEN wc.code = '20 03 01' THEN '20 03 01'
          WHEN wc.code = '20 03 03' THEN '20 03 03'
          WHEN wc.code LIKE '19%' THEN '19 * *'
          WHEN wc.code = '17 09 04' THEN '17 09 04'
          ELSE 'ALTELE'
        END,
        CASE 
          WHEN wc.code = '20 03 01' THEN 'Deșeuri municipale'
          WHEN wc.code = '20 03 03' THEN 'Reziduuri străzi'
          WHEN wc.code LIKE '19%' THEN 'Deșeuri de sortare'
          WHEN wc.code = '17 09 04' THEN 'Construcții'
          ELSE 'Altele'
        END
      ORDER BY total_tons DESC
    `;

    const categoriesResult = await db.query(categoriesQuery, baseParams);
    
    const wasteCategories = categoriesResult.rows.map(row => ({
      waste_code: row.category,
      waste_description: row.description,
      icon_color: getWasteCodeColor(row.category),
      total_tons: parseFloat(row.total_tons),
      total_tons_formatted: formatTons(parseFloat(row.total_tons)),
      percentage_of_total: totalTons > 0 ? parseFloat(((parseFloat(row.total_tons) / totalTons) * 100).toFixed(1)) : 0,
      ticket_count: parseInt(row.ticket_count)
    }));

    // ========================================================================
    // STEP 4: GET PER SECTOR BREAKDOWN (with YoY variation)
    // ========================================================================
    
    // Current period per sector
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
        ${sectorFilter}
      GROUP BY s.id, s.sector_name, s.sector_number
      ORDER BY s.id
    `;

    const perSectorResult = await db.query(perSectorQuery, baseParams);

    // Previous year same period for comparison
    const prevYearStart = new Date(startDate);
    prevYearStart.setFullYear(prevYearStart.getFullYear() - 1);
    const prevYearEnd = new Date(endDate);
    prevYearEnd.setFullYear(prevYearEnd.getFullYear() - 1);

    const prevYearParams = [
      prevYearStart.toISOString().split('T')[0],
      prevYearEnd.toISOString().split('T')[0],
      ...sectorParams
    ];

    const prevYearSectorQuery = `
      SELECT 
        s.id as sector_id,
        COALESCE(SUM(wtl.net_weight_tons), 0) as total_tons
      FROM waste_tickets_landfill wtl
      JOIN sectors s ON wtl.sector_id = s.id
      WHERE wtl.deleted_at IS NULL
        AND wtl.ticket_date >= $1
        AND wtl.ticket_date <= $2
        ${sectorFilter}
      GROUP BY s.id
    `;

    const prevYearSectorResult = await db.query(prevYearSectorQuery, prevYearParams);
    const prevYearSectorMap = {};
    prevYearSectorResult.rows.forEach(row => {
      prevYearSectorMap[row.sector_id] = parseFloat(row.total_tons);
    });

    const perSector = perSectorResult.rows.map(row => {
      const currentTons = parseFloat(row.total_tons);
      const prevYearTons = prevYearSectorMap[row.sector_id] || 0;
      const variationPercent = prevYearTons > 0 
        ? parseFloat((((currentTons - prevYearTons) / prevYearTons) * 100).toFixed(1))
        : 0;

      // Use sector_number directly from database
      const sectorNumber = row.sector_number || row.sector_id;

      return {
        sector_id: row.sector_id,
        sector_number: sectorNumber,
        sector_name: row.sector_name,
        city: 'București',
        icon_color: getSectorColor(sectorNumber),
        total_tons: currentTons,
        total_tons_formatted: formatTons(currentTons),
        ticket_count: parseInt(row.ticket_count),
        percentage_of_total: totalTons > 0 ? parseFloat(((currentTons / totalTons) * 100).toFixed(2)) : 0,
        variation_percent: variationPercent,
        variation_direction: variationPercent >= 0 ? 'up' : 'down'
      };
    });

    // ========================================================================
    // STEP 5: GET MONTHLY EVOLUTION
    // ========================================================================
    
    const monthlyQuery = `
      SELECT 
        EXTRACT(YEAR FROM wtl.ticket_date) as year,
        EXTRACT(MONTH FROM wtl.ticket_date) as month,
        COALESCE(SUM(wtl.net_weight_tons), 0) as total_tons
      FROM waste_tickets_landfill wtl
      WHERE wtl.deleted_at IS NULL
        AND wtl.ticket_date >= $1
        AND wtl.ticket_date <= $2
        ${sectorFilter}
      GROUP BY EXTRACT(YEAR FROM wtl.ticket_date), EXTRACT(MONTH FROM wtl.ticket_date)
      ORDER BY year, month
    `;

    const monthlyResult = await db.query(monthlyQuery, baseParams);

    const monthlyEvolution = monthlyResult.rows.map(row => ({
      month: getMonthName(parseInt(row.month)),
      year: parseInt(row.year),
      total_tons: parseFloat(row.total_tons)
    }));

    // Calculate monthly stats
    const monthlyTotals = monthlyResult.rows.map(r => parseFloat(r.total_tons));
    const maxMonthly = Math.max(...monthlyTotals, 0);
    const minMonthly = Math.min(...monthlyTotals, 0);
    const avgMonthly = monthlyTotals.length > 0 
      ? monthlyTotals.reduce((a, b) => a + b, 0) / monthlyTotals.length 
      : 0;

    const maxMonthIndex = monthlyTotals.indexOf(maxMonthly);
    const minMonthIndex = monthlyTotals.indexOf(minMonthly);

    // Get previous year total for trending
    const prevYearTotalQuery = `
      SELECT COALESCE(SUM(wtl.net_weight_tons), 0) as total_tons
      FROM waste_tickets_landfill wtl
      WHERE wtl.deleted_at IS NULL
        AND wtl.ticket_date >= $1
        AND wtl.ticket_date <= $2
        ${sectorFilter}
    `;

    const prevYearTotalResult = await db.query(prevYearTotalQuery, prevYearParams);
    const prevYearTotal = parseFloat(prevYearTotalResult.rows[0].total_tons);

    const trendingPercent = prevYearTotal > 0 
      ? parseFloat((((totalTons - prevYearTotal) / prevYearTotal) * 100).toFixed(1))
      : 0;

    const monthlyStats = {
      maximum: {
        value: maxMonthly,
        month: monthlyResult.rows[maxMonthIndex] 
          ? `${getMonthName(parseInt(monthlyResult.rows[maxMonthIndex].month))} ${monthlyResult.rows[maxMonthIndex].year}`
          : 'N/A'
      },
      minimum: {
        value: minMonthly,
        month: monthlyResult.rows[minMonthIndex]
          ? `${getMonthName(parseInt(monthlyResult.rows[minMonthIndex].month))} ${monthlyResult.rows[minMonthIndex].year}`
          : 'N/A'
      },
      average_monthly: parseFloat(avgMonthly.toFixed(2)),
      trending: {
        value: trendingPercent,
        direction: trendingPercent >= 0 ? 'up' : 'down',
        vs_period: (parseInt(currentYear) - 1).toString(),
        current_period_total: totalTons,
        previous_period_total: prevYearTotal
      }
    };

    // ========================================================================
    // STEP 6: GET ALL OPERATORS (sorted by volume)
    // ========================================================================
    
    const operatorsQuery = `
      SELECT 
        i.id as institution_id,
        i.name as institution_name,
        ARRAY_AGG(DISTINCT s.id ORDER BY s.id) as sector_ids,
        ARRAY_AGG(DISTINCT s.sector_name ORDER BY s.id) as sector_names,
        ARRAY_AGG(DISTINCT s.sector_number ORDER BY s.id) as sector_numbers,
        COUNT(*) as ticket_count,
        COALESCE(SUM(wtl.net_weight_tons), 0) as total_tons
      FROM waste_tickets_landfill wtl
      JOIN institutions i ON wtl.supplier_id = i.id
      JOIN sectors s ON wtl.sector_id = s.id
      WHERE wtl.deleted_at IS NULL
        AND wtl.ticket_date >= $1
        AND wtl.ticket_date <= $2
        ${sectorFilter}
      GROUP BY i.id, i.name
      ORDER BY total_tons DESC
    `;

    const operatorsResult = await db.query(operatorsQuery, baseParams);

    const topOperators = operatorsResult.rows.map(row => {
      const sectorIds = row.sector_ids || [];
      const sectorNumbers = row.sector_numbers || sectorIds; // Use sector_numbers from DB

      const currentTons = parseFloat(row.total_tons);

      return {
        institution_id: row.institution_id,
        institution_name: row.institution_name,
        sectors: sectorIds,
        sector_numbers: sectorNumbers,
        sector_numbers_display: sectorNumbers.join(', '),
        icon_color: getSectorColor(sectorNumbers[0]), // Use first sector color
        total_tons: currentTons,
        total_tons_formatted: formatTons(currentTons),
        ticket_count: parseInt(row.ticket_count),
        percentage_of_total: totalTons > 0 ? parseFloat(((currentTons / totalTons) * 100).toFixed(1)) : 0
      };
    });

    // ========================================================================
    // STEP 7: GET RECENT 50 TICKETS
    // ========================================================================
    
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
        ${sectorFilter}
      ORDER BY wtl.ticket_date DESC, wtl.created_at DESC
      LIMIT 50
    `;

    const recentTicketsResult = await db.query(recentTicketsQuery, baseParams);

    const recentTickets = recentTicketsResult.rows.map(row => {
      const sectorNumber = row.sector_number || row.sector_id;

      return {
        ticket_id: row.ticket_id,
        ticket_number: row.ticket_number,
        supplier_name: row.supplier_name,
        waste_code: row.waste_code,
        waste_description: row.waste_description,
        vehicle_number: row.vehicle_number,
        net_weight_tons: parseFloat(row.net_weight_tons),
        net_weight_tons_formatted: formatTons(parseFloat(row.net_weight_tons)),
        ticket_date: row.ticket_date,
        created_at: row.created_at,
        sector_id: row.sector_id,
        sector_number: sectorNumber,
        sector_name: row.sector_name,
        icon_color: getSectorColor(sectorNumber)
      };
    });

    // ========================================================================
    // STEP 8: BUILD FINAL RESPONSE
    // ========================================================================
    
    const response = {
      success: true,
      data: {
        summary: {
          total_tons: totalTons,
          total_tons_formatted: formatTons(totalTons),
          total_tickets: parseInt(summary.total_tickets),
          avg_weight_per_ticket: parseFloat(summary.avg_weight_per_ticket),
          date_range: {
            from: startDate,
            to: endDate,
            days: Math.ceil((new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60 * 24)) + 1
          }
        },
        waste_categories: wasteCategories,
        per_sector: perSector,
        monthly_evolution: monthlyEvolution,
        monthly_stats: monthlyStats,
        top_operators: topOperators,
        recent_tickets: recentTickets
      },
      filters_applied: {
        year: currentYear,
        from: startDate,
        to: endDate,
        sector_id: sector_id || 'all'
      }
    };

    return res.status(200).json(response);

  } catch (error) {
    console.error('❌ Error in getStats:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

/**
 * ============================================================================
 * EXPORTS
 * ============================================================================
 */

export default {
  getStats
};