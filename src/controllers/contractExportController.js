// src/controllers/contractExportController.js
/**
 * ============================================================================
 * CONTRACT EXPORT CONTROLLER - PDF, EXCEL, CSV
 * ============================================================================
 * Export contracts in multiple formats
 * ============================================================================
 */

import pool from "../config/database.js";
import PDFDocument from "pdfkit";
import ExcelJS from "exceljs";

// ============================================================================
// HELPER: Get Contracts Data
// ============================================================================
const getContractsData = async (contractType, filters = {}) => {
  let query = '';
  const params = [];
  let paramCount = 1;

  switch (contractType) {
    case 'DISPOSAL':
      query = `
        SELECT 
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
          tc.contract_number,
          tc.contract_date_start,
          tc.contract_date_end,
          tc.is_active,
          i.name as operator_name,
          s.sector_number,
          tc.tariff_per_ton,
          tc.estimated_quantity_tons as contracted_quantity_tons,
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

    case 'WASTE_COLLECTOR':
      query = `
        SELECT 
          wc.contract_number,
          wc.contract_date_start,
          wc.contract_date_end,
          wc.is_active,
          i.name as operator_name,
          s.sector_number,
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
    whereConditions.push(`${contractType === 'DISPOSAL' ? 'dc' : contractType === 'TMB' ? 'tc' : 'wc'}.is_active = $${paramCount}`);
    params.push(isActive);
    paramCount++;
  }

  if (whereConditions.length > 0) {
    query += ' AND ' + whereConditions.join(' AND ');
  }

  query += ` ORDER BY s.sector_number, ${contractType === 'DISPOSAL' ? 'dc' : contractType === 'TMB' ? 'tc' : 'wc'}.contract_date_start DESC`;

  const result = await pool.query(query, params);
  return result.rows;
};

