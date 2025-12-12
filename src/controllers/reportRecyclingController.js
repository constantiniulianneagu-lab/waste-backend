// ============================================================================
// RECYCLING REPORTS CONTROLLER
// ============================================================================

import db from '../config/database.js';

const formatNumber = (num) => {
  if (!num && num !== 0) return '0.00';
  return parseFloat(num).toFixed(2);
};

/**
 * GET RECYCLING TICKETS
 */
export const getRecyclingTickets = async (req, res) => {
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
        sectorFilter = 'AND wtr.sector_id = $3';
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
        sectorFilter = 'AND wtr.sector_id = $3';
        sectorParams = [sector_id];
      } else {
        sectorFilter = 'AND wtr.sector_id = ANY($3)';
        sectorParams = [userSectorIds];
      }
    }

    const baseParams = [startDate, endDate, ...sectorParams];

    // SUMMARY
    const summaryQuery = `
      SELECT 
        COALESCE(SUM(wtr.delivered_quantity_tons), 0) as total_delivered,
        COALESCE(SUM(wtr.accepted_quantity_tons), 0) as total_accepted,
        COUNT(*) as total_tickets
      FROM waste_tickets_recycling wtr
      WHERE wtr.deleted_at IS NULL
        AND wtr.ticket_date >= $1
        AND wtr.ticket_date <= $2
        ${sectorFilter}
    `;
    const summaryResult = await db.query(summaryQuery, baseParams);

    // SUPPLIERS (furnizori - operatori TMB) - GRUPAT PE CODURI
    const suppliersQuery = `
      SELECT 
        i.name as supplier_name,
        wc.code as waste_code,
        SUM(wtr.accepted_quantity_tons) as total_tons
      FROM waste_tickets_recycling wtr
      JOIN institutions i ON wtr.supplier_id = i.id
      JOIN waste_codes wc ON wtr.waste_code_id = wc.id
      WHERE wtr.deleted_at IS NULL
        AND wtr.ticket_date >= $1
        AND wtr.ticket_date <= $2
        ${sectorFilter}
      GROUP BY i.name, wc.code
      ORDER BY i.name, total_tons DESC
    `;
    const suppliersResult = await db.query(suppliersQuery, baseParams);

    // Group suppliers by name with their codes
    const suppliersMap = {};
    suppliersResult.rows.forEach(row => {
      if (!suppliersMap[row.supplier_name]) {
        suppliersMap[row.supplier_name] = {
          name: row.supplier_name,
          total: 0,
          codes: []
        };
      }
      const tons = parseFloat(row.total_tons);
      suppliersMap[row.supplier_name].total += tons;
      suppliersMap[row.supplier_name].codes.push({
        code: row.waste_code,
        quantity: tons
      });
    });

    const suppliers = Object.values(suppliersMap).sort((a, b) => b.total - a.total).slice(0, 10);

    // CLIENTS (reciclatori) - GRUPAT PE CODURI
    const clientsQuery = `
      SELECT 
        i.name as client_name,
        wc.code as waste_code,
        SUM(wtr.accepted_quantity_tons) as total_tons
      FROM waste_tickets_recycling wtr
      JOIN institutions i ON wtr.recipient_id = i.id
      JOIN waste_codes wc ON wtr.waste_code_id = wc.id
      WHERE wtr.deleted_at IS NULL
        AND wtr.ticket_date >= $1
        AND wtr.ticket_date <= $2
        ${sectorFilter}
      GROUP BY i.name, wc.code
      ORDER BY i.name, total_tons DESC
    `;
    const clientsResult = await db.query(clientsQuery, baseParams);

    // Group clients by name with their codes
    const clientsMap = {};
    clientsResult.rows.forEach(row => {
      if (!clientsMap[row.client_name]) {
        clientsMap[row.client_name] = {
          name: row.client_name,
          total: 0,
          codes: []
        };
      }
      const tons = parseFloat(row.total_tons);
      clientsMap[row.client_name].total += tons;
      clientsMap[row.client_name].codes.push({
        code: row.waste_code,
        quantity: tons
      });
    });

    const clients = Object.values(clientsMap).sort((a, b) => b.total - a.total).slice(0, 10);

    // TICKETS (paginated)
    const offset = (page - 1) * limit;
    const ticketsQuery = `
      SELECT 
        wtr.id,
        wtr.ticket_number,
        wtr.ticket_date,
        wtr.ticket_time,
        client.name as client_name,
        supplier.name as supplier_name,
        wc.code as waste_code,
        wc.description as waste_description,
        s.sector_name,
        wtr.vehicle_number,
        wtr.delivered_quantity_tons,
        wtr.accepted_quantity_tons,
        wtr.difference_tons,
        CASE 
          WHEN wtr.delivered_quantity_tons > 0 
          THEN (wtr.accepted_quantity_tons / wtr.delivered_quantity_tons * 100)
          ELSE 0 
        END as acceptance_percentage
      FROM waste_tickets_recycling wtr
      JOIN institutions client ON wtr.recipient_id = client.id
      JOIN institutions supplier ON wtr.supplier_id = supplier.id
      JOIN waste_codes wc ON wtr.waste_code_id = wc.id
      LEFT JOIN institution_sectors inst_sect ON supplier.id = inst_sect.institution_id
      LEFT JOIN sectors s ON inst_sect.sector_id = s.id
      WHERE wtr.deleted_at IS NULL
        AND wtr.ticket_date >= $1
        AND wtr.ticket_date <= $2
        ${sectorFilter}
      ORDER BY wtr.ticket_date DESC, wtr.ticket_time DESC
      LIMIT $${baseParams.length + 1} OFFSET $${baseParams.length + 2}
    `;
    const ticketsResult = await db.query(ticketsQuery, [...baseParams, limit, offset]);

    // COUNT
    const countQuery = `
      SELECT COUNT(*) as total
      FROM waste_tickets_recycling wtr
      WHERE wtr.deleted_at IS NULL
        AND wtr.ticket_date >= $1
        AND wtr.ticket_date <= $2
        ${sectorFilter}
    `;
    const countResult = await db.query(countQuery, baseParams);
    const totalRecords = parseInt(countResult.rows[0].total);

    res.json({
      success: true,
      data: {
        summary: {
          total_quantity: parseFloat(summaryResult.rows[0].total_accepted),
          period: {
            year: parseInt(year),
            date_from: startDate,
            date_to: endDate,
            sector: sector_id ? 'Sector specific' : 'București'
          }
        },
        suppliers: suppliers,
        clients: clients,
        tickets: ticketsResult.rows.map(t => ({
          id: t.id,
          ticket_number: t.ticket_number,
          ticket_date: t.ticket_date,
          ticket_time: t.ticket_time,
          client_name: t.client_name,
          supplier_name: t.supplier_name,
          waste_code: t.waste_code,
          waste_description: t.waste_description,
          sector_name: t.sector_name || 'N/A',
          vehicle_number: t.vehicle_number,
          delivered_quantity_tons: parseFloat(t.delivered_quantity_tons),
          accepted_quantity_tons: parseFloat(t.accepted_quantity_tons),
          difference_tons: parseFloat(t.difference_tons),
          acceptance_percentage: parseFloat(t.acceptance_percentage).toFixed(2)
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
    console.error('❌ getRecyclingTickets error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch recycling tickets',
      error: error.message
    });
  }
};