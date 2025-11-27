// ============================================================================
// TMB DASHBOARD CONTROLLER - VERSIUNE CORECTATĂ
// ============================================================================

import pool from '../config/database.js';

const formatNumber = (num) => {
  return num ? parseFloat(num).toFixed(2) : '0.00';
};

export const getTmbStats = async (req, res) => {
  console.log('\n📊 ==================== TMB DASHBOARD STATS ====================');
  console.log('📥 Query params:', req.query);
  console.log('👤 User:', { id: req.user?.id, role: req.user?.role });

  try {
    const { start_date, end_date, sector_id, operator_id } = req.query;
    const userId = req.user.id;
    const userRole = req.user.role;

    // RBAC - Sector Access Control
    let accessibleSectorIds = [];
    
    if (userRole === 'PLATFORM_ADMIN') {
      console.log('✅ PLATFORM_ADMIN - full access');
    } else if (userRole === 'INSTITUTION_ADMIN' || userRole === 'OPERATOR_USER') {
      console.log('🔒 Restricted user, checking accessible sectors...');
      
      const userSectorsQuery = `
        SELECT DISTINCT is_table.sector_id
        FROM user_institutions ui
        JOIN institution_sectors is_table ON ui.institution_id = is_table.institution_id
        WHERE ui.user_id = $1 AND ui.deleted_at IS NULL
      `;
      
      const userSectorsResult = await pool.query(userSectorsQuery, [userId]);
      accessibleSectorIds = userSectorsResult.rows.map(row => row.sector_id);
      
      if (accessibleSectorIds.length === 0) {
        return res.status(403).json({
          success: false,
          message: 'Access denied: No sectors assigned'
        });
      }
      
      console.log('✅ Accessible sectors:', accessibleSectorIds);
    }

    // Build WHERE clause
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

    // Get sector UUID
    let sectorUuid = null;
    let sectorFilter = '';
    
    if (sector_id) {
      if (!isNaN(sector_id) && parseInt(sector_id) >= 1 && parseInt(sector_id) <= 6) {
        const sectorQuery = await pool.query(
          `SELECT id FROM sectors WHERE sector_number = $1 AND is_active = true`,
          [parseInt(sector_id)]
        );
        if (sectorQuery.rows.length > 0) {
          sectorUuid = sectorQuery.rows[0].id;
          console.log(`✅ Sector ${sector_id} UUID: ${sectorUuid}`);
        }
      } else {
        sectorUuid = sector_id;
      }
      
      if (accessibleSectorIds.length > 0 && !accessibleSectorIds.includes(sectorUuid)) {
        return res.status(403).json({
          success: false,
          message: 'Access denied: Sector not accessible'
        });
      }
      
      sectorFilter = `AND sector_id = '${sectorUuid}'`;
    } else if (accessibleSectorIds.length > 0) {
      const sectorIdsList = accessibleSectorIds.map(id => `'${id}'`).join(',');
      sectorFilter = `AND sector_id IN (${sectorIdsList})`;
    }

    // Get waste_code_id for '20 03 01'
    const wasteCodeQuery = await pool.query(
      `SELECT id FROM waste_codes WHERE code = '20 03 01'`
    );
    const wasteCode2003Id = wasteCodeQuery.rows[0]?.id;

    // Landfill direct
    let landfillQuery = `
      SELECT COALESCE(SUM(net_weight_tons), 0) as total_landfill_direct
      FROM waste_tickets_landfill
      WHERE ${whereClause}
    `;
    
    if (wasteCode2003Id) {
      landfillQuery += ` AND waste_code_id = '${wasteCode2003Id}'`;
    }
    if (sectorFilter) {
      landfillQuery += ` ${sectorFilter}`;
    }

    const landfillResult = await pool.query(landfillQuery, queryParams);
    const totalLandfillDirect = parseFloat(landfillResult.rows[0].total_landfill_direct) || 0;

    // TMB Input
    let tmbInputQuery = `
      SELECT COALESCE(SUM(wtt.net_weight_tons), 0) as total_tmb_input
      FROM waste_tickets_tmb wtt
      JOIN tmb_associations ta ON (
        wtt.sector_id = ta.sector_id AND
        wtt.operator_id IN (ta.primary_operator_id, ta.secondary_operator_id) AND
        wtt.ticket_date >= ta.valid_from AND
        (ta.valid_to IS NULL OR wtt.ticket_date <= ta.valid_to)
      )
      WHERE ${whereClause.replace('deleted_at', 'wtt.deleted_at')}
    `;

    if (sectorFilter) {
      tmbInputQuery += ` ${sectorFilter.replace('sector_id', 'wtt.sector_id')}`;
    }
    if (operator_id) {
      tmbInputQuery += ` AND wtt.operator_id = ${operator_id}`;
    }

    const tmbInputResult = await pool.query(tmbInputQuery, queryParams);
    const totalTmbInput = parseFloat(tmbInputResult.rows[0].total_tmb_input) || 0;
    const totalCollected = totalLandfillDirect + totalTmbInput;

    // Rejected
    let rejectedQuery = `
      SELECT COALESCE(SUM(rejected_quantity_tons), 0) as total_rejected
      FROM waste_tickets_rejected
      WHERE ${whereClause}
    `;
    if (sectorFilter) {
      rejectedQuery += ` ${sectorFilter}`;
    }
    if (operator_id) {
      rejectedQuery += ` AND operator_id = ${operator_id}`;
    }

    const rejectedResult = await pool.query(rejectedQuery, queryParams);
    const totalRejected = parseFloat(rejectedResult.rows[0].total_rejected) || 0;
    const tmbNet = totalTmbInput - totalRejected;

    // Output stats
    const getOutputStats = async (tableName) => {
      let query = `
        SELECT 
          COALESCE(SUM(delivered_quantity_tons), 0) as sent,
          COALESCE(SUM(accepted_quantity_tons), 0) as accepted
        FROM ${tableName}
        WHERE ${whereClause}
      `;
      if (sectorFilter) {
        query += ` ${sectorFilter}`;
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

    const totalOutputSent = recyclingStat.sent + recoveryStat.sent + disposalStat.sent;
    const stockDifference = tmbNet - totalOutputSent;

    const recyclingPercent = tmbNet > 0 ? (recyclingStat.sent / tmbNet) * 100 : 0;
    const recoveryPercent = tmbNet > 0 ? (recoveryStat.sent / tmbNet) * 100 : 0;
    const disposalPercent = tmbNet > 0 ? (disposalStat.sent / tmbNet) * 100 : 0;

    // Monthly evolution
    const monthlyQuery = `
      WITH months AS (
        SELECT 
          DATE_TRUNC('month', wtt.ticket_date) as month,
          'tmb' as source,
          SUM(wtt.net_weight_tons) as total_tons
        FROM waste_tickets_tmb wtt
        JOIN tmb_associations ta ON (
          wtt.sector_id = ta.sector_id AND
          wtt.operator_id IN (ta.primary_operator_id, ta.secondary_operator_id) AND
          wtt.ticket_date >= ta.valid_from AND
          (ta.valid_to IS NULL OR wtt.ticket_date <= ta.valid_to)
        )
        WHERE ${whereClause.replace('deleted_at', 'wtt.deleted_at')}
        ${sectorFilter ? sectorFilter.replace('sector_id', 'wtt.sector_id') : ''}
        ${operator_id ? `AND wtt.operator_id = ${operator_id}` : ''}
        GROUP BY DATE_TRUNC('month', wtt.ticket_date)
        
        UNION ALL
        
        SELECT 
          DATE_TRUNC('month', ticket_date) as month,
          'landfill' as source,
          SUM(net_weight_tons) as total_tons
        FROM waste_tickets_landfill
        WHERE ${whereClause}
        ${wasteCode2003Id ? `AND waste_code_id = '${wasteCode2003Id}'` : ''}
        ${sectorFilter ? sectorFilter : ''}
        GROUP BY DATE_TRUNC('month', ticket_date)
      )
      SELECT 
        TO_CHAR(month, 'YYYY-MM') as month,
        source,
        COALESCE(SUM(total_tons), 0) as total
      FROM months
      WHERE month >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '11 months')
      GROUP BY month, source
      ORDER BY month ASC, source
    `;

    const monthlyResult = await pool.query(monthlyQuery, queryParams);

    // Waste codes
    const wasteCodesQuery = `
      SELECT 
        wc.code,
        wc.description,
        COALESCE(SUM(wtt.net_weight_tons), 0) as total_tons
      FROM waste_tickets_tmb wtt
      JOIN waste_codes wc ON wtt.waste_code_id = wc.id
      JOIN tmb_associations ta ON (
        wtt.sector_id = ta.sector_id AND
        wtt.operator_id IN (ta.primary_operator_id, ta.secondary_operator_id) AND
        wtt.ticket_date >= ta.valid_from AND
        (ta.valid_to IS NULL OR wtt.ticket_date <= ta.valid_to)
      )
      WHERE ${whereClause.replace('deleted_at', 'wtt.deleted_at')}
      ${sectorFilter ? sectorFilter.replace('sector_id', 'wtt.sector_id') : ''}
      ${operator_id ? `AND wtt.operator_id = ${operator_id}` : ''}
      GROUP BY wc.code, wc.description
      ORDER BY total_tons DESC
      LIMIT 10
    `;

    const wasteCodesResult = await pool.query(wasteCodesQuery, queryParams);

    // Operators
    const operatorsQuery = `
      SELECT 
        i.id,
        i.name,
        COALESCE(SUM(wtt.net_weight_tons), 0) as tmb_total_tons,
        COUNT(wtt.id) as ticket_count,
        ta.association_name,
        CASE 
          WHEN i.id = ta.primary_operator_id THEN 'primary'
          WHEN i.id = ta.secondary_operator_id THEN 'secondary'
        END as role
      FROM waste_tickets_tmb wtt
      JOIN institutions i ON wtt.operator_id = i.id
      JOIN tmb_associations ta ON (
        wtt.sector_id = ta.sector_id AND
        wtt.operator_id IN (ta.primary_operator_id, ta.secondary_operator_id) AND
        wtt.ticket_date >= ta.valid_from AND
        (ta.valid_to IS NULL OR wtt.ticket_date <= ta.valid_to)
      )
      WHERE ${whereClause.replace('deleted_at', 'wtt.deleted_at')}
      ${sectorFilter ? sectorFilter.replace('sector_id', 'wtt.sector_id') : ''}
      ${operator_id ? `AND wtt.operator_id = ${operator_id}` : ''}
      GROUP BY i.id, i.name, ta.association_name, ta.primary_operator_id, ta.secondary_operator_id
      ORDER BY tmb_total_tons DESC
    `;

    const operatorsResult = await pool.query(operatorsQuery, queryParams);

    const operatorsWithPercent = operatorsResult.rows.map(op => ({
      ...op,
      tmb_percent: totalTmbInput > 0 
        ? ((parseFloat(op.tmb_total_tons) / totalTmbInput) * 100).toFixed(2)
        : '0.00'
    }));

    console.log('✅ TMB Stats calculated successfully');

    res.json({
      success: true,
      data: {
        summary: {
          total_collected: formatNumber(totalCollected),
          total_landfill_direct: formatNumber(totalLandfillDirect),
          total_tmb_input: formatNumber(totalTmbInput),
          total_rejected: formatNumber(totalRejected),
          tmb_net: formatNumber(tmbNet),
          total_output_sent: formatNumber(totalOutputSent),
          stock_difference: formatNumber(stockDifference)
        },
        outputs: {
          recycling: recyclingStat,
          recovery: recoveryStat,
          disposal: disposalStat,
          percentages: {
            recycling: formatNumber(recyclingPercent),
            recovery: formatNumber(recoveryPercent),
            disposal: formatNumber(disposalPercent)
          }
        },
        monthly_evolution: monthlyResult.rows,
        waste_codes: wasteCodesResult.rows,
        operators: operatorsWithPercent
      }
    });

  } catch (error) {
    console.error('❌ TMB Stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch TMB statistics',
      error: error.message
    });
  }
};

export const getOutputDetails = async (req, res) => {
  try {
    const { output_type, start_date, end_date, sector_id } = req.query;

    if (!output_type) {
      return res.status(400).json({
        success: false,
        message: 'output_type is required (recycling, recovery, or disposal)'
      });
    }

    const tableMap = {
      'recycling': 'waste_tickets_recycling',
      'recovery': 'waste_tickets_recovery',
      'disposal': 'waste_tickets_disposal'
    };

    const tableName = tableMap[output_type];
    if (!tableName) {
      return res.status(400).json({
        success: false,
        message: 'Invalid output_type. Must be: recycling, recovery, or disposal'
      });
    }

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

    let sectorFilter = '';
    if (sector_id) {
      if (!isNaN(sector_id) && parseInt(sector_id) >= 1 && parseInt(sector_id) <= 6) {
        const sectorQuery = await pool.query(
          `SELECT id FROM sectors WHERE sector_number = $1`,
          [parseInt(sector_id)]
        );
        if (sectorQuery.rows.length > 0) {
          sectorFilter = `AND sector_id = '${sectorQuery.rows[0].id}'`;
        }
      } else {
        sectorFilter = `AND sector_id = '${sector_id}'`;
      }
    }

    const query = `
      SELECT 
        wt.ticket_number,
        wt.ticket_date,
        wt.ticket_time,
        is.name as supplier_name,
        ir.name as recipient_name,
        wc.code as waste_code,
        wc.description as waste_description,
        wt.delivered_quantity_tons,
        wt.accepted_quantity_tons,
        wt.vehicle_number
      FROM ${tableName} wt
      JOIN institutions is ON wt.supplier_id = is.id
      JOIN institutions ir ON wt.recipient_id = ir.id
      JOIN waste_codes wc ON wt.waste_code_id = wc.id
      WHERE ${whereClause}
      ${sectorFilter}
      ORDER BY wt.ticket_date DESC, wt.ticket_time DESC
      LIMIT 100
    `;

    const result = await pool.query(query, queryParams);

    res.json({
      success: true,
      data: {
        output_type,
        tickets: result.rows
      }
    });

  } catch (error) {
    console.error('❌ Output details error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch output details',
      error: error.message
    });
  }
};

export default {
  getTmbStats,
  getOutputDetails
};