// ============================================================================
// EXPORT PDF - Landscape format
// ============================================================================
export const exportContractsPDF = async (req, res) => {
  try {
    const { contractType = 'DISPOSAL' } = req.query;
    const contracts = await getContractsData(contractType, req.query);

    const doc = new PDFDocument({ 
      size: 'A4', 
      layout: 'landscape',
      margin: 40 
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=contracte-${contractType.toLowerCase()}-${Date.now()}.pdf`);

    doc.pipe(res);

    // Title
    doc.fontSize(18).font('Helvetica-Bold').text(`Raport Contracte ${contractType}`, { align: 'center' });
    doc.moveDown();
    doc.fontSize(10).font('Helvetica').text(`Data generării: ${new Date().toLocaleDateString('ro-RO')}`, { align: 'center' });
    doc.moveDown(2);

    // Table headers
    const startY = doc.y;
    const colWidths = contractType === 'DISPOSAL' 
      ? [80, 100, 60, 60, 80, 80, 80, 80, 80]  // 9 columns for DISPOSAL
      : [100, 120, 80, 80, 80, 80, 80];        // 7 columns for others

    doc.fontSize(9).font('Helvetica-Bold');
    
    let x = 40;
    const headers = contractType === 'DISPOSAL'
      ? ['Nr. Contract', 'Operator', 'Sector', 'Start', 'Sfârșit', 'Tarif (RON/t)', 'CEC (RON/t)', 'Cantitate (t)', 'Valoare (RON)']
      : contractType === 'TMB'
      ? ['Nr. Contract', 'Operator', 'Sector', 'Start', 'Sfârșit', 'Tarif (RON/t)', 'Valoare (RON)']
      : ['Nr. Contract', 'Operator', 'Sector', 'Start', 'Sfârșit', 'Status', 'Atribuire'];

    headers.forEach((header, i) => {
      doc.text(header, x, startY, { width: colWidths[i], align: 'left' });
      x += colWidths[i];
    });

    doc.moveDown(0.5);
    doc.moveTo(40, doc.y).lineTo(800, doc.y).stroke();
    doc.moveDown(0.5);

    // Table rows
    doc.font('Helvetica').fontSize(8);
    contracts.forEach((contract, index) => {
      if (doc.y > 520) {  // New page if needed
        doc.addPage({ size: 'A4', layout: 'landscape', margin: 40 });
        doc.y = 40;
      }

      x = 40;
      const rowY = doc.y;

      // Helper to safely format numbers
      const formatNum = (val) => {
        if (val === null || val === undefined) return '-';
        const num = parseFloat(val);
        return isNaN(num) ? '-' : num.toFixed(2);
      };

      if (contractType === 'DISPOSAL') {
        doc.text(contract.contract_number || '-', x, rowY, { width: colWidths[0] }); x += colWidths[0];
        doc.text(contract.operator_name || '-', x, rowY, { width: colWidths[1] }); x += colWidths[1];
        doc.text(contract.sector_number ? `S${contract.sector_number}` : '-', x, rowY, { width: colWidths[2] }); x += colWidths[2];
        doc.text(contract.contract_date_start ? new Date(contract.contract_date_start).toLocaleDateString('ro-RO') : '-', x, rowY, { width: colWidths[3] }); x += colWidths[3];
        doc.text(contract.effective_date_end ? new Date(contract.effective_date_end).toLocaleDateString('ro-RO') : '-', x, rowY, { width: colWidths[4] }); x += colWidths[4];
        doc.text(formatNum(contract.tariff_per_ton), x, rowY, { width: colWidths[5] }); x += colWidths[5];
        doc.text(formatNum(contract.cec_tax_per_ton), x, rowY, { width: colWidths[6] }); x += colWidths[6];
        doc.text(formatNum(contract.contracted_quantity_tons), x, rowY, { width: colWidths[7] }); x += colWidths[7];
        doc.text(formatNum(contract.total_value), x, rowY, { width: colWidths[8] });
      } else {
        doc.text(contract.contract_number || '-', x, rowY, { width: colWidths[0] }); x += colWidths[0];
        doc.text(contract.operator_name || '-', x, rowY, { width: colWidths[1] }); x += colWidths[1];
        doc.text(contract.sector_number ? `S${contract.sector_number}` : '-', x, rowY, { width: colWidths[2] }); x += colWidths[2];
        doc.text(contract.contract_date_start ? new Date(contract.contract_date_start).toLocaleDateString('ro-RO') : '-', x, rowY, { width: colWidths[3] }); x += colWidths[3];
        doc.text(contract.effective_date_end ? new Date(contract.effective_date_end).toLocaleDateString('ro-RO') : '-', x, rowY, { width: colWidths[4] }); x += colWidths[4];
        
        if (contractType === 'TMB') {
          doc.text(formatNum(contract.tariff_per_ton), x, rowY, { width: colWidths[5] }); x += colWidths[5];
          doc.text(formatNum(contract.total_value), x, rowY, { width: colWidths[6] });
        } else {
          doc.text(contract.is_active ? 'Activ' : 'Inactiv', x, rowY, { width: colWidths[5] }); x += colWidths[5];
          doc.text(contract.attribution_type === 'PUBLIC_TENDER' ? 'Licitație' : 'Negociere', x, rowY, { width: colWidths[6] });
        }
      }

      doc.moveDown(1.2);
    });

    // Footer
    doc.fontSize(8).text(`Total contracte: ${contracts.length}`, 40, doc.page.height - 60);

    doc.end();
  } catch (error) {
    console.error('PDF export error:', error);
    res.status(500).json({ success: false, message: 'Eroare la generarea PDF' });
  }
};

// ============================================================================
// EXPORT EXCEL
// ============================================================================
export const exportContractsExcel = async (req, res) => {
  try {
    const { contractType = 'DISPOSAL' } = req.query;
    const contracts = await getContractsData(contractType, req.query);

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet(`Contracte ${contractType}`);

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
      ];
    } else if (contractType === 'TMB') {
      worksheet.columns = [
        { header: 'Nr. Contract', key: 'contract_number', width: 20 },
        { header: 'Operator', key: 'operator_name', width: 30 },
        { header: 'Sector', key: 'sector_number', width: 10 },
        { header: 'Data Start', key: 'contract_date_start', width: 15 },
        { header: 'Data Sfârșit', key: 'contract_date_end', width: 15 },
        { header: 'Tarif (RON/t)', key: 'tariff_per_ton', width: 15 },
        { header: 'Cantitate (tone)', key: 'contracted_quantity_tons', width: 18 },
        { header: 'Valoare Totală (RON)', key: 'total_value', width: 20 },
        { header: 'Reciclare (%)', key: 'indicator_recycling_percent', width: 15 },
        { header: 'Valorificare Energetică (%)', key: 'indicator_energy_recovery_percent', width: 25 },
        { header: 'Depozitare (%)', key: 'indicator_disposal_percent', width: 15 },
        { header: 'Status', key: 'is_active', width: 12 },
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
      ];
    }

    // Style header
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0D9488' }
    };
    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

    // Add data
    contracts.forEach(contract => {
      const row = {
        contract_number: contract.contract_number,
        operator_name: contract.operator_name,
        sector_number: contract.sector_number ? `Sectorul ${contract.sector_number}` : '-',
        contract_date_start: contract.contract_date_start ? new Date(contract.contract_date_start).toLocaleDateString('ro-RO') : '-',
        contract_date_end: contract.effective_date_end ? new Date(contract.effective_date_end).toLocaleDateString('ro-RO') : '-',
        is_active: contract.is_active ? 'Activ' : 'Inactiv',
      };

      // Helper to safely parse numbers
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
      } else if (contractType === 'TMB') {
        row.tariff_per_ton = safeNumber(contract.tariff_per_ton);
        row.contracted_quantity_tons = safeNumber(contract.contracted_quantity_tons);
        row.total_value = safeNumber(contract.total_value);
        row.indicator_recycling_percent = safeNumber(contract.indicator_recycling_percent);
        row.indicator_energy_recovery_percent = safeNumber(contract.indicator_energy_recovery_percent);
        row.indicator_disposal_percent = safeNumber(contract.indicator_disposal_percent);
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

    let headers = [];
    if (contractType === 'DISPOSAL') {
      headers = ['Nr. Contract', 'Operator', 'Sector', 'Data Start', 'Data Sfârșit', 'Tarif (RON/t)', 'Taxa CEC (RON/t)', 'Cantitate (tone)', 'Valoare Totală (RON)', 'Status', 'Tip Atribuire'];
    } else if (contractType === 'TMB') {
      headers = ['Nr. Contract', 'Operator', 'Sector', 'Data Start', 'Data Sfârșit', 'Tarif (RON/t)', 'Cantitate (tone)', 'Valoare Totală (RON)', 'Reciclare (%)', 'Valorificare Energetică (%)', 'Depozitare (%)', 'Status'];
    } else {
      headers = ['Nr. Contract', 'Operator', 'Sector', 'Data Start', 'Data Sfârșit', 'Status', 'Tip Atribuire'];
    }

    let csv = headers.join(',') + '\n';

    contracts.forEach(contract => {
      // Helper to safely format numbers
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
          contract.attribution_type === 'PUBLIC_TENDER' ? 'Licitație deschisă' : 'Negociere fără publicare'
        );
      } else if (contractType === 'TMB') {
        values.push(
          formatNum(contract.tariff_per_ton),
          formatNum(contract.contracted_quantity_tons),
          formatNum(contract.total_value),
          formatNum(contract.indicator_recycling_percent),
          formatNum(contract.indicator_energy_recovery_percent),
          formatNum(contract.indicator_disposal_percent),
          contract.is_active ? 'Activ' : 'Inactiv'
        );
      } else {
        values.push(
          contract.is_active ? 'Activ' : 'Inactiv',
          contract.attribution_type === 'PUBLIC_TENDER' ? 'Licitație deschisă' : 'Negociere fără publicare'
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