// src/controllers/dashboardExportController.js
import PDFDocument from 'pdfkit';
import pool from '../config/database.js';
import { createCanvas } from 'canvas';
import Chart from 'chart.js/auto';

/**
 * Export Dashboard Landfill - PROFESSIONAL PDF
 */
export const exportLandfillDashboard = async (req, res) => {
  try {
    const { year, from, to, sector_id } = req.query;
    const { visibleSectorIds = [] } = req.userAccess || {};
    
    const userName = [req.user?.firstName, req.user?.lastName]
      .filter(Boolean).join(' ') || 'Utilizator';
    const userRole = req.user?.role || 'UNKNOWN';

    // Fetch data
    const stats = await fetchDashboardData(from, to, sector_id, visibleSectorIds);

    // Create PDF - A4 Landscape for more space
    const doc = new PDFDocument({ 
      size: 'A4',
      layout: 'landscape',
      margin: 30
    });

    const filename = `raport-depozitare-${year || 'current'}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
    doc.pipe(res);

    // ===============================================
    // HEADER - Professional with gradient background
    // ===============================================
    doc.rect(0, 0, 842, 80).fill('#10b981');
    
    doc.fontSize(24).font('Helvetica-Bold').fillColor('#ffffff')
       .text('RAPORT DEPOZITARE DEȘEURI', 30, 20);
    
    doc.fontSize(10).font('Helvetica').fillColor('#ffffff')
       .text(`București, Sectoarele 1-6`, 30, 50)
       .text(`Perioada: ${from || 'Start'} - ${to || 'Prezent'}`, 500, 30, { width: 300, align: 'right' })
       .text(`Data: ${new Date().toLocaleDateString('ro-RO')}`, 500, 45, { width: 300, align: 'right' })
       .text(`Generat de: ${userName}`, 500, 60, { width: 300, align: 'right' });

    doc.fillColor('#000000'); // Reset color

    // ===============================================
    // STATS CARDS - 3 columns with colored boxes
    // ===============================================
    const cardY = 100;
    const cardWidth = 250;
    const cardHeight = 80;
    const cardGap = 20;

    // Card 1: Total Bilete
    drawStatCard(doc, 30, cardY, cardWidth, cardHeight, 
      'TOTAL BILETE', 
      (stats.summary.total_tickets || 0).toLocaleString('ro-RO'),
      'înregistrări',
      '#3b82f6');

    // Card 2: Total Tone
    drawStatCard(doc, 30 + cardWidth + cardGap, cardY, cardWidth, cardHeight,
      'CANTITATE TOTALĂ',
      parseFloat(stats.summary.total_tons || 0).toLocaleString('ro-RO', {maximumFractionDigits: 1}),
      'tone depozitate',
      '#10b981');

    // Card 3: Medie
    drawStatCard(doc, 30 + (cardWidth + cardGap) * 2, cardY, cardWidth, cardHeight,
      'MEDIE PER BILET',
      parseFloat(stats.summary.avg_weight_per_ticket || 0).toFixed(2),
      'tone / bilet',
      '#f59e0b');

    // ===============================================
    // CHARTS - Side by side
    // ===============================================
    const chartY = cardY + cardHeight + 30;
    
    // LEFT: Sector Distribution (Pie Chart)
    if (stats.bySector.length > 0) {
      const sectorChart = await generateSectorPieChart(stats.bySector);
      doc.image(sectorChart, 30, chartY, { width: 280, height: 200 });
      
      doc.fontSize(12).font('Helvetica-Bold').fillColor('#000000')
         .text('Distribuție pe Sectoare', 30, chartY + 210);
    }

    // RIGHT: Top Operators (Bar Chart)
    if (stats.topOperators.length > 0) {
      const operatorChart = await generateOperatorBarChart(stats.topOperators);
      doc.image(operatorChart, 350, chartY, { width: 450, height: 200 });
      
      doc.fontSize(12).font('Helvetica-Bold').fillColor('#000000')
         .text('Top 5 Operatori Colectare', 350, chartY + 210);
    }

    // ===============================================
    // DETAILED TABLE - Sectors breakdown
    // ===============================================
    const tableY = chartY + 250;
    drawSectorTable(doc, 30, tableY, stats.bySector, stats.summary.total_tons);

    // ===============================================
    // FOOTER
    // ===============================================
    doc.fontSize(8).font('Helvetica').fillColor('#6b7280')
       .text('Raport generat automat de Sistemul SAMD | ADIGIDMB 2026', 30, 560, { 
         width: 782, 
         align: 'center' 
       });

    doc.end();

  } catch (error) {
    console.error('💥 Export PDF error:', error);
    if (!res.headersSent) {
      res.status(500).json({ 
        success: false, 
        message: 'Eroare la generarea raportului PDF',
        error: error.message
      });
    }
  }
};

// ===============================================
// HELPER: Draw Stat Card
// ===============================================
function drawStatCard(doc, x, y, width, height, title, value, subtitle, color) {
  // Background with shadow
  doc.rect(x + 2, y + 2, width, height).fill('#e5e7eb');
  doc.rect(x, y, width, height).fillAndStroke('#ffffff', '#d1d5db');
  
  // Colored left border
  doc.rect(x, y, 5, height).fill(color);
  
  // Title
  doc.fontSize(9).font('Helvetica').fillColor('#6b7280')
     .text(title, x + 15, y + 15, { width: width - 30 });
  
  // Value
  doc.fontSize(22).font('Helvetica-Bold').fillColor('#111827')
     .text(value, x + 15, y + 35, { width: width - 30 });
  
  // Subtitle
  doc.fontSize(8).font('Helvetica').fillColor('#9ca3af')
     .text(subtitle, x + 15, y + 62, { width: width - 30 });
}

// ===============================================
// HELPER: Generate Sector Pie Chart
// ===============================================
async function generateSectorPieChart(sectors) {
  const canvas = createCanvas(400, 300);
  const ctx = canvas.getContext('2d');

  const colors = ['#7c3aed', '#e5e7eb', '#10b981', '#f59e0b', '#ec4899', '#06b6d4'];
  
  new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: sectors.map(s => `Sector ${s.sector_number}`),
      datasets: [{
        data: sectors.map(s => parseFloat(s.tons || 0)),
        backgroundColor: colors,
        borderWidth: 2,
        borderColor: '#ffffff'
      }]
    },
    options: {
      responsive: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: { font: { size: 11 }, padding: 8 }
        },
        title: {
          display: false
        }
      }
    }
  });

  return canvas.toBuffer('image/png');
}

// ===============================================
// HELPER: Generate Operator Bar Chart
// ===============================================
async function generateOperatorBarChart(operators) {
  const canvas = createCanvas(600, 300);
  const ctx = canvas.getContext('2d');

  new Chart(ctx, {
    type: 'bar',
    data: {
      labels: operators.map(op => op.name.length > 25 ? op.name.substring(0, 22) + '...' : op.name),
      datasets: [{
        label: 'Tone',
        data: operators.map(op => parseFloat(op.tons || 0)),
        backgroundColor: '#10b981',
        borderColor: '#059669',
        borderWidth: 1
      }]
    },
    options: {
      responsive: false,
      indexAxis: 'y',
      plugins: {
        legend: { display: false },
        title: { display: false }
      },
      scales: {
        x: {
          beginAtZero: true,
          grid: { display: true, color: '#e5e7eb' }
        },
        y: {
          grid: { display: false }
        }
      }
    }
  });

  return canvas.toBuffer('image/png');
}

// ===============================================
// HELPER: Draw Sector Table
// ===============================================
function drawSectorTable(doc, x, y, sectors, totalTons) {
  const colWidth = 130;
  const rowHeight = 25;
  
  // Header
  doc.rect(x, y, colWidth * 6, rowHeight).fill('#f3f4f6');
  doc.fontSize(9).font('Helvetica-Bold').fillColor('#374151');
  
  ['Sector', 'Tone', 'Procent', 'Sector', 'Tone', 'Procent'].forEach((header, i) => {
    doc.text(header, x + 10 + (i * colWidth), y + 8, { width: colWidth - 20 });
  });
  
  doc.fillColor('#000000');
  
  // Rows - 2 columns layout
  sectors.forEach((sector, idx) => {
    const col = idx % 2;
    const row = Math.floor(idx / 2);
    const cellX = x + (col * colWidth * 3);
    const cellY = y + rowHeight + (row * rowHeight);
    
    if (idx % 2 === 0) {
      doc.rect(cellX, cellY, colWidth * 3, rowHeight).fill('#ffffff');
    } else {
      doc.rect(cellX, cellY, colWidth * 3, rowHeight).fill('#f9fafb');
    }
    
    const tons = parseFloat(sector.tons || 0);
    const percent = totalTons > 0 ? ((tons / totalTons) * 100).toFixed(1) : '0.0';
    
    doc.fontSize(9).font('Helvetica').fillColor('#111827');
    doc.text(`Sector ${sector.sector_number}`, cellX + 10, cellY + 8, { width: colWidth - 20 });
    doc.text(tons.toFixed(2), cellX + colWidth + 10, cellY + 8, { width: colWidth - 20 });
    doc.text(`${percent}%`, cellX + colWidth * 2 + 10, cellY + 8, { width: colWidth - 20 });
  });
}

// ===============================================
// DATA FETCHING - Same as before
// ===============================================
async function fetchDashboardData(from, to, sectorId, visibleSectorIds) {
  let sectorWhere = '';
  let params = [from || '2024-01-01', to || new Date().toISOString().split('T')[0]];
  
  if (sectorId) {
    params.push(sectorId);
    sectorWhere = `AND wtl.sector_id = $${params.length}`;
  } else if (visibleSectorIds && visibleSectorIds.length > 0) {
    params.push(visibleSectorIds);
    sectorWhere = `AND wtl.sector_id = ANY($${params.length})`;
  }

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
    summary: summaryResult.rows[0],
    bySector: sectorResult.rows,
    topOperators: operatorResult.rows
  };
}