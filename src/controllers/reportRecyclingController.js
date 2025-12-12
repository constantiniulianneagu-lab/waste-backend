// ============================================================================
// RECYCLING REPORTS CONTROLLER - FIXED (aligned with other reports)
// ============================================================================

import db from '../config/database.js';

export const getRecyclingTickets = async (req, res) => {
  try {
    const { year, start_date, end_date, sector_id, page = 1, limit = 10 } = req.query;

    // ✅ FIX: Correct req.user structure (same as Recovery/Disposal controllers)
    const userId = req.user.userId;
    const userRole = req.user.role;

    console.log('♻️ RECYCLING REPORT - User:', userId, 'Role:', userRole);

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
        sectorFilter = 'AND wtr.sector_id = $3';
        sectorParams = [sector_id];
      } else {
        sectorFilter = 'AND wtr.sector_id = ANY($3)';
        sectorParams = [userSectorIds];
      }
    }

    const baseParams = [startDate, endDate, ...sectorParams];

    // SUMMARY (same fields style as other reports)
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

    // SUPPLIERS (furnizori - operatori TMB) -> format compatibil cu frontend-ul tău
    const suppliersQuery = `
      SELECT 
        i.id,
        i.name,
        s.sector_name,
        wc.code,
        COALESCE(SUM(wtr.delivered_quantity_tons), 0) as total_tons
      FROM waste_tickets_recycling wtr
      JOIN institutions i ON wtr.supplier_id = i.id
      JOIN sectors s ON wtr.sector_id = s.id
      JOIN waste_codes wc ON wtr.waste_code_id = wc.id
      WHERE wtr.deleted_at IS NULL
        AND wtr.ticket_date >= $1
        AND wtr.ticket_date <= $2
        ${sectorFilter}
      GROUP BY i.id, i.name, s.sector_name, wc.code
      ORDER BY total_tons DESC
      LIMIT 10
    `;
    const suppliersResult = await db.query(suppliersQuery, baseParams);

    // CLIENTS (reciclatori)
    const clientsQuery = `
      SELECT 
        i.id,
        i.name,
        COALESCE(SUM(wtr.accepted_quantity_tons), 0) as total_tons
      FROM waste_tickets_recycling wtr
      JOIN institutions i ON wtr.recipient_id = i.id
      WHERE wtr.deleted_at IS NULL
        AND wtr.ticket_date >= $1
        AND wtr.ticket_date <= $2
        ${sectorFilter}
      GROUP BY i.id, i.name
      ORDER BY total_tons DESC
      LIMIT 10
    `;
    const clientsResult = await db.query(clientsQuery, baseParams);

    // TICKETS (paginated) - păstrăm câmpurile de care are nevoie tabelul de recycling
    const offset = (parseInt(page) - 1) * parseInt(limit);
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
      JOIN sectors s ON wtr.sector_id = s.id
      WHERE wtr.deleted_at IS NULL
        AND wtr.ticket_date >= $1
        AND wtr.ticket_date <= $2
        ${sectorFilter}
      ORDER BY wtr.ticket_date DESC, wtr.ticket_time DESC
      LIMIT $${baseParams.length + 1} OFFSET $${baseParams.length + 2}
    `;
    const ticketsResult = await db.query(ticketsQuery, [...baseParams, parseInt(limit), offset]);

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

    // AVAILABLE YEARS (ca la celelalte rapoarte)
    const availableYearsQuery = `
      SELECT DISTINCT EXTRACT(YEAR FROM ticket_date)::INTEGER AS year
      FROM waste_tickets_recycling
      WHERE deleted_at IS NULL
      ORDER BY year DESC
    `;
    let availableYears = [];
    try {
      const yearsResult = await db.query(availableYearsQuery);
      availableYears = yearsResult.rows.map(r => r.year);
    } catch {
      availableYears = [new Date().getFullYear()];
    }

    res.json({
      success: true,
      data: {
        available_years: availableYears,
        summary: summaryResult.rows[0],         // { total_delivered, total_accepted, total_tickets }
        suppliers: suppliersResult.rows,        // [{ id, name, sector_name, code, total_tons }]
        clients: clientsResult.rows,            // [{ id, name, total_tons }]
        tickets: ticketsResult.rows,            // tabel
        pagination: {
          current_page: parseInt(page),
          per_page: parseInt(limit),
          total_records: totalRecords,
          total_pages: Math.ceil(totalRecords / parseInt(limit))
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
