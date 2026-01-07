// src/controllers/dashboardExportController.js
import PDFDocument from 'pdfkit';
import pool from '../config/database.js';

export const exportLandfillDashboardPDF = async (req, res) => {
  try {
    const { year, from, to, sectorId, operatorId } = req.query;
    const { visibleSectorIds } = req.userAccess;
    
    const filters = {
      year: year || new Date().getFullYear(),
      from: from || `${year || new Date().getFullYear()}-01-01`,
      to: to || `${year || new Date().getFullYear()}-12-31`,
      sectorIds: sectorId ? [sectorId] : visibleSectorIds,
      operatorId: operatorId || null
    };

    const stats = await fetchDashboardStats(filters);
    const doc = new PDFDocument({ size: 'A4', margins: { top: 50, bottom: 50, left: 50, right: 50 } });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=raport-depozitare-${filters.year}.pdf`);
    doc.pipe(res);

    // Build PDF
    addHeader(doc, filters);
    addMetadata(doc, req.user, filters);
    doc.moveDown(1);
    addGeneralStats(doc, stats.summary);
    doc.moveDown(2);
    addMonthlyEvolution(doc, stats.monthly);
    doc.moveDown(2);
    addSectorDetails(doc, stats.bySector);
    
    doc.addPage();
    addTopOperators(doc, stats.topOperators);
    addFooter(doc);
    doc.end();

  } catch (error) {
    console.error('Export PDF error:', error);
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: 'Eroare la generarea raportului PDF' });
    }
  }
};

async function fetchDashboardStats(filters) {
  const { from, to, sectorIds } = filters;
  const summary = await pool.query(`
    SELECT COUNT(*) as total_tickets, SUM(accepted_quantity) as accepted_tons
    FROM landfill_tickets WHERE delivery_date BETWEEN $1 AND $2 AND sector_id = ANY($3) AND deleted_at IS NULL
  `, [from, to, sectorIds]);
  
  return { summary: summary.rows[0], monthly: [], bySector: [], topOperators: [] };
}

function addHeader(doc, filters) {
  doc.fontSize(20).font('Helvetica-Bold').text('RAPORT DEPOZITARE DEȘEURI', { align: 'center' });
}

function addMetadata(doc, user, filters) {
  doc.fontSize(10).text(`Perioada: ${filters.from} - ${filters.to}`);
}

function addGeneralStats(doc, stats) {
  doc.fontSize(14).font('Helvetica-Bold').text('STATISTICI GENERALE');
}

function addMonthlyEvolution(doc, monthly) {}
function addSectorDetails(doc, sectors) {}
function addTopOperators(doc, operators) {}
function addFooter(doc) {}