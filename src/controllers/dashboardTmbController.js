// ============================================================================
// TMB DASHBOARD CONTROLLER
// ============================================================================
// Handles statistics and analytics for TMB (Mechanical-Biological Treatment)
// 
// BUSINESS LOGIC:
// - Total Collected = Landfill direct (20 03 01) + TMB Input
// - TMB Net = TMB Input - Rejected
// - Output = Recycling + Recovery + Disposal (all SENT quantities)
// - Stock/Difference = TMB Net - Total Output Sent
// ============================================================================

import pool from '../config/database.js';

/**
 * GET /api/dashboard/tmb/stats
 * Returns comprehensive TMB statistics including:
 * - Input metrics (collected, to TMB, rejected)
 * - Output metrics (recycling, recovery, disposal - sent & accepted)
 * - Acceptance rates for each output stream
 * - Stock/difference calculation
 * - Monthly trends
 * - Per sector breakdown
 * - Top operators
 */
export const getTmbStats = async (req, res) => {
  try {
    const { 
      start_date, 
      end_date, 
      sector_id,
      tmb_association_id 
    } = req.query;

    // Build WHERE clause for filtering
    let whereConditions = ['deleted_at IS NULL'];
    let queryParams = [];
    let paramIndex = 1;

    if (start_date) {
      whereConditions.push(`ticket_date >= $${paramIndex}`);
      queryParams.push(start_date);
      paramIndex++;
    }

    if (end_date) {
      whereConditions.push(`ticket_date <= $${paramIndex}`);
      queryParams.push(end_date);
      paramIndex++;
    }

    const whereClause = whereConditions.join(' AND ');

    // ========================================================================
    // 1. TOTAL COLLECTED (Landfill 20 03 01 + TMB Input)
    // ========================================================================
    
    // Get waste_code_id for '20 03 01'
    const wasteCodeQuery = await pool.query(
      `SELECT id FROM waste_codes WHERE code = '20 03 01'`
    );
    const wasteCode2003Id = wasteCodeQuery.rows[0]?.id;

    // Landfill direct (only 20 03 01)
    let landfillQuery = `
      SELECT 
        COALESCE(SUM(net_weight_tons), 0) as total_landfill_direct
      FROM waste_tickets_landfill
      WHERE ${whereClause}
    `;
    
    if (wasteCode2003Id) {
      landfillQuery += ` AND waste_code_id = '${wasteCode2003Id}'`;
    }

    if (sector_id) {
      landfillQuery += ` AND sector_id = '${sector_id}'`;
    }

    const landfillResult = await pool.query(landfillQuery, queryParams);
    const totalLandfillDirect = parseFloat(landfillResult.rows[0].total_landfill_direct) || 0;

    // TMB Input (accepted quantity)
    let tmbInputQuery = `
      SELECT 
        COALESCE(SUM(accepted_quantity_tons), 0) as total_tmb_input
      FROM waste_tickets_tmb
      WHERE ${whereClause}
    `;

    if (sector_id) {
      tmbInputQuery += ` AND sector_id = '${sector_id}'`;
    }

    if (tmb_association_id) {
      tmbInputQuery += ` AND tmb_association_id = ${tmb_association_id}`;
    }

    const tmbInputResult = await pool.query(tmbInputQuery, queryParams);
    const totalTmbInput = parseFloat(tmbInputResult.rows[0].total_tmb_input) || 0;

    // TOTAL COLLECTED
    const totalCollected = totalLandfillDirect + totalTmbInput;

    // ========================================================================
    // 2. REJECTED QUANTITIES
    // ========================================================================
    let rejectedQuery = `
      SELECT 
        COALESCE(SUM(rejected_quantity_tons), 0) as total_rejected
      FROM waste_tickets_rejected
      WHERE ${whereClause}
    `;

    if (sector_id) {
      rejectedQuery += ` AND sector_id = '${sector_id}'`;
    }

    if (tmb_association_id) {
      rejectedQuery += ` AND tmb_association_id = ${tmb_association_id}`;
    }

    const rejectedResult = await pool.query(rejectedQuery, queryParams);
    const totalRejected = parseFloat(rejectedResult.rows[0].total_rejected) || 0;

    // TMB NET = TMB Input - Rejected
    const tmbNet = totalTmbInput - totalRejected;

    // ========================================================================
    // 3. OUTPUT METRICS (Recycling, Recovery, Disposal)
    // ========================================================================
    
    // Helper function for output queries
    const getOutputStats = async (tableName) => {
      let query = `
        SELECT 
          COALESCE(SUM(delivered_quantity_tons), 0) as sent,
          COALESCE(SUM(accepted_quantity_tons), 0) as accepted
        FROM ${tableName}
        WHERE ${whereClause}
      `;

      if (sector_id) {
        query += ` AND sector_id = '${sector_id}'`;
      }

      const result = await pool.query(query, queryParams);
      const sent = parseFloat(result.rows[0].sent) || 0;
      const accepted = parseFloat(result.rows[0].accepted) || 0;
      const acceptanceRate = sent > 0 ? (accepted / sent) * 100 : 0;

      return {
        sent: parseFloat(sent.toFixed(2)),
        accepted: parseFloat(accepted.toFixed(2)),
        acceptance_rate: parseFloat(acceptanceRate.toFixed(2))
      };
    };

    const recyclingStat = await getOutputStats('waste_tickets_recycling');
    const recoveryStat = await getOutputStats('waste_tickets_recovery');
    const disposalStat = await getOutputStats('waste_tickets_disposal');

    // ========================================================================
    // 4. STOCK/DIFFERENCE CALCULATION
    // ========================================================================
    const totalOutputSent = recyclingStat.sent + recoveryStat.sent + disposalStat.sent;
    const stockDifference = tmbNet - totalOutputSent;

    // ========================================================================
    // 5. PERCENTAGES (from TMB Net)
    // ========================================================================
    const recyclingPercent = tmbNet > 0 ? (recyclingStat.sent / tmbNet) * 100 : 0;
    const recoveryPercent = tmbNet > 0 ? (recoveryStat.sent / tmbNet) * 100 : 0;
    const disposalPercent = tmbNet > 0 ? (disposalStat.sent / tmbNet) * 100 : 0;

    // ========================================================================
    // 6. MONTHLY EVOLUTION (Last 12 months)
    // ========================================================================
    const monthlyQuery = `
      WITH months AS (
        SELECT 
          DATE_TRUNC('month', ticket_date) as month,
          'tmb' as source,
          SUM(accepted_quantity_tons) as total_tons
        FROM waste_tickets_tmb
        WHERE ${whereClause}
        ${sector_id ? `AND sector_id = '${sector_id}'` : ''}
        ${tmb_association_id ? `AND tmb_association_id = ${tmb_association_id}` : ''}
        GROUP BY DATE_TRUNC('month', ticket_date)
        
        UNION ALL
        
        SELECT 
          DATE_TRUNC('month', ticket_date) as month,
          'landfill' as source,
          SUM(net_weight_tons) as total_tons
        FROM waste_tickets_landfill
        WHERE ${whereClause}
        ${wasteCode2003Id ? `AND waste_code_id = '${wasteCode2003Id}'` : ''}
        ${sector_id ? `AND sector_id = '${sector_id}'` : ''}
        GROUP BY DATE_TRUNC('month', ticket_date)
      )
      SELECT 
        TO_CHAR(month, 'YYYY-MM') as month,
        source,
        COALESCE(SUM(total_tons), 0) as total
      FROM months
      WHERE month >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '12 months')
      GROUP BY month, source
      ORDER BY month ASC
    `;

    const monthlyResult = await pool.query(monthlyQuery, queryParams);

    // Format monthly data
    const monthlyData = {};
    monthlyResult.rows.forEach(row => {
      if (!monthlyData[row.month]) {
        monthlyData[row.month] = {
          month: row.month,
          tmb: 0,
          landfill: 0
        };
      }
      monthlyData[row.month][row.source] = parseFloat(row.total);
    });

    const monthlyEvolution = Object.values(monthlyData);

    // ========================================================================
    // 7. PER SECTOR BREAKDOWN
    // ========================================================================
    const sectorQuery = `
      SELECT 
        s.sector_number,
        s.sector_name,
        COALESCE(tmb.total, 0) as tmb_total,
        COALESCE(landfill.total, 0) as landfill_total
      FROM sectors s
      LEFT JOIN (
        SELECT 
          sector_id,
          SUM(accepted_quantity_tons) as total
        FROM waste_tickets_tmb
        WHERE ${whereClause}
        ${tmb_association_id ? `AND tmb_association_id = ${tmb_association_id}` : ''}
        GROUP BY sector_id
      ) tmb ON s.id = tmb.sector_id
      LEFT JOIN (
        SELECT 
          sector_id,
          SUM(net_weight_tons) as total
        FROM waste_tickets_landfill
        WHERE ${whereClause}
        ${wasteCode2003Id ? `AND waste_code_id = '${wasteCode2003Id}'` : ''}
        GROUP BY sector_id
      ) landfill ON s.id = landfill.sector_id
      WHERE s.is_active = true
      ORDER BY s.sector_number
    `;

    const sectorResult = await pool.query(sectorQuery, queryParams);
    const sectorStats = sectorResult.rows.map(row => ({
      sector: `Sector ${row.sector_number}`,
      sector_name: row.sector_name,
      tmb: parseFloat(row.tmb_total) || 0,
      landfill: parseFloat(row.landfill_total) || 0,
      total: parseFloat(row.tmb_total || 0) + parseFloat(row.landfill_total || 0)
    }));

   // ========================================================================
// 8. TOP OPERATORS (by TMB input)
// ========================================================================
const operatorsQuery = `
SELECT 
  i.short_name as operator_name,
  i.name as full_name,
  s.sector_number,
  COALESCE(tmb_data.total, 0) as tmb_total,
  COALESCE(landfill_data.total, 0) as landfill_total
FROM institutions i
LEFT JOIN (
  SELECT 
    supplier_id,
    SUM(accepted_quantity_tons) as total
  FROM waste_tickets_tmb
  WHERE deleted_at IS NULL
    ${start_date ? `AND ticket_date >= '${start_date}'` : ''}
    ${end_date ? `AND ticket_date <= '${end_date}'` : ''}
    ${sector_id ? `AND sector_id = '${sector_id}'` : ''}
    ${tmb_association_id ? `AND tmb_association_id = ${tmb_association_id}` : ''}
  GROUP BY supplier_id
) tmb_data ON i.id = tmb_data.supplier_id
LEFT JOIN (
  SELECT 
    supplier_id,
    SUM(net_weight_tons) as total
  FROM waste_tickets_landfill
  WHERE deleted_at IS NULL
    ${start_date ? `AND ticket_date >= '${start_date}'` : ''}
    ${end_date ? `AND ticket_date <= '${end_date}'` : ''}
    ${wasteCode2003Id ? `AND waste_code_id = '${wasteCode2003Id}'` : ''}
    ${sector_id ? `AND sector_id = '${sector_id}'` : ''}
  GROUP BY supplier_id
) landfill_data ON i.id = landfill_data.supplier_id
LEFT JOIN sectors s ON s.sector_number::text = i.sector
WHERE i.type = 'WASTE_OPERATOR' 
  AND i.is_active = true
  AND (COALESCE(tmb_data.total, 0) > 0 OR COALESCE(landfill_data.total, 0) > 0)
ORDER BY tmb_total DESC, landfill_total DESC
LIMIT 10
`;

const operatorsResult = await pool.query(operatorsQuery);
const topOperators = operatorsResult.rows.map(row => ({
sector: row.sector_number || 'N/A',
operator: row.operator_name || row.full_name,
tmb_tons: parseFloat(row.tmb_total) || 0,
landfill_tons: parseFloat(row.landfill_total) || 0,
total_tons: (parseFloat(row.tmb_total) || 0) + (parseFloat(row.landfill_total) || 0),
tmb_percent: 0,
landfill_percent: 0
}));

// Calculate percentages for operators
topOperators.forEach(op => {
if (op.total_tons > 0) {
  op.tmb_percent = parseFloat(((op.tmb_tons / op.total_tons) * 100).toFixed(2));
  op.landfill_percent = parseFloat(((op.landfill_tons / op.total_tons) * 100).toFixed(2));
}
});
    // ========================================================================
    // FINAL RESPONSE
    // ========================================================================
    res.json({
      success: true,
      data: {
        // Main metrics
        total_collected: parseFloat(totalCollected.toFixed(2)),
        total_landfill_direct: parseFloat(totalLandfillDirect.toFixed(2)),
        total_tmb_input: parseFloat(totalTmbInput.toFixed(2)),
        total_rejected: parseFloat(totalRejected.toFixed(2)),
        tmb_net: parseFloat(tmbNet.toFixed(2)),
        
        // Output metrics
        recycling: {
          sent: recyclingStat.sent,
          accepted: recyclingStat.accepted,
          acceptance_rate: recyclingStat.acceptance_rate,
          percent_of_tmb: parseFloat(recyclingPercent.toFixed(2))
        },
        recovery: {
          sent: recoveryStat.sent,
          accepted: recoveryStat.accepted,
          acceptance_rate: recoveryStat.acceptance_rate,
          percent_of_tmb: parseFloat(recoveryPercent.toFixed(2))
        },
        disposal: {
          sent: disposalStat.sent,
          accepted: disposalStat.accepted,
          acceptance_rate: disposalStat.acceptance_rate,
          percent_of_tmb: parseFloat(disposalPercent.toFixed(2))
        },
        
        // Stock/Difference
        stock_difference: parseFloat(stockDifference.toFixed(2)),
        stock_percent: tmbNet > 0 ? parseFloat(((stockDifference / tmbNet) * 100).toFixed(2)) : 0,
        
        // Breakdown data
        monthly_evolution: monthlyEvolution,
        sector_stats: sectorStats,
        top_operators: topOperators,
        
        // Metadata
        filters: {
          start_date: start_date || null,
          end_date: end_date || null,
          sector_id: sector_id || null,
          tmb_association_id: tmb_association_id || null
        }
      }
    });

  } catch (error) {
    console.error('❌ Error in getTmbStats:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la obținerea statisticilor TMB',
      error: error.message
    });
  }
};

