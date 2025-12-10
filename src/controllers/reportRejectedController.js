// ============================================================================
// REJECTED REPORTS CONTROLLER
// ============================================================================

import db from '../config/database.js';

const formatNumber = (num) => {
  if (!num && num !== 0) return '0.00';
  return parseFloat(num).toFixed(2);
};

/**
 * GET REJECTED TICKETS
 */
export const getRejectedTickets = async (req, res) => {
  try {
    const { year, start_date, end_date, sector_id, page = 1, limit = 10 } = req.query;
    
    // ✅ FIXED: Correct req.user structure from JWT
    const userId = req.user.userId;
    const userRole = req.user.role;

    // Date range
    const startDate = start_date || `${year}-01-01`;
    const endDate = end_date || `${year}-12-31`;

    // RBAC - Sector filtering
    let sectorFilter = '';
    let sectorParams = [];

    if (userRole === 'PLATFORM_ADMIN') {
      if (sector_id) {
        sectorFilter = 'AND wtrj.sector_id = $3';
        sectorParams = [sector_id];
      }
    } else {
      const userSectorsQuery = `
        SELECT DISTINCT is_table.sector_id
        FROM user_institutions ui
        JOIN institution_sectors is_table ON ui.institution_id = is_table.institution_id
        WHERE ui.user_id = $1
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
        sectorFilter = 'AND wtrj.sector_id = $3';
        sectorParams = [sector_id];
      } else {
        sectorFilter = 'AND wtrj.sector_id = ANY($3)';
        sectorParams = [userSectorIds];
      }
    }

    const baseParams = [startDate, endDate, ...sectorParams];

    // SUMMARY
    const summaryQuery = `
      SELECT 
        COALESCE(SUM(wtrj.rejected_quantity_tons), 0) as total_rejected,
        COUNT(*) as total_tickets
      FROM waste_tickets_rejected wtrj
      WHERE wtrj.deleted_at IS NULL
        AND wtrj.ticket_date >= $1
        AND wtrj.ticket_date <= $2
        ${sectorFilter}
    `;
    const summaryResult = await db.query(summaryQuery, baseParams);

    // OPERATORS (prestatori - operatori TMB care au refuzat)
    const operatorsQuery = `
      SELECT 
        i.id,
        i.name,
        s.sector_name,
        wc.code,
        SUM(wtrj.rejected_quantity_tons) as total_tons
      FROM waste_tickets_rejected wtrj
      JOIN institutions i ON wtrj.operator_id = i.id
      JOIN sectors s ON wtrj.sector_id = s.id
      JOIN waste_codes wc ON wtrj.waste_code_id = wc.id
      WHERE wtrj.deleted_at IS NULL
        AND wtrj.ticket_date >= $1
        AND wtrj.ticket_date <= $2
        ${sectorFilter}
      GROUP BY i.id, i.name, s.sector_name, wc.code
      ORDER BY total_tons DESC
      LIMIT 10
    `;
    const operatorsResult = await db.query(operatorsQuery, baseParams);

    // SUPPLIERS (furnizori - colectori care au adus deșeuri refuzate)
    const suppliersQuery = `
      SELECT 
        i.id,
        i.name,
        SUM(wtrj.rejected_quantity_tons) as total_tons
      FROM waste_tickets_rejected wtrj
      JOIN institutions i ON wtrj.supplier_id = i.id
      WHERE wtrj.deleted_at IS NULL
        AND wtrj.ticket_date >= $1
        AND wtrj.ticket_date <= $2
        ${sectorFilter}
      GROUP BY i.id, i.name
      ORDER BY total_tons DESC
      LIMIT 10
    `;
    const suppliersResult = await db.query(suppliersQuery, baseParams);

    // TICKETS (paginated)
    const offset = (page - 1) * limit;
    const ticketsQuery = `
      SELECT 
        wtrj.id,
        wtrj.ticket_number,
        wtrj.ticket_date,
        operator.name as operator_name,
        supplier.name as supplier_name,
        wc.code as waste_code,
        wc.description as waste_description,
        s.sector_name,
        wtrj.vehicle_number,
        wtrj.rejected_quantity_tons,
        wtrj.rejection_reason
      FROM waste_tickets_rejected wtrj
      JOIN institutions operator ON wtrj.operator_id = operator.id
      JOIN institutions supplier ON wtrj.supplier_id = supplier.id
      JOIN waste_codes wc ON wtrj.waste_code_id = wc.id
      JOIN sectors s ON wtrj.sector_id = s.id
      WHERE wtrj.deleted_at IS NULL
        AND wtrj.ticket_date >= $1
        AND wtrj.ticket_date <= $2
        ${sectorFilter}
      ORDER BY wtrj.ticket_date DESC
      LIMIT $${baseParams.length + 1} OFFSET $${baseParams.length + 2}
    `;
    const ticketsResult = await db.query(ticketsQuery, [...baseParams, limit, offset]);

    // COUNT
    const countQuery = `
      SELECT COUNT(*) as total
      FROM waste_tickets_rejected wtrj
      WHERE wtrj.deleted_at IS NULL
        AND wtrj.ticket_date >= $1
        AND wtrj.ticket_date <= $2
        ${sectorFilter}
    `;
    const countResult = await db.query(countQuery, baseParams);
    const totalRecords = parseInt(countResult.rows[0].total);

    res.json({
      success: true,
      data: {
        summary: {
          total_rejected: formatNumber(summaryResult.rows[0].total_rejected),
          total_tickets: summaryResult.rows[0].total_tickets
        },
        operators: operatorsResult.rows.map(o => ({
          id: o.id,
          name: o.name,
          sector_name: o.sector_name,
          code: o.code,
          total_tons: formatNumber(o.total_tons)
        })),
        suppliers: suppliersResult.rows.map(s => ({
          id: s.id,
          name: s.name,
          total_tons: formatNumber(s.total_tons)
        })),
        tickets: ticketsResult.rows.map(t => ({
          id: t.id,
          ticket_number: t.ticket_number,
          ticket_date: t.ticket_date,
          operator_name: t.operator_name,
          supplier_name: t.supplier_name,
          waste_code: t.waste_code,
          waste_description: t.waste_description,
          sector_name: t.sector_name,
          vehicle_number: t.vehicle_number,
          rejected_quantity_tons: formatNumber(t.rejected_quantity_tons),
          rejection_reason: t.rejection_reason
        })),
        pagination: {
          current_page: parseInt(page),
          per_page: parseInt(limit),
          total_records: totalRecords,
          total_pages: Math.ceil(totalRecords / limit)
        }
      }
    });
  } catch (error) {
    console.error('❌ getRejectedTickets error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch rejected tickets',
      error: error.message
    });
  }
};