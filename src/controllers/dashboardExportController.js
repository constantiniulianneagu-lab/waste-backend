// src/controllers/dashboardExportController.js
import PDFDocument from 'pdfkit';
import pool from '../config/database.js';

/**
 * Export Dashboard Landfill - PDF
 * GET /api/dashboard/landfill/export
 */
export const exportLandfillDashboard = async (req, res) => {
  try {
    const { year, from, to, sector_id } = req.query;
    const { visibleSectorIds = [], role } = req.userAccess || {};
    
    // Safe user name
    const userName = [req.user?.firstName, req.user?.lastName]
      .filter(Boolean)
      .join(' ') || 'Utilizator';
    const userRole = req.user?.role || 'UNKNOWN';

    // Fetch dashboard data
    const stats = await fetchDashboardData(from, to, sector_id, visibleSectorIds);

    // Create PDF - A4 size
    const doc = new PDFDocument({ 
      size: 'A4',
      margin: 40
    });

    // Set response headers
    const filename = `raport-depozitare-${year || 'current'}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);

    // Pipe PDF to response
    doc.pipe(res);

    // HEADER
    doc.fontSize(18).font('Helvetica-Bold')
       .text('RAPORT DEPOZITARE DEȘEURI', 40, 40, { align: 'center' });
    
    doc.moveDown(0.5);
    doc.fontSize(9).font('Helvetica')
       .text(`Perioada: ${from || 'Start'} - ${to || 'Prezent'}`, 40, doc.y, { align: 'center' })
       .text(`Data: ${new Date().toLocaleDateString('ro-RO')}`, { align: 'center' })
       .text(`Generat de: ${userName} (${getRoleLabel(userRole)})`, { align: 'center' });

    doc.moveTo(40, doc.y + 5).lineTo(555, doc.y + 5).stroke();
    doc.moveDown(1);

    // STATISTICI PRINCIPALE
    doc.fontSize(12).font('Helvetica-Bold')
       .text('STATISTICI PRINCIPALE', 40, doc.y);
    doc.moveDown(0.5);

    const summary = stats.summary;
    doc.fontSize(10).font('Helvetica');
    doc.text(`Total bilete: ${summary.total_tickets || 0}`, 40);
    doc.text(`Total tone: ${parseFloat(summary.total_tons || 0).toFixed(2)}`, 40);
    doc.text(`Medie per bilet: ${parseFloat(summary.avg_weight_per_ticket || 0).toFixed(2)} tone`, 40);
    
    doc.moveDown(1);

    // SECTOARE
    if (stats.bySector.length > 0) {
      doc.fontSize(12).font('Helvetica-Bold')
         .text('DISTRIBUTIE PE SECTOARE', 40, doc.y);
      doc.moveDown(0.5);
      
      stats.bySector.forEach(sector => {
        doc.fontSize(9).font('Helvetica')
           .text(`Sector ${sector.sector_number}: ${parseFloat(sector.tons || 0).toFixed(2)} tone`, 40);
      });

      doc.moveDown(1);
    }

    // TOP OPERATORI
    if (stats.topOperators.length > 0) {
      doc.fontSize(12).font('Helvetica-Bold')
         .text('TOP 5 OPERATORI', 40, doc.y);
      doc.moveDown(0.5);
      
      stats.topOperators.forEach((op, i) => {
        doc.fontSize(9).font('Helvetica')
           .text(`${i + 1}. ${op.name}: ${parseFloat(op.tons || 0).toFixed(2)} tone`, 40);
      });
    }

    // FOOTER
    doc.fontSize(8).font('Helvetica')
       .text('Raport generat automat de Sistemul SAMD | ADIGIDMB 2026', 40, 800, { align: 'center' });

    doc.end();

  } catch (error) {
    console.error('💥 [EXPORT] Export PDF error:', error);
    console.error('💥 [EXPORT] Error stack:', error.stack);
    
    if (!res.headersSent) {
      res.status(500).json({ 
        success: false, 
        message: 'Eroare la generarea raportului PDF',
        error: error.message
      });
    }
  }
};

// DATA FETCHING - USING EXACT SAME QUERIES AS DASHBOARD
async function fetchDashboardData(from, to, sectorId, visibleSectorIds) {
  // Build WHERE clause like dashboardLandfillController
  let sectorWhere = '';
  let params = [from || '2024-01-01', to || new Date().toISOString().split('T')[0]];
  
  if (sectorId) {
    params.push(sectorId);
    sectorWhere = `AND wtl.sector_id = $${params.length}`;
  } else if (visibleSectorIds && visibleSectorIds.length > 0) {
    params.push(visibleSectorIds);
    sectorWhere = `AND wtl.sector_id = ANY($${params.length})`;
  }

  // SUMMARY STATS - exact same as dashboardLandfillController
  const summaryQuery = `
    SELECT
      COUNT(*) as total_tickets,
      COALESCE(SUM(wtl.net_weight_tons), 0) as total_tons,
      COALESCE(AVG(wtl.net_weight_tons), 0) as avg_weight_per_ticket
    FROM waste_tickets_landfill wtl
    WHERE wtl.deleted_at IS NULL
      AND wtl.ticket_date >= $1
      AND wtl.ticket_date <= $2
      ${sectorWhere}
  `;
  
  const summaryResult = await pool.query(summaryQuery, params);
  const summary = summaryResult.rows[0];

  // BY SECTOR
  const sectorQuery = `
    SELECT 
      s.sector_number,
      COALESCE(SUM(wtl.net_weight_tons), 0) as tons
    FROM sectors s
    LEFT JOIN waste_tickets_landfill wtl ON s.id = wtl.sector_id 
      AND wtl.deleted_at IS NULL
      AND wtl.ticket_date >= $1
      AND wtl.ticket_date <= $2
      ${sectorWhere.replace('wtl.sector_id', 's.id')}
    WHERE s.deleted_at IS NULL
    GROUP BY s.sector_number
    ORDER BY s.sector_number
  `;
  
  const sectorResult = await pool.query(sectorQuery, params);

  // TOP OPERATORS - using supplier_id
  const operatorQuery = `
    SELECT 
      i.name,
      COALESCE(SUM(wtl.net_weight_tons), 0) as tons
    FROM institutions i
    LEFT JOIN waste_tickets_landfill wtl ON i.id = wtl.supplier_id
      AND wtl.deleted_at IS NULL
      AND wtl.ticket_date >= $1
      AND wtl.ticket_date <= $2
      ${sectorWhere}
    WHERE i.deleted_at IS NULL
      AND i.type = 'COLECTARE'
    GROUP BY i.name
    HAVING SUM(wtl.net_weight_tons) > 0
    ORDER BY tons DESC
    LIMIT 5
  `;
  
  const operatorResult = await pool.query(operatorQuery, params);

  return {
    summary,
    bySector: sectorResult.rows,
    topOperators: operatorResult.rows
  };
}

function getRoleLabel(role) {
  const labels = {
    'PLATFORM_ADMIN': 'Administrator Platformă',
    'ADMIN_INSTITUTION': 'Administrator Instituție',
    'EDITOR_INSTITUTION': 'Editor Instituție',
    'REGULATOR_VIEWER': 'Autoritate publică'
  };
  return labels[role] || role;
}