// ============================================================================
// RECYCLING REPORTS CONTROLLER - CORRECT VERSION
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
    const userId = req.user.id;
    const userRole = req.user.role;

    console.log('♻️ RECYCLING REPORT - User:', userId, 'Role:', userRole);

    // Date range
    const startDate = start_date || `${year}-01-01`;
    const endDate = end_date || `${year}-12-31`;

    // RBAC - Sector filtering
    let sectorFilter = '';
    let sectorParams = [];

    if (userRole === 'PLATFORM_ADMIN') {
      console.log('✅ PLATFORM_ADMIN - full access');
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

      console.log('🔐 User sectors:', userSectorIds);

      if (userSectorIds.length === 0) {
        console.log('⚠️ User has no assigned sectors - showing all data');
        // Permite accesul la toate datele (sau schimbă în 403 dacă vrei strict RBAC)
      } else {
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
    }

    const baseParams = [startDate, endDate, ...sectorParams];

    console.log('📅 Date range:', startDate, 'to', endDate);
    console.log('🔍 Sector filter:', sectorFilter);
    console.log('📦 Base params:', baseParams);

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

    console.log('📊 Summary result:', summaryResult.rows[0]);

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
      ORDER BY i.name, SUM(wtr.accepted_quantity_tons) DESC
    `;
    
    console.log('🔍 Executing suppliers query...');
    const suppliersResult = await db.query(suppliersQuery, baseParams);
    console.log('✅ Suppliers query returned:', suppliersResult.rows.length, 'rows');

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

    const suppliers = Object.values(suppliersMap)
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);

    console.log('🏭 Suppliers after grouping:', suppliers.length);
    if (suppliers.length > 0) {
      console.log('🏭 First supplier example:', JSON.stringify(suppliers[0], null, 2));
    }

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
      ORDER BY i.name, SUM(wtr.accepted_quantity_tons) DESC
    `;
    
    console.log('🔍 Executing clients query...');
    const clientsResult = await db.query(clientsQuery, baseParams);
    console.log('✅ Clients query returned:', clientsResult.rows.length, 'rows');

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

    const clients = Object.values(clientsMap)
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);

    console.log('♻️ Clients after grouping:', clients.length);

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
      JOIN sectors s ON wtr.sector_id = s.id
      WHERE wtr.deleted_at IS NULL
        AND wtr.ticket_date >= $1
        AND wtr.ticket_date <= $2
        ${sectorFilter}
      ORDER BY wtr.ticket_date DESC, wtr.ticket_time DESC
      LIMIT $${baseParams.length + 1} OFFSET $${baseParams.length + 2}
    `;
    const ticketsResult = await db.query(ticketsQuery, [...baseParams, limit, offset]);

    console.log('🎫 Tickets:', ticketsResult.rows.length);

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

    console.log('📊 Total records:', totalRecords);

    const response = {
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
    };

    console.log('✅ RECYCLING REPORT SUCCESS');
    console.log('📤 Response summary:', {
      total_quantity: response.data.summary.total_quantity,
      suppliers_count: response.data.suppliers.length,
      clients_count: response.data.clients.length,
      tickets_count: response.data.tickets.length
    });

    res.json(response);

  } catch (error) {
    console.error('❌ getRecyclingTickets error:', error);
    console.error('❌ Error stack:', error.stack);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch recycling tickets',
      error: error.message
    });
  }
};