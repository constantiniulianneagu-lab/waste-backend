// src/controllers/contractExportController.js
/**
 * ============================================================================
 * CONTRACT EXPORT CONTROLLER V2 - PROFESSIONAL REPORTS
 * ============================================================================
 * Advanced PDF exports with summaries, amendments, and beautiful formatting
 * ============================================================================
 */

import pool from "../config/database.js";
import PDFDocument from "pdfkit";
import ExcelJS from "exceljs";

// ============================================================================
// HELPER: Get Table Alias
// ============================================================================
const getTableAlias = (contractType) => {
  switch(contractType) {
    case 'DISPOSAL': return 'dc';
    case 'TMB': return 'tc';
    case 'AEROBIC': return 'ac';
    case 'ANAEROBIC': return 'anc';
    case 'WASTE_COLLECTOR': return 'wc';
    case 'SORTING': return 'sc';
    default: return 'wc';
  }
};

// ============================================================================
// HELPER: Get Contract Type Label
// ============================================================================
const getContractTypeLabel = (contractType) => {
  const labels = {
    'DISPOSAL': 'Depozitare',
    'TMB': 'TMB',
    'AEROBIC': 'Tratare Aerobă',
    'ANAEROBIC': 'Tratare Anaerobă',
    'WASTE_COLLECTOR': 'Colectare',
    'SORTING': 'Sortare'
  };
  return labels[contractType] || contractType;
};

