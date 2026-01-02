// ============================================================================
// RECYCLING REPORTS CONTROLLER - UPDATED WITH ACCESS CONTROL
// ============================================================================
// Updated: 2025-01-02 - Integrated with centralized access control
// ============================================================================

import db from '../config/database.js';
import { getAccessibleSectors } from '../utils/accessControl.js';

const formatNumber = (num) => {
  if (!num && num !== 0) return '0.00';
  return parseFloat(num).toFixed(2);
};

export const getRecyclingTickets = async (req, res) => {
  console.log('\n♻️ ==================== RECYCLING TICKETS REPORT ====================');
  console.log('📥 Query params:', req.query);
  console.log('👤 User:', { id: req.user?.id, role: req.user?.role });

  try {
    const { year, start_date, end_date, sector_id, page = 1, limit = 10 } = req.query;

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

    // Date range
    const currentYear = year || new Date().getFullYear();
    const startDate = start_date || `${currentYear}-01-01`;
    const endDate = end_date || `${currentYear}-12-31`;

    console.log('📅 Date range:', startDate, 'to', endDate);

    // ✅ Sector filtering cu noua logică
    let sectorFilter = '';
    let sectorParams = [];

    if (sector_id) {
      // User cere un sector specific
      let sectorUuid = sector_id;
      
      // Convertește sector_number → UUID dacă e necesar
      if (!isNaN(sector_id) && parseInt(sector_id) >= 1 && parseInt(sector_id) <= 6) {
        const sectorQuery = await db.query(
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

      sectorFilter = 'AND wtr.sector_id = $3';
      sectorParams = [sectorUuid];
    } else {
      // User nu cere sector specific → filtrează automat la sectoarele accesibile
      if (access.accessType !== 'PLATFORM_ALL') {
        sectorFilter = 'AND wtr.sector_id = ANY($3)';
        sectorParams = [access.sectorIds];
      }
    }

    const baseParams = [startDate, endDate, ...sectorParams];

    console.log('🔍 WHERE clause built with sector filter');

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

    console.log('📊 Summary:', summaryResult.rows[0]);

    // SUPPLIERS
    const suppliersQuery = `
      SELECT 
        i.id,
        i.name,
        s.sector_name,
        wc.code,
        SUM(wtr.delivered_quantity_tons) as total_tons
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

    console.log('🏭 Suppliers:', suppliersResult.rows.length, 'rows');

    // CLIENTS
    const clientsQuery = `
      SELECT 
        i.id,
        i.name,
        SUM(wtr.accepted_quantity_tons) as total_tons
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

    console.log('♻️ Clients:', clientsResult.rows.length, 'rows');

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

    // AVAILABLE YEARS
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

    const response = {
      success: true,
      data: {
        available_years: availableYears,
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
          ticket_time: t.ticket_time,
          client_name: t.client_name,
          supplier_name: t.supplier_name,
          waste_code: t.waste_code,
          waste_description: t.waste_description,
          sector_name: t.sector_name,
          vehicle_number: t.vehicle_number,
          delivered_quantity_tons: formatNumber(t.delivered_quantity_tons),
          accepted_quantity_tons: formatNumber(t.accepted_quantity_tons),
          difference_tons: formatNumber(t.difference_tons),
          acceptance_percentage: formatNumber(t.acceptance_percentage)
        })),
        pagination: {
          current_page: parseInt(page),
          per_page: parseInt(limit),
          total_records: totalRecords,
          total_pages: Math.ceil(totalRecords / limit)
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
    };

    console.log('✅ Response:', {
      summary: response.data.summary,
      suppliers_count: response.data.suppliers.length,
      clients_count: response.data.clients.length,
      tickets_count: response.data.tickets.length
    });

    res.json(response);

  } catch (error) {
    console.error('❌ getRecyclingTickets error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch recycling tickets',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};