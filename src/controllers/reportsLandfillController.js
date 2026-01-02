/**
 * ============================================================================
 * REPORTS LANDFILL CONTROLLER - UPDATED WITH ACCESS CONTROL
 * ============================================================================
 * 
 * Updated: 2025-01-02 - Integrated with centralized access control
 * ============================================================================
 */

import db from '../config/database.js';
import { getAccessibleSectors } from '../utils/accessControl.js';

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
 */

export const getLandfillReports = async (req, res) => {
  console.log('\n📊 ==================== LANDFILL REPORTS REQUEST ====================');
  console.log('📥 Query params:', req.query);
  console.log('👤 User:', { id: req.user?.id, role: req.user?.role });

  try {
    const { year, from, to, sector_id, page = 1, per_page = 20 } = req.query;
    const userId = req.user.id;
    const userRole = req.user.role;

    // ✅ NOUA LOGICĂ: Calculează acces prin accessControl
    const access = await getAccessibleSectors(userId, userRole);

    console.log('🔐 Access control:', {
      userId,
      role: userRole,
      accessType: access.accessType,
      sectorsCount: access.sectorIds.length,
      institutionName: access.institutionName,
      canEdit: access.canEdit,
      isPMB: access.isPMB
    });

    // Verifică dacă user-ul are acces la cel puțin un sector
    if (access.sectorIds.length === 0 && access.accessType !== 'PLATFORM_ALL') {
      return res.status(403).json({
        success: false,
        message: 'Nu ai acces la niciun sector'
      });
    }

    // Date range setup
    const currentDate = new Date();
    const currentYear = year || currentDate.getFullYear();
    const startDate = from || `${currentYear}-01-01`;
    const endDate = to || currentDate.toISOString().split('T')[0];

    console.log('📅 Date range:', { startDate, endDate });

    // ✅ Sector filtering cu noua logică
    let sectorFilter = '';
    let sectorParams = [];
    let sectorName = 'București';

    if (sector_id) {
      // User cere un sector specific
      let sectorUuid = sector_id;
      
      // Convertește sector_number → UUID dacă e necesar
      if (!isNaN(sector_id) && parseInt(sector_id) >= 1 && parseInt(sector_id) <= 6) {
        const sectorQuery = await db.query(
          'SELECT id, sector_name FROM sectors WHERE sector_number = $1 AND is_active = true',
          [parseInt(sector_id)]
        );
        if (sectorQuery.rows.length > 0) {
          sectorUuid = sectorQuery.rows[0].id;
          sectorName = sectorQuery.rows[0].sector_name;
        }
      } else {
        // E deja UUID
        const sectorQuery = await db.query(
          'SELECT sector_name FROM sectors WHERE id = $1',
          [sector_id]
        );
        if (sectorQuery.rows.length > 0) {
          sectorName = sectorQuery.rows[0].sector_name;
        }
      }

      // Verifică dacă user-ul are acces la acest sector
      if (access.accessType !== 'PLATFORM_ALL') {
        if (!access.sectorIds.includes(sectorUuid)) {
          return res.status(403).json({
            success: false,
            message: 'Nu ai acces la acest sector'
          });
        }
      }

      sectorFilter = 'AND wtl.sector_id = $3';
      sectorParams = [sectorUuid];
    } else {
      // User nu cere sector specific → filtrează automat la sectoarele accesibile
      if (access.accessType !== 'PLATFORM_ALL') {
        sectorFilter = 'AND wtl.sector_id = ANY($3)';
        sectorParams = [access.sectorIds];
      }
    }

    const baseParams = [startDate, endDate, ...sectorParams];

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

    // Fetch tickets
    const ticketsQuery = `
      SELECT 
        wtl.id,
        wtl.ticket_number,
        wtl.ticket_date,
        wtl.ticket_time,
        i.name as supplier_name,
        wc.code as waste_code,
        wc.description as waste_description,
        s.sector_name,
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
        },
        // ✅ Info pentru debugging/UI
        access_info: {
          accessible_sectors: access.sectorIds.length,
          access_type: access.accessType,
          institution_name: access.institutionName,
          is_pmb: access.isPMB,
          can_export: true
        }
      }
    });

  } catch (error) {
    console.error('❌ Reports error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch reports',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * ============================================================================
 * GET AUXILIARY DATA
 * ============================================================================
 */

export const getAuxiliaryData = async (req, res) => {
  try {
    console.log('📦 Fetching auxiliary data for reports...');

    // Waste codes - NU are deleted_at!
    const wasteCodesQuery = `
      SELECT id, code, description
      FROM waste_codes
      WHERE is_active = true
      ORDER BY code
    `;
    const wasteCodesResult = await db.query(wasteCodesQuery);

    // Operators (suppliers) - ARE deleted_at
    const operatorsQuery = `
      SELECT id, name
      FROM institutions
      WHERE type = 'WASTE_OPERATOR'
        AND deleted_at IS NULL
      ORDER BY name
    `;
    const operatorsResult = await db.query(operatorsQuery);

    // Sectors - NU are deleted_at!
    const sectorsQuery = `
      SELECT id, sector_name as name, sector_number
      FROM sectors
      WHERE is_active = true
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

/**
 * ============================================================================
 * EXPORT LANDFILL REPORTS (toate datele filtrate, fără paginare)
 * ============================================================================
 */

export const exportLandfillReports = async (req, res) => {
  console.log('\n📤 ==================== EXPORT LANDFILL REPORTS ====================');
  console.log('📥 Query params:', req.query);
  console.log('👤 User:', { id: req.user?.id, role: req.user?.role });

  try {
    const { year, from, to, sector_id } = req.query;
    const userId = req.user.id;
    const userRole = req.user.role;

    // ✅ NOUA LOGICĂ: Calculează acces prin accessControl
    const access = await getAccessibleSectors(userId, userRole);

    console.log('🔐 Access control:', {
      role: userRole,
      accessType: access.accessType,
      sectorsCount: access.sectorIds.length
    });

    if (access.sectorIds.length === 0 && access.accessType !== 'PLATFORM_ALL') {
      return res.status(403).json({
        success: false,
        message: 'Nu ai acces la niciun sector'
      });
    }

    // Date range setup
    const currentDate = new Date();
    const currentYear = year || currentDate.getFullYear();
    const startDate = from || `${currentYear}-01-01`;
    const endDate = to || currentDate.toISOString().split('T')[0];

    console.log('📅 Date range:', { startDate, endDate });

    // ✅ Sector filtering
    let sectorFilter = '';
    let sectorParams = [];

    if (sector_id) {
      let sectorUuid = sector_id;
      
      if (!isNaN(sector_id) && parseInt(sector_id) >= 1 && parseInt(sector_id) <= 6) {
        const sectorQuery = await db.query(
          'SELECT id FROM sectors WHERE sector_number = $1 AND is_active = true',
          [parseInt(sector_id)]
        );
        if (sectorQuery.rows.length > 0) {
          sectorUuid = sectorQuery.rows[0].id;
        }
      }

      if (access.accessType !== 'PLATFORM_ALL') {
        if (!access.sectorIds.includes(sectorUuid)) {
          return res.status(403).json({
            success: false,
            message: 'Nu ai acces la acest sector'
          });
        }
      }

      sectorFilter = 'AND wtl.sector_id = $3';
      sectorParams = [sectorUuid];
    } else {
      if (access.accessType !== 'PLATFORM_ALL') {
        sectorFilter = 'AND wtl.sector_id = ANY($3)';
        sectorParams = [access.sectorIds];
      }
    }

    const baseParams = [startDate, endDate, ...sectorParams];

    // Count total
    console.log('🔢 Counting total records...');

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

    console.log(`📊 Total records: ${totalCount}`);

    // Fetch ALL tickets (fără LIMIT/OFFSET)
    console.log('📋 Fetching ALL tickets for export...');

    const ticketsQuery = `
      SELECT 
        wtl.id,
        wtl.ticket_number,
        wtl.ticket_date,
        wtl.ticket_time,
        i.name as supplier_name,
        wc.code as waste_code,
        wc.description as waste_description,
        s.sector_name,
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
    `;
    
    const ticketsResult = await db.query(ticketsQuery, baseParams);

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

    console.log(`✅ Export data fetched successfully: ${tickets.length} records`);

    res.json({
      success: true,
      data: {
        tickets: tickets,
        total_count: totalCount,
        access_info: {
          accessible_sectors: access.sectorIds.length,
          access_type: access.accessType,
          can_export: true
        }
      }
    });

  } catch (error) {
    console.error('❌ Export error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to export reports',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};