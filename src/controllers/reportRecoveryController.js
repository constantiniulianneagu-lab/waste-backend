// ============================================================================
// RECOVERY REPORTS CONTROLLER
// ============================================================================

import db from '../config/database.js';

const formatNumber = (num) => {
  if (!num && num !== 0) return '0.00';
  return parseFloat(num).toFixed(2);
};

/**
 * GET RECOVERY TICKETS
 */
export const getRecoveryTickets = async (req, res) => {
  try {
    const { year, start_date, end_date, sector_id, page = 1, limit = 10 } = req.query;
    const { userId, userRole } = req.user;

    // Date range
    const startDate = start_date || `${year}-01-01`;
    const endDate = end_date || `${year}-12-31`;

    // RBAC - Sector filtering
    let sectorFilter = '';
    let sectorParams = [];

    if (userRole === 'PLATFORM_ADMIN') {
      if (sector_id) {
        sectorFilter = 'AND wtv.sector_id = $3';
        sectorParams = [sector_id];
      }
    } else if (userRole === 'INSTITUTION_ADMIN' || userRole === 'OPERATOR_USER') {
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
        if (!userSectorIds.includes(sector_id)) {
          return res.status(403).json({
            success: false,
            message: 'Access denied: Sector not accessible'
          });
        }
        sectorFilter = 'AND wtv.sector_id = $3';
        sectorParams = [sector_id];
      } else {
        sectorFilter = 'AND wtv.sector_id = ANY($3)';
        sectorParams = [userSectorIds];
      }
    }

    const baseParams = [startDate, endDate, ...sectorParams];

    // SUMMARY
    const summaryQuery = `
      SELECT 
        COALESCE(SUM(wtv.delivered_quantity_tons), 0) as total_delivered,
        COALESCE(SUM(wtv.accepted_quantity_tons), 0) as total_accepted,
        COUNT(*) as total_tickets
      FROM waste_tickets_recovery wtv
      WHERE wtv.deleted_at IS NULL
        AND wtv.ticket_date >= $1
        AND wtv.ticket_date <= $2
        ${sectorFilter}
    `;
    const summaryResult = await db.query(summaryQuery, baseParams);

    // SUPPLIERS (furnizori - operatori TMB)
    const suppliersQuery = `
      SELECT 
        i.id,
        i.name,
        s.sector_name,
        wc.code,
        SUM(wtv.delivered_quantity_tons) as total_tons
      FROM waste_tickets_recovery wtv
      JOIN institutions i ON wtv.supplier_id = i.id
      JOIN sectors s ON wtv.sector_id = s.id
      JOIN waste_codes wc ON wtv.waste_code_id = wc.id
      WHERE wtv.deleted_at IS NULL
        AND wtv.ticket_date >= $1
        AND wtv.ticket_date <= $2
        ${sectorFilter}
      GROUP BY i.id, i.name, s.sector_name, wc.code
      ORDER BY total_tons DESC
      LIMIT 10
    `;
    const suppliersResult = await db.query(suppliersQuery, baseParams);

    // CLIENTS (valorificatori)
    const clientsQuery = `
      SELECT 
        i.id,
        i.name,
        SUM(wtv.accepted_quantity_tons) as total_tons
      FROM waste_tickets_recovery wtv
      JOIN institutions i ON wtv.recipient_id = i.id
      WHERE wtv.deleted_at IS NULL
        AND wtv.ticket_date >= $1
        AND wtv.ticket_date <= $2
        ${sectorFilter}
      GROUP BY i.id, i.name
      ORDER BY total_tons DESC
      LIMIT 10
    `;
    const clientsResult = await db.query(clientsQuery, baseParams);

    // TICKETS (paginated)
    const offset = (page - 1) * limit;
    const ticketsQuery = `
      SELECT 
        wtv.id,
        wtv.ticket_number,
        wtv.ticket_date,
        client.name as client_name,
        supplier.name as supplier_name,
        wc.code as waste_code,
        wc.description as waste_description,
        s.sector_name,
        wtv.vehicle_number,
        wtv.delivered_quantity_tons,
        wtv.accepted_quantity_tons
      FROM waste_tickets_recovery wtv
      JOIN institutions client ON wtv.recipient_id = client.id
      JOIN institutions supplier ON wtv.supplier_id = supplier.id
      JOIN waste_codes wc ON wtv.waste_code_id = wc.id
      JOIN sectors s ON wtv.sector_id = s.id
      WHERE wtv.deleted_at IS NULL
        AND wtv.ticket_date >= $1
        AND wtv.ticket_date <= $2
        ${sectorFilter}
      ORDER BY wtv.ticket_date DESC
      LIMIT $${baseParams.length + 1} OFFSET $${baseParams.length + 2}
    `;
    const ticketsResult = await db.query(ticketsQuery, [...baseParams, limit, offset]);

    // COUNT
    const countQuery = `
      SELECT COUNT(*) as total
      FROM waste_tickets_recovery wtv
      WHERE wtv.deleted_at IS NULL
        AND wtv.ticket_date >= $1
        AND wtv.ticket_date <= $2
        ${sectorFilter}
    `;
    const countResult = await db.query(countQuery, baseParams);
    const totalRecords = parseInt(countResult.rows[0].total);

    res.json({
      success: true,
      data: {
        summary: {
          total_delivered: formatNumber(summaryResult.rows[0].total_delivered),
          total_accepted: formatNumber(summaryResult.rows[0].total_accepted),
          total_tickets: summaryResult.rows[0].total_tickets
        },
        suppliers: suppliersResult.rows.map(s => ({
          id: s.id,
          name: s.name,
          sector_name: s.sector_name,
          code: s.code,
          total_tons: formatNumber(s.total_tons)
        })),
        clients: clientsResult.rows.map(c => ({
          id: c.id,
          name: c.name,
          total_tons: formatNumber(c.total_tons)
        })),
        tickets: ticketsResult.rows.map(t => ({
          id: t.id,
          ticket_number: t.ticket_number,
          ticket_date: t.ticket_date,
          client_name: t.client_name,
          supplier_name: t.supplier_name,
          waste_code: t.waste_code,
          waste_description: t.waste_description,
          sector_name: t.sector_name,
          vehicle_number: t.vehicle_number,
          delivered_quantity_tons: formatNumber(t.delivered_quantity_tons),
          accepted_quantity_tons: formatNumber(t.accepted_quantity_tons)
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
    console.error('❌ getRecoveryTickets error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch recovery tickets',
      error: error.message
    });
  }
};