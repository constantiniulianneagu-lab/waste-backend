/**
 * ============================================================================
 * DASHBOARD LANDFILL CONTROLLER - FINAL DEBUG VERSION
 * ============================================================================
 * 
 * 🔧 CHANGES:
 * - Added extensive logging for debugging
 * - Fixed sector_id type conversion (string → integer)
 * - Added validation for all parameters
 * - Try-catch blocks for each query section
 * - Detailed error messages
 * 
 * Created: 2025-11-21
 * Updated: 2025-11-23 - Added complete debugging
 * ============================================================================
 */

import db from '../config/database.js';

/**
 * ============================================================================
 * HELPER FUNCTIONS
 * ============================================================================
 */

const formatTons = (num) => {
  if (!num) return '0.00';
  return num.toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const getSectorColor = (sectorNumber) => {
  const colors = {
    1: '#7C3AED', 2: '#E5E7EB', 3: '#10B981',
    4: '#F59E0B', 5: '#EC4899', 6: '#06B6D4',
  };
  return colors[sectorNumber] || '#6B7280';
};

const getWasteCodeColor = (category) => {
  const colors = {
    '20 03 01': '#7C3AED', '20 03 03': '#10B981',
    '19 * *': '#F59E0B', '17 09 04': '#EC4899',
    'ALTELE': '#06B6D4',
  };
  return colors[category] || '#6B7280';
};

const getMonthName = (month) => {
  const months = ['Ian', 'Feb', 'Mar', 'Apr', 'Mai', 'Iun', 'Iul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return months[month - 1] || '';
};

/**
 * ============================================================================
 * MAIN CONTROLLER FUNCTION
 * ============================================================================
 */

export const getStats = async (req, res) => {
  console.log('\n🚀 ==================== DASHBOARD STATS REQUEST ====================');
  console.log('📥 Query params received:', req.query);
  console.log('👤 User:', { id: req.user?.id, role: req.user?.role });
  
  try {
    const { year, from, to, sector_id } = req.query;
    const userId = req.user.id;
    const userRole = req.user.role;

    // ========================================================================
    // 🔧 STEP 1: PARAMETER VALIDATION & TYPE CONVERSION
    // ========================================================================
    
    console.log('\n📋 STEP 1: Parameter validation');
    
    // Convert sector_id to integer if present
    let sectorIdInt = null;
    if (sector_id !== undefined && sector_id !== null && sector_id !== '') {
      sectorIdInt = parseInt(sector_id, 10);
      console.log('🔍 sector_id conversion:', {
        original: sector_id,
        type: typeof sector_id,
        converted: sectorIdInt,
        isValid: !isNaN(sectorIdInt)
      });
      
      if (isNaN(sectorIdInt) || sectorIdInt < 1 || sectorIdInt > 6) {
        console.error('❌ Invalid sector_id:', sector_id);
        return res.status(400).json({
          success: false,
          message: `Invalid sector_id: ${sector_id}. Must be between 1 and 6.`
        });
      }
    } else {
      console.log('ℹ️ No sector_id provided, fetching all sectors');
    }

    // Date range setup
    const currentDate = new Date();
    const currentYear = year || currentDate.getFullYear();
    const startDate = from || `${currentYear}-01-01`;
    const endDate = to || currentDate.toISOString().split('T')[0];

    console.log('📅 Date range:', { currentYear, startDate, endDate });

    // ========================================================================
    // STEP 2: RBAC - BUILD SECTOR FILTER
    // ========================================================================
    
    console.log('\n🔐 STEP 2: RBAC check');
    
    let sectorFilter = '';
    let sectorParams = [];

    if (userRole === 'PLATFORM_ADMIN') {
      console.log('✅ PLATFORM_ADMIN - full access');
      if (sectorIdInt) {
        // 🔧 FIX: Filter by sector_number (INTEGER) not sector_id (UUID)
        sectorFilter = 'AND s.sector_number = $3';
        sectorParams = [sectorIdInt];
        console.log('🎯 Filtering by sector_number:', sectorIdInt);
      } else {
        console.log('🌐 Showing all sectors');
      }
    } else if (userRole === 'INSTITUTION_ADMIN' || userRole === 'OPERATOR_USER') {
      console.log('🔒 Restricted user, checking accessible sectors...');
      
      const userSectorsQuery = `
        SELECT DISTINCT is_table.sector_id
        FROM user_institutions ui
        JOIN institution_sectors is_table ON ui.institution_id = is_table.institution_id
        WHERE ui.user_id = $1 AND ui.deleted_at IS NULL
      `;
      
      try {
        const userSectorsResult = await db.query(userSectorsQuery, [userId]);
        const userSectorIds = userSectorsResult.rows.map(row => row.sector_id);
        
        console.log('📍 User accessible sectors:', userSectorIds);

        if (userSectorIds.length === 0) {
          console.error('❌ No sectors assigned to user');
          return res.status(403).json({
            success: false,
            message: 'Access denied: No sectors assigned'
          });
        }

        if (sectorIdInt) {
          if (!userSectorIds.includes(sectorIdInt)) {
            console.error('❌ User trying to access unauthorized sector:', sectorIdInt);
            return res.status(403).json({
              success: false,
              message: 'Access denied: Sector not accessible'
            });
          }
          // 🔧 FIX: Filter by sector_number (INTEGER) not sector_id (UUID)
          sectorFilter = 'AND s.sector_number = $3';
          sectorParams = [sectorIdInt];
        } else {
          // 🔧 FIX: Filter by sector_number for multiple sectors
          const userSectorNumbers = userSectorIds; // Assuming these are already sector_numbers
          sectorFilter = `AND s.sector_number = ANY($3)`;
          sectorParams = [userSectorNumbers];
        }
      } catch (rbacError) {
        console.error('❌ RBAC query error:', rbacError);
        throw new Error(`RBAC check failed: ${rbacError.message}`);
      }
    }

    const baseParams = [startDate, endDate, ...sectorParams];
    console.log('🔧 Base query params:', baseParams);
    console.log('🔧 Sector filter SQL:', sectorFilter || 'NONE');

    // ========================================================================
    // STEP 3: SUMMARY QUERY
    // ========================================================================
    
    console.log('\n📊 STEP 3: Fetching summary');
    
    const summaryQuery = `
      SELECT 
        COUNT(*) as total_tickets,
        COALESCE(SUM(wtl.net_weight_tons), 0) as total_tons,
        COALESCE(AVG(wtl.net_weight_tons), 0) as avg_weight_per_ticket
      FROM waste_tickets_landfill wtl
      JOIN sectors s ON wtl.sector_id = s.id
      WHERE wtl.deleted_at IS NULL
        AND wtl.ticket_date >= $1
        AND wtl.ticket_date <= $2
        ${sectorFilter}
    `;

    let summary, totalTons;
    
    try {
      console.log('🔍 Executing summary query...');
      const summaryResult = await db.query(summaryQuery, baseParams);
      summary = summaryResult.rows[0];
      totalTons = parseFloat(summary.total_tons);
      
      console.log('✅ Summary result:', {
        total_tickets: summary.total_tickets,
        total_tons: totalTons,
        avg_weight: summary.avg_weight_per_ticket
      });
    } catch (summaryError) {
      console.error('❌ Summary query failed:', summaryError);
      console.error('Query:', summaryQuery);
      console.error('Params:', baseParams);
      throw new Error(`Summary query failed: ${summaryError.message}`);
    }

    // ========================================================================
    // STEP 4: WASTE CATEGORIES
    // ========================================================================
    
    console.log('\n🗑️ STEP 4: Fetching waste categories');
    
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
      JOIN sectors s ON wtl.sector_id = s.id
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

    let wasteCategories;
    
    try {
      console.log('🔍 Executing categories query...');
      const categoriesResult = await db.query(categoriesQuery, baseParams);
      
      wasteCategories = categoriesResult.rows.map(row => ({
        waste_code: row.category,
        waste_description: row.description,
        icon_color: getWasteCodeColor(row.category),
        total_tons: parseFloat(row.total_tons),
        total_tons_formatted: formatTons(parseFloat(row.total_tons)),
        percentage_of_total: totalTons > 0 ? parseFloat(((parseFloat(row.total_tons) / totalTons) * 100).toFixed(1)) : 0,
        ticket_count: parseInt(row.ticket_count)
      }));
      
      console.log(`✅ Found ${wasteCategories.length} waste categories`);
    } catch (categoriesError) {
      console.error('❌ Categories query failed:', categoriesError);
      throw new Error(`Categories query failed: ${categoriesError.message}`);
    }

    // ========================================================================
    // STEP 5: PER SECTOR BREAKDOWN
    // ========================================================================
    
    console.log('\n🏙️ STEP 5: Fetching per sector data');
    
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

    let perSector;
    
    try {
      console.log('🔍 Executing per sector query...');
      const perSectorResult = await db.query(perSectorQuery, baseParams);
      
      // Previous year comparison
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

      perSector = perSectorResult.rows.map(row => {
        const currentTons = parseFloat(row.total_tons);
        const prevYearTons = prevYearSectorMap[row.sector_id] || 0;
        const variationPercent = prevYearTons > 0 
          ? parseFloat((((currentTons - prevYearTons) / prevYearTons) * 100).toFixed(1))
          : 0;

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
      
      console.log(`✅ Found ${perSector.length} sectors`);
    } catch (sectorError) {
      console.error('❌ Per sector query failed:', sectorError);
      throw new Error(`Per sector query failed: ${sectorError.message}`);
    }

    // ========================================================================
    // STEP 6: MONTHLY EVOLUTION
    // ========================================================================
    
    console.log('\n📈 STEP 6: Fetching monthly evolution');
    
    const monthlyQuery = `
      SELECT 
        EXTRACT(YEAR FROM wtl.ticket_date) as year,
        EXTRACT(MONTH FROM wtl.ticket_date) as month,
        COALESCE(SUM(wtl.net_weight_tons), 0) as total_tons
      FROM waste_tickets_landfill wtl
      JOIN sectors s ON wtl.sector_id = s.id
      WHERE wtl.deleted_at IS NULL
        AND wtl.ticket_date >= $1
        AND wtl.ticket_date <= $2
        ${sectorFilter}
      GROUP BY EXTRACT(YEAR FROM wtl.ticket_date), EXTRACT(MONTH FROM wtl.ticket_date)
      ORDER BY year, month
    `;

    let monthlyEvolution, monthlyStats;
    
    try {
      console.log('🔍 Executing monthly query...');
      const monthlyResult = await db.query(monthlyQuery, baseParams);

      monthlyEvolution = monthlyResult.rows.map(row => ({
        month: getMonthName(parseInt(row.month)),
        year: parseInt(row.year),
        total_tons: parseFloat(row.total_tons)
      }));

      // Calculate stats
      const monthlyTotals = monthlyResult.rows.map(r => parseFloat(r.total_tons));
      const maxMonthly = Math.max(...monthlyTotals, 0);
      const minMonthly = Math.min(...monthlyTotals, 0);
      const avgMonthly = monthlyTotals.length > 0 
        ? monthlyTotals.reduce((a, b) => a + b, 0) / monthlyTotals.length 
        : 0;

      const maxMonthIndex = monthlyTotals.indexOf(maxMonthly);
      const minMonthIndex = monthlyTotals.indexOf(minMonthly);

      // Previous year total
      const prevYearStart = new Date(startDate);
      prevYearStart.setFullYear(prevYearStart.getFullYear() - 1);
      const prevYearEnd = new Date(endDate);
      prevYearEnd.setFullYear(prevYearEnd.getFullYear() - 1);

      const prevYearParams = [
        prevYearStart.toISOString().split('T')[0],
        prevYearEnd.toISOString().split('T')[0],
        ...sectorParams
      ];

      const prevYearTotalQuery = `
        SELECT COALESCE(SUM(wtl.net_weight_tons), 0) as total_tons
        FROM waste_tickets_landfill wtl
        JOIN sectors s ON wtl.sector_id = s.id
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

      monthlyStats = {
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
      
      console.log(`✅ Found ${monthlyEvolution.length} months`);
    } catch (monthlyError) {
      console.error('❌ Monthly query failed:', monthlyError);
      throw new Error(`Monthly query failed: ${monthlyError.message}`);
    }

    // ========================================================================
    // STEP 7: TOP OPERATORS
    // ========================================================================
    
    console.log('\n👥 STEP 7: Fetching operators');
    
    const operatorsQuery = `
      SELECT 
        i.id as institution_id,
        i.name as institution_name,
        ARRAY_AGG(DISTINCT s.id ORDER BY s.id) as sector_ids,
        ARRAY_AGG(DISTINCT s.sector_name ORDER BY s.sector_name) as sector_names,
        ARRAY_AGG(DISTINCT s.sector_number ORDER BY s.sector_number) as sector_numbers,
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

    let topOperators;
    
    try {
      console.log('🔍 Executing operators query...');
      const operatorsResult = await db.query(operatorsQuery, baseParams);

      topOperators = operatorsResult.rows.map(row => {
        const sectorIds = row.sector_ids || [];
        const sectorNumbers = row.sector_numbers || sectorIds;
        const currentTons = parseFloat(row.total_tons);

        return {
          institution_id: row.institution_id,
          institution_name: row.institution_name,
          sectors: sectorIds,
          sector_numbers: sectorNumbers,
          sector_numbers_display: sectorNumbers.join(', '),
          icon_color: getSectorColor(sectorNumbers[0]),
          total_tons: currentTons,
          total_tons_formatted: formatTons(currentTons),
          ticket_count: parseInt(row.ticket_count),
          percentage_of_total: totalTons > 0 ? parseFloat(((currentTons / totalTons) * 100).toFixed(1)) : 0
        };
      });
      
      console.log(`✅ Found ${topOperators.length} operators`);
    } catch (operatorsError) {
      console.error('❌ Operators query failed:', operatorsError);
      throw new Error(`Operators query failed: ${operatorsError.message}`);
    }

    // ========================================================================
    // STEP 8: RECENT TICKETS
    // ========================================================================
    
    console.log('\n🎫 STEP 8: Fetching recent tickets');
    
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

    let recentTickets;
    
    try {
      console.log('🔍 Executing recent tickets query...');
      const recentTicketsResult = await db.query(recentTicketsQuery, baseParams);

      recentTickets = recentTicketsResult.rows.map(row => {
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
      
      console.log(`✅ Found ${recentTickets.length} recent tickets`);
    } catch (ticketsError) {
      console.error('❌ Recent tickets query failed:', ticketsError);
      throw new Error(`Recent tickets query failed: ${ticketsError.message}`);
    }

    // ========================================================================
    // STEP 9: BUILD RESPONSE
    // ========================================================================
    
    console.log('\n📦 STEP 9: Building response');
    
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
        sector_id: sectorIdInt || 'all'
      }
    };

    console.log('✅ Response built successfully');
    console.log('==================== REQUEST COMPLETE ====================\n');
    
    return res.status(200).json(response);

  } catch (error) {
    console.error('\n❌ ==================== ERROR ====================');
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    console.error('==================== ERROR END ====================\n');
    
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
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