// ============================================================================
// HELPER: Format Number with Romanian Locale
// ============================================================================
const formatNumber = (num, decimals = 2) => {
  if (num === null || num === undefined || isNaN(num)) return '-';
  return new Intl.NumberFormat('ro-RO', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(num);
};

// ============================================================================
// HELPER: Format Date Romanian with Diacritics
// ============================================================================
const formatDate = (date) => {
  if (!date) return '-';
  const d = new Date(date);
  const months = ['ianuarie', 'februarie', 'martie', 'aprilie', 'mai', 'iunie', 
                  'iulie', 'august', 'septembrie', 'octombrie', 'noiembrie', 'decembrie'];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
};

// ============================================================================
// HELPER: Safe Text for PDF (handles Romanian diacritics)
// ============================================================================
const safeText = (text) => {
  if (!text) return '';
  // Replace problematic Romanian characters with safe equivalents for WinAnsiEncoding
  return text
    .replace(/ă/g, 'a').replace(/Ă/g, 'A')
    .replace(/â/g, 'a').replace(/Â/g, 'A')
    .replace(/î/g, 'i').replace(/Î/g, 'I')
    .replace(/ș/g, 's').replace(/Ș/g, 'S')
    .replace(/ț/g, 't').replace(/Ț/g, 'T');
};

// ============================================================================
// HELPER: Get Contracts Data with Amendments
// ============================================================================
const getContractsData = async (contractType, filters = {}) => {
  let query = '';
  const params = [];
  let paramCount = 1;

  switch (contractType) {
    case 'DISPOSAL':
      query = `
        SELECT 
          dc.id,
          dc.contract_number,
          dc.contract_date_start,
          dc.contract_date_end,
          dc.is_active,
          i.name as operator_name,
          s.sector_number,
          dcs.tariff_per_ton,
          dcs.cec_tax_per_ton,
          dcs.contracted_quantity_tons,
          (dcs.tariff_per_ton + dcs.cec_tax_per_ton) as total_per_ton,
          (dcs.contracted_quantity_tons * (dcs.tariff_per_ton + dcs.cec_tax_per_ton)) as total_value,
          dc.attribution_type,
          COALESCE(
            (SELECT dca.new_contract_date_end 
             FROM disposal_contract_amendments dca 
             WHERE dca.contract_id = dc.id AND dca.deleted_at IS NULL 
             ORDER BY dca.amendment_date DESC LIMIT 1),
            dc.contract_date_end
          ) as effective_date_end
        FROM disposal_contracts dc
        LEFT JOIN institutions i ON dc.institution_id = i.id
        LEFT JOIN disposal_contract_sectors dcs ON dc.id = dcs.contract_id AND dcs.deleted_at IS NULL
        LEFT JOIN sectors s ON dcs.sector_id = s.id
        WHERE dc.deleted_at IS NULL
      `;
      break;

    case 'TMB':
      query = `
        SELECT 
          tc.id,
          tc.contract_number,
          tc.contract_date_start,
          tc.contract_date_end,
          tc.is_active,
          i.name as operator_name,
          s.sector_number,
          tc.tariff_per_ton,
          NULL as cec_tax_per_ton,
          tc.estimated_quantity_tons as contracted_quantity_tons,
          tc.tariff_per_ton as total_per_ton,
          (tc.estimated_quantity_tons * tc.tariff_per_ton) as total_value,
          tc.attribution_type,
          tc.indicator_recycling_percent,
          tc.indicator_energy_recovery_percent,
          tc.indicator_disposal_percent,
          COALESCE(
            (SELECT tca.new_contract_date_end 
             FROM tmb_contract_amendments tca 
             WHERE tca.contract_id = tc.id AND tca.deleted_at IS NULL 
             ORDER BY tca.amendment_date DESC LIMIT 1),
            tc.contract_date_end
          ) as effective_date_end
        FROM tmb_contracts tc
        LEFT JOIN institutions i ON tc.institution_id = i.id
        LEFT JOIN sectors s ON tc.sector_id = s.id
        WHERE tc.deleted_at IS NULL
      `;
      break;

    case 'AEROBIC':
      query = `
        SELECT 
          ac.id,
          ac.contract_number,
          ac.contract_date_start,
          ac.contract_date_end,
          ac.is_active,
          i.name as operator_name,
          s.sector_number,
          ac.tariff_per_ton,
          NULL as cec_tax_per_ton,
          ac.estimated_quantity_tons as contracted_quantity_tons,
          ac.tariff_per_ton as total_per_ton,
          (ac.estimated_quantity_tons * ac.tariff_per_ton) as total_value,
          ac.attribution_type,
          ac.indicator_disposal_percent,
          ai.name as associate_name,
          COALESCE(
            (SELECT aca.new_contract_date_end 
             FROM aerobic_contract_amendments aca 
             WHERE aca.contract_id = ac.id AND aca.deleted_at IS NULL 
             ORDER BY aca.amendment_date DESC LIMIT 1),
            ac.contract_date_end
          ) as effective_date_end
        FROM aerobic_contracts ac
        LEFT JOIN institutions i ON ac.institution_id = i.id
        LEFT JOIN sectors s ON ac.sector_id = s.id
        LEFT JOIN institutions ai ON ac.associate_institution_id = ai.id
        WHERE ac.deleted_at IS NULL
      `;
      break;

    case 'ANAEROBIC':
      query = `
        SELECT 
          anc.id,
          anc.contract_number,
          anc.contract_date_start,
          anc.contract_date_end,
          anc.is_active,
          i.name as operator_name,
          s.sector_number,
          anc.tariff_per_ton,
          NULL as cec_tax_per_ton,
          anc.estimated_quantity_tons as contracted_quantity_tons,
          anc.tariff_per_ton as total_per_ton,
          (anc.estimated_quantity_tons * anc.tariff_per_ton) as total_value,
          anc.attribution_type,
          anc.indicator_disposal_percent,
          ai.name as associate_name,
          COALESCE(
            (SELECT anca.new_contract_date_end 
             FROM anaerobic_contract_amendments anca 
             WHERE anca.contract_id = anc.id AND anca.deleted_at IS NULL 
             ORDER BY anca.amendment_date DESC LIMIT 1),
            anc.contract_date_end
          ) as effective_date_end
        FROM anaerobic_contracts anc
        LEFT JOIN institutions i ON anc.institution_id = i.id
        LEFT JOIN sectors s ON anc.sector_id = s.id
        LEFT JOIN institutions ai ON anc.associate_institution_id = ai.id
        WHERE anc.deleted_at IS NULL
      `;
      break;

    case 'WASTE_COLLECTOR':
      query = `
        SELECT 
          wc.id,
          wc.contract_number,
          wc.contract_date_start,
          wc.contract_date_end,
          wc.is_active,
          i.name as operator_name,
          s.sector_number,
          NULL as tariff_per_ton,
          NULL as cec_tax_per_ton,
          NULL as contracted_quantity_tons,
          NULL as total_per_ton,
          NULL as total_value,
          wc.attribution_type,
          COALESCE(
            (SELECT wca.new_contract_date_end 
             FROM waste_collector_contract_amendments wca 
             WHERE wca.contract_id = wc.id AND wca.deleted_at IS NULL 
             ORDER BY wca.amendment_date DESC LIMIT 1),
            wc.contract_date_end
          ) as effective_date_end
        FROM waste_collector_contracts wc
        LEFT JOIN institutions i ON wc.institution_id = i.id
        LEFT JOIN sectors s ON wc.sector_id = s.id
        WHERE wc.deleted_at IS NULL
      `;
      break;

    case 'SORTING':
      query = `
        SELECT 
          sc.id,
          sc.contract_number,
          sc.contract_date_start,
          sc.contract_date_end,
          sc.is_active,
          i.name as operator_name,
          s.sector_number,
          NULL as tariff_per_ton,
          NULL as cec_tax_per_ton,
          NULL as contracted_quantity_tons,
          NULL as total_per_ton,
          NULL as total_value,
          sc.attribution_type,
          COALESCE(
            (SELECT sca.new_contract_date_end 
             FROM sorting_contract_amendments sca 
             WHERE sca.contract_id = sc.id AND sca.deleted_at IS NULL 
             ORDER BY sca.amendment_date DESC LIMIT 1),
            sc.contract_date_end
          ) as effective_date_end
        FROM sorting_contracts sc
        LEFT JOIN institutions i ON sc.institution_id = i.id
        LEFT JOIN sectors s ON sc.sector_id = s.id
        WHERE sc.deleted_at IS NULL
      `;
      break;

    default:
      throw new Error('Invalid contract type');
  }

  // Add filters
  const whereConditions = [];
  
  if (filters.sector_id) {
    whereConditions.push(`s.id = $${paramCount}`);
    params.push(filters.sector_id);
    paramCount++;
  }

  if (filters.is_active !== undefined) {
    const isActive = filters.is_active === 'true' || filters.is_active === true;
    const alias = getTableAlias(contractType);
    whereConditions.push(`${alias}.is_active = $${paramCount}`);
    params.push(isActive);
    paramCount++;
  }

  if (whereConditions.length > 0) {
    query += ' AND ' + whereConditions.join(' AND ');
  }

  const alias = getTableAlias(contractType);
  query += ` ORDER BY s.sector_number, ${alias}.contract_date_start DESC`;

  const result = await pool.query(query, params);
  return result.rows;
};

// ============================================================================
// HELPER: Get Amendments for Contracts
// ============================================================================
const getAmendments = async (contractType, contractIds) => {
  if (!contractIds || contractIds.length === 0) return {};

  let table = '';
  switch (contractType) {
    case 'DISPOSAL': table = 'disposal_contract_amendments'; break;
    case 'TMB': table = 'tmb_contract_amendments'; break;
    case 'AEROBIC': table = 'aerobic_contract_amendments'; break;
    case 'ANAEROBIC': table = 'anaerobic_contract_amendments'; break;
    case 'WASTE_COLLECTOR': table = 'waste_collector_contract_amendments'; break;
    case 'SORTING': table = 'sorting_contract_amendments'; break;
    default: return {};
  }

  const query = `
    SELECT 
      contract_id,
      amendment_number,
      amendment_date,
      new_contract_date_end,
      notes
    FROM ${table}
    WHERE contract_id = ANY($1::int[])
      AND deleted_at IS NULL
    ORDER BY contract_id, amendment_date
  `;

  const result = await pool.query(query, [contractIds]);
  
  // Group by contract_id
  const grouped = {};
  result.rows.forEach(row => {
    if (!grouped[row.contract_id]) {
      grouped[row.contract_id] = [];
    }
    grouped[row.contract_id].push(row);
  });

  return grouped;
};

// ============================================================================
// EXPORT PDF - PROFESSIONAL VERSION
// ============================================================================
export const exportContractsPDF = async (req, res) => {
  try {
    const { contractType = 'DISPOSAL' } = req.query;
    const contracts = await getContractsData(contractType, req.query);
    
    // Get amendments for all contracts
    const contractIds = contracts.map(c => c.id);
    const amendments = await getAmendments(contractType, contractIds);

    // Separate active and expired
    const now = new Date();
    const activeContracts = contracts.filter(c => new Date(c.effective_date_end) >= now);
    const expiredContracts = contracts.filter(c => new Date(c.effective_date_end) < now);

    // Calculate totals - ONLY ACTIVE CONTRACTS
    const totalQuantity = activeContracts.reduce((sum, c) => sum + (parseFloat(c.contracted_quantity_tons) || 0), 0);
    const totalValue = activeContracts.reduce((sum, c) => sum + (parseFloat(c.total_value) || 0), 0);

    // Sector summary - ONLY ACTIVE CONTRACTS
    const sectorSummary = {};
    activeContracts.forEach(c => {
      const sector = c.sector_number || 'N/A';
      if (!sectorSummary[sector]) {
        sectorSummary[sector] = { count: 0, quantity: 0, value: 0, amendments: 0 };
      }
      sectorSummary[sector].count++;
      sectorSummary[sector].quantity += parseFloat(c.contracted_quantity_tons) || 0;
      sectorSummary[sector].value += parseFloat(c.total_value) || 0;
      sectorSummary[sector].amendments += (amendments[c.id] || []).length;
    });

    const doc = new PDFDocument({ 
      size: 'A4', 
      margin: 40,
      bufferPages: true,
      info: {
        Title: `Raport Contracte ${getContractTypeLabel(contractType)}`,
        Author: 'WasteApp - ADIGIDMB București',
        Subject: 'Raport Export Contracte',
        Keywords: 'contracte, deșeuri, raport'
      }
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=raport-contracte-${contractType.toLowerCase()}-${Date.now()}.pdf`);

    doc.pipe(res);

    // Register Romanian font for diacritics
    doc.registerFont('Regular', 'Helvetica');
    doc.registerFont('Bold', 'Helvetica-Bold');

    let pageNumber = 0;

    // Helper: Add page header
    const addPageHeader = () => {
      pageNumber++;
      doc.fontSize(8)
         .fillColor('#666666')
         .text(`Raport Contracte ${getContractTypeLabel(contractType)}`, 40, 30, { align: 'left' })
         .text(`Pagina ${pageNumber}`, 0, 30, { align: 'right', width: doc.page.width - 80 });
    };

    // Helper: Add page footer
    const addPageFooter = () => {
      const bottom = doc.page.height - 40;
      doc.fontSize(7)
         .fillColor('#999999')
         .text('Generat de WasteApp - ADIGIDMB București', 40, bottom, { align: 'center', width: doc.page.width - 80 });
    };

    // ========================================================================
    // PAGE 1: TITLE & EXECUTIVE SUMMARY
    // ========================================================================
    addPageHeader();

    // Title
    doc.fontSize(24)
       .font('Bold')
       .fillColor('#047857')
       .text(`RAPORT CONTRACTE`, 40, 80, { align: 'center' });
    
    doc.fontSize(18)
       .fillColor('#059669')
       .text(getContractTypeLabel(contractType).toUpperCase(), { align: 'center' });

    // Generation date
    doc.moveDown(1);
    doc.fontSize(10)
       .fillColor('#666666')
       .font('Regular')
       .text(`Generat la: ${formatDate(new Date())}`, { align: 'center' });

    // SAMD Source
    doc.moveDown(0.3);
    doc.fontSize(8)
       .fillColor('#999999')
       .text(safeText('Date din SAMD - Sistem Avansat de Monitorizare Deseuri'), { align: 'center' });

    // Applied filters
    if (req.query.sector_id || req.query.is_active) {
      doc.moveDown(0.5);
      let filterText = 'Filtre aplicate: ';
      if (req.query.sector_id) filterText += `Sectorul ${req.query.sector_id}`;
      if (req.query.is_active) {
        if (req.query.sector_id) filterText += ', ';
        filterText += req.query.is_active === 'true' ? 'Doar contracte active' : 'Doar contracte inactive';
      }
      doc.fontSize(9)
         .fillColor('#666666')
         .text(filterText, { align: 'center' });
    }

    // Executive Summary Box
    doc.moveDown(3);
    const summaryY = doc.y;
    doc.roundedRect(40, summaryY, doc.page.width - 80, 140, 5)
       .fillAndStroke('#F0FDF4', '#059669');

    doc.fontSize(12)
       .font('Bold')
       .fillColor('#047857')
       .text('SUMAR EXECUTIV', 60, summaryY + 15);

    doc.fontSize(10)
       .font('Regular')
       .fillColor('#333333');

    const summaryData = [
      { label: safeText('Total contracte:'), value: `${contracts.length} (${activeContracts.length} active, ${expiredContracts.length} expirate)` },
      { label: safeText('Cantitate totala estimata (active):'), value: `${formatNumber(totalQuantity, 2)} tone` },
      { label: safeText('Valoare totala estimata (active):'), value: `${formatNumber(totalValue, 2)} RON` },
      { label: safeText('Perioada acoperita (active):'), value: activeContracts.length > 0 ? `${new Date(Math.min(...activeContracts.map(c => new Date(c.contract_date_start)))).getFullYear()} - ${new Date(Math.max(...activeContracts.map(c => new Date(c.effective_date_end)))).getFullYear()}` : 'N/A' }
    ];

    let summaryTextY = summaryY + 40;
    summaryData.forEach(item => {
      doc.fontSize(9)
         .fillColor('#666666')
         .text(item.label, 60, summaryTextY)
         .fontSize(10)
         .fillColor('#047857')
         .font('Bold')
         .text(item.value, 220, summaryTextY);
      summaryTextY += 20;
    });

    // Sector Summary Table
    doc.moveDown(4);
    doc.fontSize(12)
       .font('Bold')
       .fillColor('#047857')
       .text('CENTRALIZATOR PE SECTOARE', 40);

    doc.moveDown(0.5);
    const sectorTableY = doc.y;
    
    // Table header
    doc.roundedRect(40, sectorTableY, doc.page.width - 80, 25, 3)
       .fillAndStroke('#047857', '#047857');
    
    doc.fontSize(9)
       .font('Bold')
       .fillColor('#FFFFFF')
       .text('Sector', 50, sectorTableY + 8, { width: 70 })
       .text('Contracte', 130, sectorTableY + 8, { width: 60 })
       .text(safeText('Acte aditionale'), 200, sectorTableY + 8, { width: 80 })
       .text('Cantitate (t)', 290, sectorTableY + 8, { width: 90 })
       .text('Valoare (RON)', 390, sectorTableY + 8, { width: 130 });

    let tableY = sectorTableY + 25;
    Object.keys(sectorSummary).sort().forEach((sector, idx) => {
      const data = sectorSummary[sector];
      const bgColor = idx % 2 === 0 ? '#F9FAFB' : '#FFFFFF';
      
      doc.rect(40, tableY, doc.page.width - 80, 20)
         .fillAndStroke(bgColor, '#E5E7EB');

      doc.fontSize(9)
         .font('Regular')
         .fillColor('#333333')
         .text(`Sectorul ${sector}`, 50, tableY + 5, { width: 70 })
         .text(data.count.toString(), 130, tableY + 5, { width: 60, align: 'center' })
         .text(data.amendments.toString(), 200, tableY + 5, { width: 80, align: 'center' })
         .text(formatNumber(data.quantity, 2), 290, tableY + 5, { width: 90 })
         .text(formatNumber(data.value, 2), 390, tableY + 5, { width: 130 });

      tableY += 20;
    });

    // ========================================================================
    // PAGE 2+: ACTIVE CONTRACTS
    // ========================================================================
    if (activeContracts.length > 0) {
      doc.addPage();
      addPageHeader();

      doc.fontSize(16)
         .font('Bold')
         .fillColor('#047857')
         .text(`CONTRACTE ACTIVE (${activeContracts.length})`, 40, 60);

      doc.moveDown(1);

      activeContracts.forEach((contract, idx) => {
        const contractAmendments = amendments[contract.id] || [];
        
        // Check if we need a new page
        const requiredSpace = 180 + (contractAmendments.length * 15);
        if (doc.y + requiredSpace > doc.page.height - 100) {
          doc.addPage();
          addPageHeader();
          doc.moveDown(2);
        }

        const cardY = doc.y;
        
        // Contract number header (colored bar only - no full card border)
        doc.roundedRect(40, cardY, doc.page.width - 80, 35, 8)
           .fillAndStroke('#10B981', '#10B981');

        doc.fontSize(14)
           .font('Bold')
           .fillColor('#FFFFFF')
           .text(safeText(contract.contract_number), 55, cardY + 10);

        doc.fontSize(9)
           .font('Regular')
           .fillColor('#FFFFFF')
           .text(safeText('ACTIV'), doc.page.width - 130, cardY + 12);

        // Contract details (no border, just content)
        let detailY = cardY + 45;
        
        doc.fontSize(9)
           .font('Bold')
           .fillColor('#666666')
           .text('Operator:', 55, detailY)
           .font('Regular')
           .fillColor('#333333');
        
        // Build operator text with associate (for ALL contract types)
        let operatorText = safeText(contract.operator_name || '-');
        if (contract.associate_name) {
          operatorText += safeText(` - ${contract.associate_name} (asociat)`);
        }
        doc.text(operatorText, 150, detailY, { width: doc.page.width - 200 });

        detailY += 15;
        doc.font('Bold')
           .fillColor('#666666')
           .text('UAT:', 55, detailY)
           .font('Regular')
           .fillColor('#333333')
           .text(safeText(`Sectorul ${contract.sector_number || 'N/A'}`), 150, detailY);

        detailY += 15;
        doc.font('Bold')
           .fillColor('#666666')
           .text(safeText('Perioada:'), 55, detailY)
           .font('Regular')
           .fillColor('#333333')
           .text(`${formatDate(contract.contract_date_start)} - ${formatDate(contract.effective_date_end)}`, 150, detailY);

        // Financial details
        if (contract.tariff_per_ton) {
          detailY += 20;
          doc.moveTo(55, detailY).lineTo(doc.page.width - 55, detailY).stroke('#E5E7EB');
          detailY += 10;

          doc.fontSize(9)
             .font('Bold')
             .fillColor('#666666')
             .text('Tarif:', 55, detailY)
             .font('Regular')
             .fillColor('#333333')
             .text(`${formatNumber(contract.tariff_per_ton, 2)} RON/t`, 150, detailY);

          if (contract.cec_tax_per_ton) {
            doc.font('Bold')
               .fillColor('#666666')
               .text('Taxa CEC:', 280, detailY)
               .font('Regular')
               .fillColor('#333333')
               .text(`${formatNumber(contract.cec_tax_per_ton, 2)} RON/t`, 350, detailY);
          }

          detailY += 15;
          doc.font('Bold')
             .fillColor('#666666')
             .text('Cantitate:', 55, detailY)
             .font('Regular')
             .fillColor('#333333')
             .text(`${formatNumber(contract.contracted_quantity_tons, 2)} tone`, 150, detailY);

          doc.font('Bold')
             .fillColor('#666666')
             .text('Valoare:', 280, detailY)
             .font('Regular')
             .fillColor('#047857')
             .text(`${formatNumber(contract.total_value, 2)} RON`, 350, detailY);
        }

        // Amendments
        if (contractAmendments.length > 0) {
          detailY += 20;
          doc.moveTo(55, detailY).lineTo(doc.page.width - 55, detailY).stroke('#E5E7EB');
          detailY += 10;

          doc.fontSize(9)
             .font('Bold')
             .fillColor('#666666')
             .text(safeText(`Acte aditionale (${contractAmendments.length}):`), 55, detailY);

          detailY += 18;
          contractAmendments.forEach((amendment, aIdx) => {
            // Amendment header
            doc.fontSize(8)
               .font('Bold')
               .fillColor('#047857')
               .text(safeText(`Act ${amendment.amendment_number || (aIdx + 1).toString()}`), 65, detailY);
            
            doc.fontSize(7)
               .font('Regular')
               .fillColor('#666666')
               .text(`(${formatDate(amendment.amendment_date)})`, 120, detailY + 1);
            
            detailY += 12;
            
            // Amendment details
            const hasEndDate = amendment.new_contract_date_end && amendment.new_contract_date_end !== contract.contract_date_end;
            
            if (hasEndDate) {
              doc.fontSize(8)
                 .font('Regular')
                 .fillColor('#333333')
                 .text(safeText('Tip: Prelungire'), 70, detailY);
              detailY += 10;
              doc.text(safeText(`Data noua: ${formatDate(amendment.new_contract_date_end)}`), 70, detailY);
              detailY += 10;
            }
            
            if (amendment.notes) {
              doc.fontSize(7)
                 .font('Regular')
                 .fillColor('#666666')
                 .text(safeText(`Observatii: ${amendment.notes}`), 70, detailY, { width: doc.page.width - 130 });
              detailY += 12;
            }
            
            detailY += 8;
          });
        }

        // Bottom separator
        doc.moveTo(40, doc.y + 10).lineTo(doc.page.width - 40, doc.y + 10).stroke('#E5E7EB');
        doc.moveDown(3);
      });
    }

    // ========================================================================
    // EXPIRED CONTRACTS
    // ========================================================================
    if (expiredContracts.length > 0) {
      doc.addPage();
      addPageHeader();

      doc.fontSize(16)
         .font('Bold')
         .fillColor('#DC2626')
         .text(`CONTRACTE EXPIRATE (${expiredContracts.length})`, 40, 60);

      doc.moveDown(1);

      expiredContracts.forEach((contract) => {
        const contractAmendments = amendments[contract.id] || [];
        
        const requiredSpace = 180 + (contractAmendments.length * 15);
        if (doc.y + requiredSpace > doc.page.height - 100) {
          doc.addPage();
          addPageHeader();
          doc.moveDown(2);
        }

        const cardY = doc.y;
        
        // Contract number header (red bar - no full card border)
        doc.roundedRect(40, cardY, doc.page.width - 80, 35, 8)
           .fillAndStroke('#DC2626', '#DC2626');

        doc.fontSize(14)
           .font('Bold')
           .fillColor('#FFFFFF')
           .text(safeText(contract.contract_number), 55, cardY + 10);

        doc.fontSize(9)
           .font('Regular')
           .fillColor('#FFFFFF')
           .text(safeText('EXPIRAT'), doc.page.width - 130, cardY + 12);

        // Contract details (no border)
        let detailY = cardY + 45;
        
        doc.fontSize(9)
           .font('Bold')
           .fillColor('#666666')
           .text('Operator:', 55, detailY)
           .font('Regular')
           .fillColor('#333333');
        
        // Build operator text with associate (for ALL contract types)
        let operatorText = safeText(contract.operator_name || '-');
        if (contract.associate_name) {
          operatorText += safeText(` - ${contract.associate_name} (asociat)`);
        }
        doc.text(operatorText, 150, detailY, { width: doc.page.width - 200 });

        detailY += 15;
        doc.font('Bold')
           .fillColor('#666666')
           .text('UAT:', 55, detailY)
           .font('Regular')
           .fillColor('#333333')
           .text(`Sectorul ${contract.sector_number || 'N/A'}`, 150, detailY);

        detailY += 15;
        doc.font('Bold')
           .fillColor('#666666')
           .text(safeText('Perioada:'), 55, detailY)
           .font('Regular')
           .fillColor('#DC2626')
           .text(`${formatDate(contract.contract_date_start)} - ${formatDate(contract.effective_date_end)}`, 150, detailY);

        if (contract.tariff_per_ton) {
          detailY += 20;
          doc.moveTo(55, detailY).lineTo(doc.page.width - 55, detailY).stroke('#E5E7EB');
          detailY += 10;

          doc.fontSize(9)
             .font('Bold')
             .fillColor('#666666')
             .text('Tarif:', 55, detailY)
             .font('Regular')
             .fillColor('#333333')
             .text(`${formatNumber(contract.tariff_per_ton, 2)} RON/t`, 150, detailY);

          if (contract.cec_tax_per_ton) {
            doc.font('Bold')
               .fillColor('#666666')
               .text('Taxa CEC:', 280, detailY)
               .font('Regular')
               .fillColor('#333333')
               .text(`${formatNumber(contract.cec_tax_per_ton, 2)} RON/t`, 350, detailY);
          }

          detailY += 15;
          doc.font('Bold')
             .fillColor('#666666')
             .text('Cantitate:', 55, detailY)
             .font('Regular')
             .fillColor('#333333')
             .text(`${formatNumber(contract.contracted_quantity_tons, 2)} tone`, 150, detailY);

          doc.font('Bold')
             .fillColor('#666666')
             .text('Valoare:', 280, detailY)
             .font('Regular')
             .fillColor('#333333')
             .text(`${formatNumber(contract.total_value, 2)} RON`, 350, detailY);
        }

        if (contractAmendments.length > 0) {
          detailY += 20;
          doc.moveTo(55, detailY).lineTo(doc.page.width - 55, detailY).stroke('#E5E7EB');
          detailY += 10;

          doc.fontSize(9)
             .font('Bold')
             .fillColor('#666666')
             .text(safeText(`Acte aditionale (${contractAmendments.length}):`), 55, detailY);

          detailY += 18;
          contractAmendments.forEach((amendment, aIdx) => {
            // Amendment header
            doc.fontSize(8)
               .font('Bold')
               .fillColor('#DC2626')
               .text(safeText(`Act ${amendment.amendment_number || (aIdx + 1).toString()}`), 65, detailY);
            
            doc.fontSize(7)
               .font('Regular')
               .fillColor('#666666')
               .text(`(${formatDate(amendment.amendment_date)})`, 120, detailY + 1);
            
            detailY += 12;
            
            // Amendment details
            const hasEndDate = amendment.new_contract_date_end && amendment.new_contract_date_end !== contract.contract_date_end;
            
            if (hasEndDate) {
              doc.fontSize(8)
                 .font('Regular')
                 .fillColor('#333333')
                 .text(safeText('Tip: Prelungire'), 70, detailY);
              detailY += 10;
              doc.text(safeText(`Data noua: ${formatDate(amendment.new_contract_date_end)}`), 70, detailY);
              detailY += 10;
            }
            
            if (amendment.notes) {
              doc.fontSize(7)
                 .font('Regular')
                 .fillColor('#666666')
                 .text(safeText(`Observatii: ${amendment.notes}`), 70, detailY, { width: doc.page.width - 130 });
              detailY += 12;
            }
            
            detailY += 8;
          });
        }

        // Bottom separator
        doc.moveTo(40, doc.y + 10).lineTo(doc.page.width - 40, doc.y + 10).stroke('#E5E7EB');
        doc.moveDown(3);
      });

      addPageFooter();
    }

    doc.end();

  } catch (error) {
    console.error('PDF export error:', error);
    res.status(500).json({ success: false, message: 'Eroare la generarea PDF' });
  }
};

// ============================================================================
// EXPORT EXCEL (keep existing implementation but with amendments)
// ============================================================================
export const exportContractsExcel = async (req, res) => {
  try {
    const { contractType = 'DISPOSAL' } = req.query;
    const contracts = await getContractsData(contractType, req.query);
    const contractIds = contracts.map(c => c.id);
    const amendments = await getAmendments(contractType, contractIds);

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Contracte');

    // Define columns based on contract type
    if (contractType === 'DISPOSAL') {
      worksheet.columns = [
        { header: 'Nr. Contract', key: 'contract_number', width: 20 },
        { header: 'Operator', key: 'operator_name', width: 30 },
        { header: 'Sector', key: 'sector_number', width: 10 },
        { header: 'Data Start', key: 'contract_date_start', width: 15 },
        { header: 'Data Sfârșit', key: 'contract_date_end', width: 15 },
        { header: 'Tarif (RON/t)', key: 'tariff_per_ton', width: 15 },
        { header: 'Taxa CEC (RON/t)', key: 'cec_tax_per_ton', width: 15 },
        { header: 'Cantitate (tone)', key: 'contracted_quantity_tons', width: 18 },
        { header: 'Valoare Totală (RON)', key: 'total_value', width: 20 },
        { header: 'Status', key: 'is_active', width: 12 },
        { header: 'Tip Atribuire', key: 'attribution_type', width: 20 },
        { header: 'Acte Adiționale', key: 'amendments_count', width: 18 },
      ];
    } else if (contractType === 'TMB' || contractType === 'AEROBIC' || contractType === 'ANAEROBIC') {
      worksheet.columns = [
        { header: 'Nr. Contract', key: 'contract_number', width: 20 },
        { header: 'Operator', key: 'operator_name', width: 30 },
        { header: 'Sector', key: 'sector_number', width: 10 },
        { header: 'Data Start', key: 'contract_date_start', width: 15 },
        { header: 'Data Sfârșit', key: 'contract_date_end', width: 15 },
        { header: 'Tarif (RON/t)', key: 'tariff_per_ton', width: 15 },
        { header: 'Cantitate (tone)', key: 'contracted_quantity_tons', width: 18 },
        { header: 'Valoare Totală (RON)', key: 'total_value', width: 20 },
        ...(contractType === 'TMB' ? [
          { header: 'Reciclare (%)', key: 'indicator_recycling_percent', width: 15 },
          { header: 'Valorificare Energetică (%)', key: 'indicator_energy_recovery_percent', width: 25 },
        ] : []),
        { header: 'Depozitare (%)', key: 'indicator_disposal_percent', width: 15 },
        { header: 'Status', key: 'is_active', width: 12 },
        ...(contractType !== 'TMB' ? [
          { header: 'Asociat', key: 'associate_name', width: 30 },
        ] : []),
        { header: 'Acte Adiționale', key: 'amendments_count', width: 18 },
      ];
    } else {
      worksheet.columns = [
        { header: 'Nr. Contract', key: 'contract_number', width: 20 },
        { header: 'Operator', key: 'operator_name', width: 30 },
        { header: 'Sector', key: 'sector_number', width: 10 },
        { header: 'Data Start', key: 'contract_date_start', width: 15 },
        { header: 'Data Sfârșit', key: 'contract_date_end', width: 15 },
        { header: 'Status', key: 'is_active', width: 12 },
        { header: 'Tip Atribuire', key: 'attribution_type', width: 20 },
        { header: 'Acte Adiționale', key: 'amendments_count', width: 18 },
      ];
    }

    // Style header row
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF047857' }
    };
    worksheet.getRow(1).font = { color: { argb: 'FFFFFFFF' }, bold: true };

    // Add data rows
    contracts.forEach(contract => {
      const contractAmendments = amendments[contract.id] || [];
      
      const row = {
        contract_number: contract.contract_number,
        operator_name: contract.operator_name || '-',
        sector_number: contract.sector_number ? `Sectorul ${contract.sector_number}` : '-',
        contract_date_start: contract.contract_date_start ? new Date(contract.contract_date_start).toLocaleDateString('ro-RO') : '-',
        contract_date_end: contract.effective_date_end ? new Date(contract.effective_date_end).toLocaleDateString('ro-RO') : '-',
        is_active: contract.is_active ? 'Activ' : 'Inactiv',
        amendments_count: contractAmendments.length
      };

      const safeNumber = (val) => {
        if (val === null || val === undefined) return 0;
        const num = parseFloat(val);
        return isNaN(num) ? 0 : num;
      };

      if (contractType === 'DISPOSAL') {
        row.tariff_per_ton = safeNumber(contract.tariff_per_ton);
        row.cec_tax_per_ton = safeNumber(contract.cec_tax_per_ton);
        row.contracted_quantity_tons = safeNumber(contract.contracted_quantity_tons);
        row.total_value = safeNumber(contract.total_value);
        row.attribution_type = contract.attribution_type === 'PUBLIC_TENDER' ? 'Licitație deschisă' : 'Negociere fără publicare';
      } else if (contractType === 'TMB' || contractType === 'AEROBIC' || contractType === 'ANAEROBIC') {
        row.tariff_per_ton = safeNumber(contract.tariff_per_ton);
        row.contracted_quantity_tons = safeNumber(contract.contracted_quantity_tons);
        row.total_value = safeNumber(contract.total_value);
        if (contractType === 'TMB') {
          row.indicator_recycling_percent = safeNumber(contract.indicator_recycling_percent);
          row.indicator_energy_recovery_percent = safeNumber(contract.indicator_energy_recovery_percent);
        }
        row.indicator_disposal_percent = safeNumber(contract.indicator_disposal_percent);
        if (contractType === 'AEROBIC' || contractType === 'ANAEROBIC') {
          row.associate_name = contract.associate_name || '-';
        }
      } else {
        row.attribution_type = contract.attribution_type === 'PUBLIC_TENDER' ? 'Licitație deschisă' : 'Negociere fără publicare';
      }

      worksheet.addRow(row);
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=contracte-${contractType.toLowerCase()}-${Date.now()}.xlsx`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('Excel export error:', error);
    res.status(500).json({ success: false, message: 'Eroare la generarea Excel' });
  }
};

// ============================================================================
// EXPORT CSV
// ============================================================================
export const exportContractsCSV = async (req, res) => {
  try {
    const { contractType = 'DISPOSAL' } = req.query;
    const contracts = await getContractsData(contractType, req.query);
    const contractIds = contracts.map(c => c.id);
    const amendments = await getAmendments(contractType, contractIds);

    let headers = [];
    if (contractType === 'DISPOSAL') {
      headers = ['Nr. Contract', 'Operator', 'Sector', 'Data Start', 'Data Sfârșit', 'Tarif (RON/t)', 'Taxa CEC (RON/t)', 'Cantitate (tone)', 'Valoare Totală (RON)', 'Status', 'Tip Atribuire', 'Acte Adiționale'];
    } else if (contractType === 'TMB') {
      headers = ['Nr. Contract', 'Operator', 'Sector', 'Data Start', 'Data Sfârșit', 'Tarif (RON/t)', 'Cantitate (tone)', 'Valoare Totală (RON)', 'Reciclare (%)', 'Valorificare Energetică (%)', 'Depozitare (%)', 'Status', 'Acte Adiționale'];
    } else if (contractType === 'AEROBIC' || contractType === 'ANAEROBIC') {
      headers = ['Nr. Contract', 'Operator', 'Sector', 'Data Start', 'Data Sfârșit', 'Tarif (RON/t)', 'Cantitate (tone)', 'Valoare Totală (RON)', 'Depozitare (%)', 'Asociat', 'Status', 'Acte Adiționale'];
    } else {
      headers = ['Nr. Contract', 'Operator', 'Sector', 'Data Start', 'Data Sfârșit', 'Status', 'Tip Atribuire', 'Acte Adiționale'];
    }

    let csv = headers.join(',') + '\n';

    contracts.forEach(contract => {
      const contractAmendments = amendments[contract.id] || [];
      
      const formatNum = (val) => {
        if (val === null || val === undefined) return '0';
        const num = parseFloat(val);
        return isNaN(num) ? '0' : num.toString();
      };

      const values = [
        contract.contract_number || '',
        `"${contract.operator_name || ''}"`,
        contract.sector_number ? `Sectorul ${contract.sector_number}` : '',
        contract.contract_date_start ? new Date(contract.contract_date_start).toLocaleDateString('ro-RO') : '',
        contract.effective_date_end ? new Date(contract.effective_date_end).toLocaleDateString('ro-RO') : '',
      ];

      if (contractType === 'DISPOSAL') {
        values.push(
          formatNum(contract.tariff_per_ton),
          formatNum(contract.cec_tax_per_ton),
          formatNum(contract.contracted_quantity_tons),
          formatNum(contract.total_value),
          contract.is_active ? 'Activ' : 'Inactiv',
          contract.attribution_type === 'PUBLIC_TENDER' ? 'Licitație deschisă' : 'Negociere fără publicare',
          contractAmendments.length.toString()
        );
      } else if (contractType === 'TMB') {
        values.push(
          formatNum(contract.tariff_per_ton),
          formatNum(contract.contracted_quantity_tons),
          formatNum(contract.total_value),
          formatNum(contract.indicator_recycling_percent),
          formatNum(contract.indicator_energy_recovery_percent),
          formatNum(contract.indicator_disposal_percent),
          contract.is_active ? 'Activ' : 'Inactiv',
          contractAmendments.length.toString()
        );
      } else if (contractType === 'AEROBIC' || contractType === 'ANAEROBIC') {
        values.push(
          formatNum(contract.tariff_per_ton),
          formatNum(contract.contracted_quantity_tons),
          formatNum(contract.total_value),
          formatNum(contract.indicator_disposal_percent),
          `"${contract.associate_name || '-'}"`,
          contract.is_active ? 'Activ' : 'Inactiv',
          contractAmendments.length.toString()
        );
      } else {
        values.push(
          contract.is_active ? 'Activ' : 'Inactiv',
          contract.attribution_type === 'PUBLIC_TENDER' ? 'Licitație deschisă' : 'Negociere fără publicare',
          contractAmendments.length.toString()
        );
      }

      csv += values.join(',') + '\n';
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=contracte-${contractType.toLowerCase()}-${Date.now()}.csv`);
    res.send('\uFEFF' + csv); // BOM for UTF-8
  } catch (error) {
    console.error('CSV export error:', error);
    res.status(500).json({ success: false, message: 'Eroare la generarea CSV' });
  }
};