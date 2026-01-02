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
import { getAccessibleSectors } from '../utils/accessControl.js';

const formatNumber = (num) => {
  return num ? parseFloat(num).toFixed(2) : '0.00';
};

// ============================================================================
// GET TMB TICKETS (Tab 1 - Intrări în TMB)
// ============================================================================
export const getTmbTickets = async (req, res) => {
  console.log('\n📊 ==================== TMB TICKETS REPORT ====================');
  console.log('📥 Query params:', req.query);
  console.log('👤 User:', { id: req.user.id, role: req.user.role });
  
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

    // ✅ Sector filtering cu noua logică
    if (sector_id) {
      // User cere un sector specific
      let sectorUuid = sector_id;
      
      // Convertește sector_number → UUID dacă e necesar
      if (!isNaN(sector_id) && parseInt(sector_id) >= 1 && parseInt(sector_id) <= 6) {
        const sectorQuery = await pool.query(
          'SELECT id FROM sectors WHERE sector_number = $1 AND is_active = true',
          [parseInt(sector_id)]
        );
        if (sectorQuery.rows.length > 0) {
          sectorUuid = sectorQuery.rows[0].id;
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

      whereConditions.push(`wtt.sector_id = $${paramIndex}`);
      queryParams.push(sectorUuid);
      paramIndex++;
    } else {
      // User nu cere sector specific → filtrează automat la sectoarele accesibile
      if (access.accessType !== 'PLATFORM_ALL') {
        whereConditions.push(`wtt.sector_id = ANY($${paramIndex})`);
        queryParams.push(access.sectorIds);
        paramIndex++;
      }
    }

    const whereClause = whereConditions.join(' AND ');

    console.log('🔍 WHERE clause:', whereClause);
    console.log('📊 Query params:', queryParams);

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

    console.log('📈 Summary:', summary);

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

    console.log(`✅ Found ${ticketsResult.rows.length} tickets for current page`);

    res.json({
      success: true,
      data: {
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
        },
        // ✅ Info pentru debugging/UI
        access_info: {
          accessible_sectors: access.sectorIds.length,
          access_type: access.accessType,
          institution_name: access.institutionName,
          is_pmb: access.isPMB,
          can_export: true  // Toți pot exporta
        }
      }
    });

  } catch (error) {
    console.error('❌ getTmbTickets error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la obținerea raportului TMB',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ============================================================================
// GET RECYCLING TICKETS (Tab 2 - Ieșiri reciclare)
// ============================================================================
export const getRecyclingTickets = async (req, res) => {
  console.log('\n♻️ ==================== RECYCLING TICKETS REPORT ====================');
  console.log('📥 Query params:', req.query);
  console.log('👤 User:', { id: req.user.id, role: req.user.role });
  
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

    // ✅ Calculează acces
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

    // Build WHERE clause
    let whereConditions = ['wtr.deleted_at IS NULL'];
    let queryParams = [];
    let paramIndex = 1;

    // Date filters
    if (year) {
      whereConditions.push(`EXTRACT(YEAR FROM wtr.ticket_date) = $${paramIndex}`);
      queryParams.push(parseInt(year));
      paramIndex++;
    } else {
      if (start_date) {
        whereConditions.push(`wtr.ticket_date >= $${paramIndex}`);
        queryParams.push(start_date);
        paramIndex++;
      }
      if (end_date) {
        whereConditions.push(`wtr.ticket_date <= $${paramIndex}`);
        queryParams.push(end_date);
        paramIndex++;
      }
    }

    // ✅ Sector filtering
    if (sector_id) {
      let sectorUuid = sector_id;
      
      if (!isNaN(sector_id) && parseInt(sector_id) >= 1 && parseInt(sector_id) <= 6) {
        const sectorQuery = await pool.query(
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

      whereConditions.push(`wtr.sector_id = $${paramIndex}`);
      queryParams.push(sectorUuid);
      paramIndex++;
    } else {
      if (access.accessType !== 'PLATFORM_ALL') {
        whereConditions.push(`wtr.sector_id = ANY($${paramIndex})`);
        queryParams.push(access.sectorIds);
        paramIndex++;
      }
    }

    const whereClause = whereConditions.join(' AND ');

    // Summary
    const summaryQuery = `
      SELECT 
        COUNT(*) as total_tickets,
        COALESCE(SUM(wtr.net_weight_tons), 0) as total_tons
      FROM waste_tickets_recycling wtr
      WHERE ${whereClause}
    `;
    
    const summaryResult = await pool.query(summaryQuery, queryParams);

    res.json({
      success: true,
      data: {
        summary: {
          total_tickets: parseInt(summaryResult.rows[0].total_tickets),
          total_tons: formatNumber(summaryResult.rows[0].total_tons)
        },
        suppliers: [],
        recipients: [],
        tickets: [],
        pagination: {
          current_page: parseInt(page),
          per_page: parseInt(limit),
          total_records: parseInt(summaryResult.rows[0].total_tickets),
          total_pages: Math.ceil(parseInt(summaryResult.rows[0].total_tickets) / parseInt(limit))
        },
        access_info: {
          accessible_sectors: access.sectorIds.length,
          access_type: access.accessType,
          can_export: true
        }
      }
    });

  } catch (error) {
    console.error('❌ getRecyclingTickets error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la obținerea raportului reciclare',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ============================================================================
// GET RECOVERY TICKETS (Tab 3 - Ieșiri valorificare)
// ============================================================================
export const getRecoveryTickets = async (req, res) => {
  console.log('\n⚡ ==================== RECOVERY TICKETS REPORT ====================');
  console.log('📥 Query params:', req.query);
  console.log('👤 User:', { id: req.user.id, role: req.user.role });
  
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

    // ✅ Calculează acces
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

    // Build WHERE clause
    let whereConditions = ['wtv.deleted_at IS NULL'];
    let queryParams = [];
    let paramIndex = 1;

    // Date filters
    if (year) {
      whereConditions.push(`EXTRACT(YEAR FROM wtv.ticket_date) = $${paramIndex}`);
      queryParams.push(parseInt(year));
      paramIndex++;
    } else {
      if (start_date) {
        whereConditions.push(`wtv.ticket_date >= $${paramIndex}`);
        queryParams.push(start_date);
        paramIndex++;
      }
      if (end_date) {
        whereConditions.push(`wtv.ticket_date <= $${paramIndex}`);
        queryParams.push(end_date);
        paramIndex++;
      }
    }

    // ✅ Sector filtering
    if (sector_id) {
      let sectorUuid = sector_id;
      
      if (!isNaN(sector_id) && parseInt(sector_id) >= 1 && parseInt(sector_id) <= 6) {
        const sectorQuery = await pool.query(
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

      whereConditions.push(`wtv.sector_id = $${paramIndex}`);
      queryParams.push(sectorUuid);
      paramIndex++;
    } else {
      if (access.accessType !== 'PLATFORM_ALL') {
        whereConditions.push(`wtv.sector_id = ANY($${paramIndex})`);
        queryParams.push(access.sectorIds);
        paramIndex++;
      }
    }

    const whereClause = whereConditions.join(' AND ');

    // Summary
    const summaryQuery = `
      SELECT 
        COUNT(*) as total_tickets,
        COALESCE(SUM(wtv.net_weight_tons), 0) as total_tons
      FROM waste_tickets_recovery wtv
      WHERE ${whereClause}
    `;
    
    const summaryResult = await pool.query(summaryQuery, queryParams);

    res.json({
      success: true,
      data: {
        summary: {
          total_tickets: parseInt(summaryResult.rows[0].total_tickets),
          total_tons: formatNumber(summaryResult.rows[0].total_tons)
        },
        suppliers: [],
        recipients: [],
        tickets: [],
        pagination: {
          current_page: parseInt(page),
          per_page: parseInt(limit),
          total_records: parseInt(summaryResult.rows[0].total_tickets),
          total_pages: Math.ceil(parseInt(summaryResult.rows[0].total_tickets) / parseInt(limit))
        },
        access_info: {
          accessible_sectors: access.sectorIds.length,
          access_type: access.accessType,
          can_export: true
        }
      }
    });

  } catch (error) {
    console.error('❌ getRecoveryTickets error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la obținerea raportului valorificare',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ============================================================================
// GET DISPOSAL TICKETS (Tab 4 - Ieșiri depozitare)
// ============================================================================
export const getDisposalTickets = async (req, res) => {
  console.log('\n🗑️ ==================== DISPOSAL TICKETS REPORT ====================');
  console.log('📥 Query params:', req.query);
  console.log('👤 User:', { id: req.user.id, role: req.user.role });
  
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

    // ✅ Calculează acces
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

    // Build WHERE clause
    let whereConditions = ['wtd.deleted_at IS NULL'];
    let queryParams = [];
    let paramIndex = 1;

    // Date filters
    if (year) {
      whereConditions.push(`EXTRACT(YEAR FROM wtd.ticket_date) = $${paramIndex}`);
      queryParams.push(parseInt(year));
      paramIndex++;
    } else {
      if (start_date) {
        whereConditions.push(`wtd.ticket_date >= $${paramIndex}`);
        queryParams.push(start_date);
        paramIndex++;
      }
      if (end_date) {
        whereConditions.push(`wtd.ticket_date <= $${paramIndex}`);
        queryParams.push(end_date);
        paramIndex++;
      }
    }

    // ✅ Sector filtering
    if (sector_id) {
      let sectorUuid = sector_id;
      
      if (!isNaN(sector_id) && parseInt(sector_id) >= 1 && parseInt(sector_id) <= 6) {
        const sectorQuery = await pool.query(
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

      whereConditions.push(`wtd.sector_id = $${paramIndex}`);
      queryParams.push(sectorUuid);
      paramIndex++;
    } else {
      if (access.accessType !== 'PLATFORM_ALL') {
        whereConditions.push(`wtd.sector_id = ANY($${paramIndex})`);
        queryParams.push(access.sectorIds);
        paramIndex++;
      }
    }

    const whereClause = whereConditions.join(' AND ');

    // Summary
    const summaryQuery = `
      SELECT 
        COUNT(*) as total_tickets,
        COALESCE(SUM(wtd.net_weight_tons), 0) as total_tons
      FROM waste_tickets_disposal wtd
      WHERE ${whereClause}
    `;
    
    const summaryResult = await pool.query(summaryQuery, queryParams);

    res.json({
      success: true,
      data: {
        summary: {
          total_tickets: parseInt(summaryResult.rows[0].total_tickets),
          total_tons: formatNumber(summaryResult.rows[0].total_tons)
        },
        suppliers: [],
        recipients: [],
        tickets: [],
        pagination: {
          current_page: parseInt(page),
          per_page: parseInt(limit),
          total_records: parseInt(summaryResult.rows[0].total_tickets),
          total_pages: Math.ceil(parseInt(summaryResult.rows[0].total_tickets) / parseInt(limit))
        },
        access_info: {
          accessible_sectors: access.sectorIds.length,
          access_type: access.accessType,
          can_export: true
        }
      }
    });

  } catch (error) {
    console.error('❌ getDisposalTickets error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la obținerea raportului depozitare',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ============================================================================
// GET REJECTED TICKETS (Tab 5 - Deșeuri refuzate)
// ============================================================================
export const getRejectedTickets = async (req, res) => {
  console.log('\n❌ ==================== REJECTED TICKETS REPORT ====================');
  console.log('📥 Query params:', req.query);
  console.log('👤 User:', { id: req.user.id, role: req.user.role });
  
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

    // ✅ Calculează acces
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

    // Build WHERE clause
    let whereConditions = ['wtrj.deleted_at IS NULL'];
    let queryParams = [];
    let paramIndex = 1;

    // Date filters
    if (year) {
      whereConditions.push(`EXTRACT(YEAR FROM wtrj.ticket_date) = $${paramIndex}`);
      queryParams.push(parseInt(year));
      paramIndex++;
    } else {
      if (start_date) {
        whereConditions.push(`wtrj.ticket_date >= $${paramIndex}`);
        queryParams.push(start_date);
        paramIndex++;
      }
      if (end_date) {
        whereConditions.push(`wtrj.ticket_date <= $${paramIndex}`);
        queryParams.push(end_date);
        paramIndex++;
      }
    }

    // ✅ Sector filtering
    if (sector_id) {
      let sectorUuid = sector_id;
      
      if (!isNaN(sector_id) && parseInt(sector_id) >= 1 && parseInt(sector_id) <= 6) {
        const sectorQuery = await pool.query(
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

      whereConditions.push(`wtrj.sector_id = $${paramIndex}`);
      queryParams.push(sectorUuid);
      paramIndex++;
    } else {
      if (access.accessType !== 'PLATFORM_ALL') {
        whereConditions.push(`wtrj.sector_id = ANY($${paramIndex})`);
        queryParams.push(access.sectorIds);
        paramIndex++;
      }
    }

    const whereClause = whereConditions.join(' AND ');

    // Summary
    const summaryQuery = `
      SELECT 
        COUNT(*) as total_tickets,
        COALESCE(SUM(wtrj.net_weight_tons), 0) as total_tons
      FROM waste_tickets_rejected wtrj
      WHERE ${whereClause}
    `;
    
    const summaryResult = await pool.query(summaryQuery, queryParams);

    res.json({
      success: true,
      data: {
        summary: {
          total_tickets: parseInt(summaryResult.rows[0].total_tickets),
          total_tons: formatNumber(summaryResult.rows[0].total_tons)
        },
        suppliers: [],
        operators: [],
        tickets: [],
        pagination: {
          current_page: parseInt(page),
          per_page: parseInt(limit),
          total_records: parseInt(summaryResult.rows[0].total_tickets),
          total_pages: Math.ceil(parseInt(summaryResult.rows[0].total_tickets) / parseInt(limit))
        },
        access_info: {
          accessible_sectors: access.sectorIds.length,
          access_type: access.accessType,
          can_export: true
        }
      }
    });

  } catch (error) {
    console.error('❌ getRejectedTickets error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la obținerea raportului deșeuri refuzate',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
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