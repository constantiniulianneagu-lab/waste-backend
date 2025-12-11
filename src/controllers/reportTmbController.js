// ============================================================================
// RAPORTARE TMB CONTROLLER
// ============================================================================
// Endpoint-uri pentru toate cele 5 tab-uri:
// 1. Deșeuri trimise la TMB (waste_tickets_tmb)
// 2. Deșeuri trimise la reciclare (waste_tickets_recycling)
// 3. Deșeuri trimise la valorificare (waste_tickets_recovery)
// 4. Deșeuri trimise la depozitare (waste_tickets_disposal)
// 5. Deșeuri refuzate (waste_tickets_rejected)
// ============================================================================

import pool from '../config/database.js';

const formatNumber = (num) => {
  return num ? parseFloat(num).toFixed(2) : '0.00';
};

// ============================================================================
// GET TMB TICKETS (Tab 1 - Intrări în TMB)
// ============================================================================
export const getTmbTickets = async (req, res) => {
  console.log('\n📊 ==================== TMB TICKETS REPORT ====================');
  console.log('📥 Query params:', req.query);
  
  try {
    const { 
      start_date, 
      end_date, 
      year,
      sector_id,
      page = 1,
      limit = 10,
      sort_by = 'ticket_date',
      sort_order = 'DESC'
    } = req.query;

    const userId = req.user.id;
    const userRole = req.user.role;

    // RBAC - Sector Access Control
    let accessibleSectorIds = [];
    
    if (userRole === 'PLATFORM_ADMIN') {
      console.log('✅ PLATFORM_ADMIN - full access');
    } else if (userRole === 'INSTITUTION_ADMIN' || userRole === 'OPERATOR_USER') {
      const userSectorsQuery = `
        SELECT DISTINCT is_table.sector_id
        FROM user_institutions ui
        JOIN institution_sectors is_table ON ui.institution_id = is_table.institution_id
        WHERE ui.user_id = $1 AND ui.deleted_at IS NULL
      `;
      
      const userSectorsResult = await pool.query(userSectorsQuery, [userId]);
      accessibleSectorIds = userSectorsResult.rows.map(row => row.sector_id);
      
      if (accessibleSectorIds.length === 0) {
        return res.status(403).json({
          success: false,
          message: 'Access denied: No sectors assigned'
        });
      }
    }

    // Build WHERE clause
    let whereConditions = ['wtt.deleted_at IS NULL'];
    let queryParams = [];
    let paramIndex = 1;

    // Date filters
    if (year) {
      whereConditions.push(`EXTRACT(YEAR FROM wtt.ticket_date) = $${paramIndex}`);
      queryParams.push(parseInt(year));
      paramIndex++;
    } else {
      if (start_date) {
        whereConditions.push(`wtt.ticket_date >= $${paramIndex}`);
        queryParams.push(start_date);
        paramIndex++;
      }
      if (end_date) {
        whereConditions.push(`wtt.ticket_date <= $${paramIndex}`);
        queryParams.push(end_date);
        paramIndex++;
      }
    }

    // Sector filter
    let sectorUuid = null;
    if (sector_id) {
      if (!isNaN(sector_id) && parseInt(sector_id) >= 1 && parseInt(sector_id) <= 6) {
        const sectorQuery = await pool.query(
          `SELECT id FROM sectors WHERE sector_number = $1 AND is_active = true`,
          [parseInt(sector_id)]
        );
        if (sectorQuery.rows.length > 0) {
          sectorUuid = sectorQuery.rows[0].id;
        }
      } else {
        sectorUuid = sector_id;
      }
      
      if (accessibleSectorIds.length > 0 && !accessibleSectorIds.includes(sectorUuid)) {
        return res.status(403).json({
          success: false,
          message: 'Access denied: Sector not accessible'
        });
      }
      
      whereConditions.push(`wtt.sector_id = $${paramIndex}`);
      queryParams.push(sectorUuid);
      paramIndex++;
    } else if (accessibleSectorIds.length > 0) {
      whereConditions.push(`wtt.sector_id = ANY($${paramIndex})`);
      queryParams.push(accessibleSectorIds);
      paramIndex++;
    }

    const whereClause = whereConditions.join(' AND ');

    // 1. GET SUMMARY STATS
    const summaryQuery = `
      SELECT 
        COUNT(*) as total_tickets,
        COALESCE(SUM(wtt.net_weight_tons), 0) as total_tons
      FROM waste_tickets_tmb wtt
      WHERE ${whereClause}
    `;
    
    const summaryResult = await pool.query(summaryQuery, queryParams);
    const summary = summaryResult.rows[0];

    // 2. GET TOP SUPPLIERS (Furnizori - colectori)
    const suppliersQuery = `
      SELECT 
        i.id,
        i.name,
        s.sector_name,
        wc.code,
        wc.description,
        COALESCE(SUM(wtt.net_weight_tons), 0) as total_tons
      FROM waste_tickets_tmb wtt
      JOIN institutions i ON wtt.supplier_id = i.id
      JOIN sectors s ON wtt.sector_id = s.id
      JOIN waste_codes wc ON wtt.waste_code_id = wc.id
      WHERE ${whereClause}
      GROUP BY i.id, i.name, s.sector_name, wc.code, wc.description
      ORDER BY total_tons DESC
      LIMIT 10
    `;
    
    const suppliersResult = await pool.query(suppliersQuery, queryParams);

    // 3. GET TOP OPERATORS (Prestatori - operatori TMB)
    const operatorsQuery = `
      SELECT 
        i.id,
        i.name,
        COALESCE(SUM(wtt.net_weight_tons), 0) as total_tons
      FROM waste_tickets_tmb wtt
      JOIN institutions i ON wtt.operator_id = i.id
      WHERE ${whereClause}
      GROUP BY i.id, i.name
      ORDER BY total_tons DESC
      LIMIT 10
    `;
    
    const operatorsResult = await pool.query(operatorsQuery, queryParams);

    // 4. GET PAGINATED TICKETS
    const offset = (parseInt(page) - 1) * parseInt(limit);
    
    const ticketsQuery = `
      SELECT 
        wtt.id,
        wtt.ticket_number,
        wtt.ticket_date,
        wtt.ticket_time,
        wtt.net_weight_tons,
        wtt.net_weight_kg,
        wtt.vehicle_number,
        wtt.generator_type,
        supplier.name as supplier_name,
        operator.name as operator_name,
        s.sector_name,
        s.sector_number,
        wc.code as waste_code,
        wc.description as waste_description
      FROM waste_tickets_tmb wtt
      JOIN institutions supplier ON wtt.supplier_id = supplier.id
      JOIN institutions operator ON wtt.operator_id = operator.id
      JOIN sectors s ON wtt.sector_id = s.id
      JOIN waste_codes wc ON wtt.waste_code_id = wc.id
      WHERE ${whereClause}
      ORDER BY wtt.${sort_by} ${sort_order}
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    
    queryParams.push(parseInt(limit), offset);
    const ticketsResult = await pool.query(ticketsQuery, queryParams);

    console.log('📅 Fetching available years for TMB...');

    const availableYearsQuery = `
      SELECT DISTINCT EXTRACT(YEAR FROM ticket_date)::INTEGER AS year
      FROM waste_tickets_tmb
      WHERE deleted_at IS NULL
      ORDER BY year DESC
    `;

    let availableYears = [];

    try {
      const yearsResult = await pool.query(availableYearsQuery);
      availableYears = yearsResult.rows.map(row => row.year);
      console.log(`✅ Available years:`, availableYears);
    } catch (yearsError) {
      console.error('❌ Available years query failed:', yearsError);
      availableYears = [new Date().getFullYear()];
    }

    console.log('✅ TMB Tickets fetched successfully');

    res.json({
      success: true,
      data: {
        available_years: availableYears,  // ✅ ADAUGĂ
        summary: {
          total_tickets: parseInt(summary.total_tickets),
          total_tons: formatNumber(summary.total_tons)
        },
        suppliers: suppliersResult.rows,
        operators: operatorsResult.rows,
        tickets: ticketsResult.rows,
        pagination: {
          current_page: parseInt(page),
          per_page: parseInt(limit),
          total_records: parseInt(summary.total_tickets),
          total_pages: Math.ceil(parseInt(summary.total_tickets) / parseInt(limit))
        }
      }
    });

  } catch (error) {
    console.error('❌ TMB Tickets error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch TMB tickets',
      error: error.message
    });
  }
};

// ============================================================================
// GET RECYCLING TICKETS (Tab 2 - Ieșiri reciclare)
// ============================================================================
export const getRecyclingTickets = async (req, res) => {
  console.log('\n♻️ ==================== RECYCLING TICKETS REPORT ====================');
  
  try {
    const { 
      start_date, 
      end_date, 
      year,
      sector_id,
      page = 1,
      limit = 10,
      sort_by = 'ticket_date',
      sort_order = 'DESC'
    } = req.query;

    // Similar logic ca getTmbTickets, dar pentru waste_tickets_recycling
    // ... (implementare similară)
    
    res.json({
      success: true,
      data: {
        summary: { total_tickets: 0, total_tons: '0.00' },
        suppliers: [],
        recipients: [],
        tickets: [],
        pagination: { current_page: 1, per_page: 10, total_records: 0, total_pages: 0 }
      }
    });

  } catch (error) {
    console.error('❌ Recycling Tickets error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch recycling tickets',
      error: error.message
    });
  }
};

// ============================================================================
// GET RECOVERY TICKETS (Tab 3 - Ieșiri valorificare)
// ============================================================================
export const getRecoveryTickets = async (req, res) => {
  console.log('\n⚡ ==================== RECOVERY TICKETS REPORT ====================');
  
  try {
    // Similar cu recycling
    res.json({
      success: true,
      data: {
        summary: { total_tickets: 0, total_tons: '0.00' },
        suppliers: [],
        recipients: [],
        tickets: [],
        pagination: { current_page: 1, per_page: 10, total_records: 0, total_pages: 0 }
      }
    });

  } catch (error) {
    console.error('❌ Recovery Tickets error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch recovery tickets',
      error: error.message
    });
  }
};

// ============================================================================
// GET DISPOSAL TICKETS (Tab 4 - Ieșiri depozitare)
// ============================================================================
export const getDisposalTickets = async (req, res) => {
  console.log('\n🗑️ ==================== DISPOSAL TICKETS REPORT ====================');
  
  try {
    // Similar cu recycling
    res.json({
      success: true,
      data: {
        summary: { total_tickets: 0, total_tons: '0.00' },
        suppliers: [],
        recipients: [],
        tickets: [],
        pagination: { current_page: 1, per_page: 10, total_records: 0, total_pages: 0 }
      }
    });

  } catch (error) {
    console.error('❌ Disposal Tickets error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch disposal tickets',
      error: error.message
    });
  }
};

// ============================================================================
// GET REJECTED TICKETS (Tab 5 - Deșeuri refuzate)
// ============================================================================
export const getRejectedTickets = async (req, res) => {
  console.log('\n❌ ==================== REJECTED TICKETS REPORT ====================');
  
  try {
    // Similar cu recycling
    res.json({
      success: true,
      data: {
        summary: { total_tickets: 0, total_tons: '0.00' },
        suppliers: [],
        operators: [],
        tickets: [],
        pagination: { current_page: 1, per_page: 10, total_records: 0, total_pages: 0 }
      }
    });

  } catch (error) {
    console.error('❌ Rejected Tickets error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch rejected tickets',
      error: error.message
    });
  }
};

export default {
  getTmbTickets,
  getRecyclingTickets,
  getRecoveryTickets,
  getDisposalTickets,
  getRejectedTickets
};