/**
 * GET /api/dashboard/tmb/output-details
 * Returns detailed breakdown of output streams (recycling, recovery, disposal)
 * with waste codes and recipients
 */
export const getOutputDetails = async (req, res) => {
  try {
    const { 
      start_date, 
      end_date, 
      sector_id,
      output_type // 'recycling', 'recovery', or 'disposal'
    } = req.query;

    if (!output_type || !['recycling', 'recovery', 'disposal'].includes(output_type)) {
      return res.status(400).json({
        success: false,
        message: 'output_type trebuie să fie: recycling, recovery sau disposal'
      });
    }

    const tableName = `waste_tickets_${output_type}`;
    
    let whereConditions = ['wt.deleted_at IS NULL'];
    let queryParams = [];
    let paramIndex = 1;

    if (start_date) {
      whereConditions.push(`wt.ticket_date >= $${paramIndex}`);
      queryParams.push(start_date);
      paramIndex++;
    }

    if (end_date) {
      whereConditions.push(`wt.ticket_date <= $${paramIndex}`);
      queryParams.push(end_date);
      paramIndex++;
    }

    if (sector_id) {
      whereConditions.push(`wt.sector_id = $${paramIndex}`);
      queryParams.push(sector_id);
      paramIndex++;
    }

    const whereClause = whereConditions.join(' AND ');

    const query = `
      SELECT 
        wc.code as waste_code,
        wc.name as waste_name,
        i.short_name as recipient_name,
        s.sector_number,
        COUNT(wt.id) as ticket_count,
        SUM(wt.delivered_quantity_tons) as total_sent,
        SUM(wt.accepted_quantity_tons) as total_accepted,
        SUM(wt.delivered_quantity_tons - wt.accepted_quantity_tons) as total_difference,
        CASE 
          WHEN SUM(wt.delivered_quantity_tons) > 0 
          THEN (SUM(wt.accepted_quantity_tons) / SUM(wt.delivered_quantity_tons)) * 100
          ELSE 0 
        END as acceptance_rate
      FROM ${tableName} wt
      JOIN waste_codes wc ON wt.waste_code_id = wc.id
      JOIN institutions i ON wt.recipient_id = i.id
      JOIN sectors s ON wt.sector_id = s.id
      WHERE ${whereClause}
      GROUP BY wc.code, wc.name, i.short_name, s.sector_number
      ORDER BY total_sent DESC
    `;

    const result = await pool.query(query, queryParams);

    res.json({
      success: true,
      data: {
        output_type,
        details: result.rows.map(row => ({
          waste_code: row.waste_code,
          waste_name: row.waste_name,
          recipient: row.recipient_name,
          sector: row.sector_number,
          ticket_count: parseInt(row.ticket_count),
          sent_tons: parseFloat(row.total_sent) || 0,
          accepted_tons: parseFloat(row.total_accepted) || 0,
          difference_tons: parseFloat(row.total_difference) || 0,
          acceptance_rate: parseFloat(row.acceptance_rate).toFixed(2)
        }))
      }
    });

  } catch (error) {
    console.error('❌ Error in getOutputDetails:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la obținerea detaliilor output',
      error: error.message
    });
  }
};

export default {
  getTmbStats,
  getOutputDetails
};