/**
 * ============================================================================
 * REPORTS LANDFILL CONTROLLER - FIXED FOR SUPABASE
 * ============================================================================
 * 
 * Controller pentru rapoarte detaliate depozitare
 * Corect pentru structura reală din Supabase
 * 
 * Created: 2025-11-26
 * Updated: 2025-11-26 - Fixed for actual DB schema
 * ============================================================================
 */

import db from '../config/database.js';

/**
 * ============================================================================
 * HELPER FUNCTIONS
 * ============================================================================
 */

const formatNumber = (num) => {
  if (!num) return '0.00';
  return parseFloat(num).toFixed(2);
};

/**
 * ============================================================================
 * GET LANDFILL REPORTS
 * ============================================================================
 * Query params:
 * - year: number (optional)
 * - from: date (YYYY-MM-DD)
 * - to: date (YYYY-MM-DD)
 * - sector_id: UUID (optional)
 * - page: number (default: 1)
 * - per_page: number (default: 20)
 * ============================================================================
 */

export const getLandfillReports = async (req, res) => {
  console.log('\n📊 ==================== LANDFILL REPORTS REQUEST ====================');
  console.log('📥 Query params:', req.query);
  console.log('👤 User:', { id: req.user?.id, role: req.user?.role });

  try {
    const { year, from, to, sector_id, page = 1, per_page = 20 } = req.query;
    const userId = req.user.id;
    const userRole = req.user.role;

    // ========================================================================
    // STEP 1: DATE RANGE SETUP
    // ========================================================================
    
    const currentDate = new Date();
    const currentYear = year || currentDate.getFullYear();
    const startDate = from || `${currentYear}-01-01`;
    const endDate = to || currentDate.toISOString().split('T')[0];

    console.log('📅 Date range:', { startDate, endDate });

    // ========================================================================
    // STEP 2: RBAC - SECTOR FILTERING
    // ========================================================================

    let sectorFilter = '';
    let sectorParams = [];
    let sectorName = 'București'; // Default

    if (userRole === 'PLATFORM_ADMIN') {
      console.log('✅ PLATFORM_ADMIN - full access');
      
      if (sector_id) {
        sectorFilter = 'AND wtl.sector_id = $3';
        sectorParams = [sector_id];
        
        // Get sector name
        const sectorQuery = 'SELECT name FROM sectors WHERE id = $1';
        const sectorResult = await db.query(sectorQuery, [sector_id]);
        if (sectorResult.rows.length > 0) {
          sectorName = sectorResult.rows[0].name;
        }
      }
    } else if (userRole === 'INSTITUTION_ADMIN' || userRole === 'OPERATOR_USER') {
      console.log('🔒 Restricted user, checking accessible sectors...');
      
      const userSectorsQuery = `
        SELECT DISTINCT is_table.sector_id, s.name
        FROM user_institutions ui
        JOIN institution_sectors is_table ON ui.institution_id = is_table.institution_id
        JOIN sectors s ON is_table.sector_id = s.id
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
        if (!userSectorIds.includes(sector_id)) {
          return res.status(403).json({
            success: false,
            message: 'Access denied: Sector not accessible'
          });
        }
        sectorFilter = 'AND wtl.sector_id = $3';
        sectorParams = [sector_id];
        
        const sectorInfo = userSectorsResult.rows.find(s => s.sector_id === sector_id);
        if (sectorInfo) {
          sectorName = sectorInfo.name;
        }
      } else {
        sectorFilter = 'AND wtl.sector_id = ANY($3)';
        sectorParams = [userSectorIds];
      }
    }

    const baseParams = [startDate, endDate, ...sectorParams];

    // ========================================================================
    // STEP 3: SUMMARY DATA
    // ========================================================================

    console.log('📊 Fetching summary data...');

    // Total quantity
    const totalQuery = `
      SELECT COALESCE(SUM(wtl.net_weight_tons), 0) as total_quantity
      FROM waste_tickets_landfill wtl
      WHERE wtl.deleted_at IS NULL
        AND wtl.ticket_date >= $1
        AND wtl.ticket_date <= $2
        ${sectorFilter}
    `;
    
    const totalResult = await db.query(totalQuery, baseParams);
    const totalQuantity = parseFloat(totalResult.rows[0].total_quantity);

    // Suppliers breakdown
    const suppliersQuery = `
      SELECT 
        i.name as supplier_name,
        wc.code as waste_code,
        wc.description as waste_description,
        COALESCE(SUM(wtl.net_weight_tons), 0) as quantity
      FROM waste_tickets_landfill wtl
      JOIN institutions i ON wtl.supplier_id = i.id
      JOIN waste_codes wc ON wtl.waste_code_id = wc.id
      WHERE wtl.deleted_at IS NULL
        AND wtl.ticket_date >= $1
        AND wtl.ticket_date <= $2
        ${sectorFilter}
      GROUP BY i.name, wc.code, wc.description
      ORDER BY i.name, quantity DESC
    `;
    
    const suppliersResult = await db.query(suppliersQuery, baseParams);
    
    // Group by supplier
    const suppliersMap = {};
    suppliersResult.rows.forEach(row => {
      if (!suppliersMap[row.supplier_name]) {
        suppliersMap[row.supplier_name] = {
          name: row.supplier_name,
          total: 0,
          codes: []
        };
      }
      suppliersMap[row.supplier_name].total += parseFloat(row.quantity);
      suppliersMap[row.supplier_name].codes.push({
        code: row.waste_code,
        description: row.waste_description,
        quantity: formatNumber(row.quantity)
      });
    });

    const suppliers = Object.values(suppliersMap).map(s => ({
      ...s,
      total: formatNumber(s.total)
    }));

    // Waste codes breakdown
    const wasteCodesQuery = `
      SELECT 
        wc.code,
        wc.description,
        COALESCE(SUM(wtl.net_weight_tons), 0) as quantity
      FROM waste_tickets_landfill wtl
      JOIN waste_codes wc ON wtl.waste_code_id = wc.id
      WHERE wtl.deleted_at IS NULL
        AND wtl.ticket_date >= $1
        AND wtl.ticket_date <= $2
        ${sectorFilter}
      GROUP BY wc.code, wc.description
      ORDER BY quantity DESC
    `;
    
    const wasteCodesResult = await db.query(wasteCodesQuery, baseParams);
    const wasteCodes = wasteCodesResult.rows.map(row => ({
      code: row.code,
      description: row.description,
      quantity: formatNumber(row.quantity)
    }));

    // ========================================================================
    // STEP 4: DETAILED TICKETS WITH PAGINATION
    // ========================================================================

    console.log('📋 Fetching tickets with pagination...');

    const offset = (page - 1) * per_page;

    // Count total tickets
    const countQuery = `
      SELECT COUNT(*) as total
      FROM waste_tickets_landfill wtl
      WHERE wtl.deleted_at IS NULL
        AND wtl.ticket_date >= $1
        AND wtl.ticket_date <= $2
        ${sectorFilter}
    `;
    
    const countResult = await db.query(countQuery, baseParams);
    const totalCount = parseInt(countResult.rows[0].total);

    // Fetch tickets - FIXED for Supabase schema
    const ticketsQuery = `
      SELECT 
        wtl.id,
        wtl.ticket_number,
        wtl.ticket_date,
        wtl.ticket_time,
        i.name as supplier_name,
        wc.code as waste_code,
        wc.description as waste_description,
        s.name as sector_name,
        wtl.generator_type as generator,
        wtl.vehicle_number,
        wtl.gross_weight_kg / 1000.0 as gross_weight_tons,
        wtl.tare_weight_kg / 1000.0 as tare_weight_tons,
        wtl.net_weight_tons,
        wtl.contract_type as contract,
        wtl.operation_type
      FROM waste_tickets_landfill wtl
      JOIN institutions i ON wtl.supplier_id = i.id
      JOIN waste_codes wc ON wtl.waste_code_id = wc.id
      JOIN sectors s ON wtl.sector_id = s.id
      WHERE wtl.deleted_at IS NULL
        AND wtl.ticket_date >= $1
        AND wtl.ticket_date <= $2
        ${sectorFilter}
      ORDER BY wtl.ticket_date DESC, wtl.ticket_time DESC
      LIMIT $${baseParams.length + 1} OFFSET $${baseParams.length + 2}
    `;
    
    const ticketsResult = await db.query(
      ticketsQuery, 
      [...baseParams, per_page, offset]
    );

    const tickets = ticketsResult.rows.map(row => ({
      id: row.id,
      ticket_number: row.ticket_number,
      ticket_date: row.ticket_date,
      ticket_time: row.ticket_time,
      supplier_name: row.supplier_name,
      waste_code: row.waste_code,
      waste_description: row.waste_description,
      sector_name: row.sector_name,
      generator: row.generator,
      vehicle_number: row.vehicle_number,
      gross_weight_tons: formatNumber(row.gross_weight_tons),
      tare_weight_tons: formatNumber(row.tare_weight_tons),
      net_weight_tons: formatNumber(row.net_weight_tons),
      contract: row.contract,
      operation: row.operation_type || `Eliminare ${row.sector_name}`
    }));

    // ========================================================================
    // STEP 5: RESPONSE
    // ========================================================================

    console.log('✅ Reports data fetched successfully');

    res.json({
      success: true,
      data: {
        summary: {
          total_quantity: formatNumber(totalQuantity),
          period: {
            year: currentYear,
            date_from: startDate,
            date_to: endDate,
            sector: sectorName
          },
          suppliers: suppliers,
          waste_codes: wasteCodes
        },
        tickets: tickets,
        pagination: {
          total_count: totalCount,
          page: parseInt(page),
          per_page: parseInt(per_page),
          total_pages: Math.ceil(totalCount / per_page)
        }
      }
    });

  } catch (error) {
    console.error('❌ Reports error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch reports',
      error: error.message
    });
  }
};

/**
 * ============================================================================
 * GET AUXILIARY DATA (for dropdowns)
 * ============================================================================
 */

export const getAuxiliaryData = async (req, res) => {
  try {
    console.log('📦 Fetching auxiliary data for reports...');

    // Waste codes
    const wasteCodesQuery = `
      SELECT id, code, description
      FROM waste_codes
      WHERE deleted_at IS NULL
      ORDER BY code
    `;
    const wasteCodesResult = await db.query(wasteCodesQuery);

    // Operators (suppliers)
    const operatorsQuery = `
      SELECT id, name
      FROM institutions
      WHERE type = 'WASTE_OPERATOR'
        AND deleted_at IS NULL
      ORDER BY name
    `;
    const operatorsResult = await db.query(operatorsQuery);

    // Sectors
    const sectorsQuery = `
      SELECT id, name, sector_number
      FROM sectors
      WHERE deleted_at IS NULL
      ORDER BY sector_number
    `;
    const sectorsResult = await db.query(sectorsQuery);

    res.json({
      success: true,
      data: {
        waste_codes: wasteCodesResult.rows,
        operators: operatorsResult.rows,
        sectors: sectorsResult.rows
      }
    });

  } catch (error) {
    console.error('❌ Auxiliary data error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch auxiliary data',
      error: error.message
    });
  }
};