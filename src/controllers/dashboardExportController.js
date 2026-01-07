// src/controllers/dashboardExportController.js
import PDFDocument from 'pdfkit';
import pool from '../config/database.js';

/**
 * Export Dashboard Landfill - PDF
 * GET /api/dashboard/landfill/export
 */
export const exportLandfillDashboard = async (req, res) => {
  try {
    const { year, from, to, sectorId } = req.query;
    const { visibleSectorIds = [], role } = req.userAccess || {};
    
    // Safe user name
    const userName = [req.user?.firstName, req.user?.lastName]
      .filter(Boolean)
      .join(' ') || 'Utilizator';
    const userRole = req.user?.role || 'UNKNOWN';

    // Fetch dashboard data
    const stats = await fetchDashboardData(from, to, sectorId, visibleSectorIds);

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
    doc.text(`Total tone: ${summary.total_tons || 0}`, 40);
    doc.text(`Tone acceptate: ${summary.accepted_tons || 0}`, 40);
    doc.text(`Rata acceptare: ${summary.acceptance_rate || 0}%`, 40);
    
    doc.moveDown(1);

    // SECTOARE
    doc.fontSize(12).font('Helvetica-Bold')
       .text('DISTRIBUTIE PE SECTOARE', 40, doc.y);
    doc.moveDown(0.5);
    
    stats.bySector.forEach(sector => {
      doc.fontSize(9).font('Helvetica')
         .text(`Sector ${sector.sector_number}: ${sector.tons} tone`, 40);
    });

    doc.moveDown(1);

    // TOP OPERATORI
    doc.fontSize(12).font('Helvetica-Bold')
       .text('TOP 5 OPERATORI', 40, doc.y);
    doc.moveDown(0.5);
    
    stats.topOperators.forEach((op, i) => {
      doc.fontSize(9).font('Helvetica')
         .text(`${i + 1}. ${op.name}: ${op.tons} tone`, 40);
    });

    // FOOTER
    doc.fontSize(8).font('Helvetica')
       .text('Raport generat automat de Sistemul SAMD | ADIGIDMB 2026', 40, 800, { align: 'center' });

    doc.end();

  } catch (error) {
    console.error('Export PDF error:', error);
    if (!res.headersSent) {
      res.status(500).json({ 
        success: false, 
        message: 'Eroare la generarea raportului PDF' 
      });
    }
  }
};

// DATA FETCHING
async function fetchDashboardData(from, to, sectorId, visibleSectorIds) {
  let whereClause = 'WHERE deleted_at IS NULL';
  const params = [];
  
  if (from) {
    params.push(from);
    whereClause += ` AND ticket_date >= $${params.length}`;
  }
  
  if (to) {
    params.push(to);
    whereClause += ` AND ticket_date <= $${params.length}`;
  }
  
  if (sectorId) {
    params.push(sectorId);
    whereClause += ` AND sector_id = $${params.length}`;
  } else if (visibleSectorIds && visibleSectorIds.length > 0) {
    params.push(visibleSectorIds);
    whereClause += ` AND sector_id = ANY($${params.length})`;
  }

  // Summary stats
  const summaryQuery = `
    SELECT 
      COUNT(*) as total_tickets,
      COALESCE(SUM(delivered_quantity), 0) as total_tons,
      COALESCE(SUM(accepted_quantity), 0) as accepted_tons,
      ROUND(AVG(CASE WHEN delivered_quantity > 0 THEN accepted_quantity::numeric / delivered_quantity * 100 ELSE 0 END), 1) as acceptance_rate
    FROM landfill_tickets
    ${whereClause}
  `;
  
  const summaryResult = await pool.query(summaryQuery, params);
  const summary = summaryResult.rows[0];

  // By sector
  const sectorQuery = `
    SELECT 
      s.sector_number,
      COALESCE(SUM(lt.accepted_quantity), 0) as tons
    FROM sectors s
    LEFT JOIN landfill_tickets lt ON s.id = lt.sector_id ${whereClause.replace('WHERE', 'AND')}
    WHERE s.deleted_at IS NULL
    GROUP BY s.sector_number
    ORDER BY s.sector_number
  `;
  
  const sectorResult = await pool.query(sectorQuery, params);

  // Top operators
  const operatorQuery = `
    SELECT 
      i.name,
      COALESCE(SUM(lt.accepted_quantity), 0) as tons
    FROM institutions i
    LEFT JOIN landfill_tickets lt ON i.id = lt.collection_operator_id ${whereClause.replace('WHERE', 'AND')}
    WHERE i.deleted_at IS NULL
    GROUP BY i.name
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