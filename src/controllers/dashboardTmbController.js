// ============================================================================
// TMB DASHBOARD CONTROLLER - VERSIUNE NOUĂ
// ============================================================================
// Logică nouă:
// - Stoc/Diferență = TMB Input - (Reciclabil + Valorificare + Depozitare)
// - Operatori doar cu cod 20 03 01
// - TMB vs Depozitare comparație
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
    const { start_date, end_date, sector_id, year } = req.query;
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

    // Year filter (priority over start_date/end_date)
    if (year) {
      whereConditions.push(`EXTRACT(YEAR FROM ticket_date) = $${paramIndex}`);
      queryParams.push(parseInt(year));
      paramIndex++;
    } else {
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

    // 1. Landfill direct (only 20 03 01)
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

    // 2. TMB Input
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

    const tmbInputResult = await pool.query(tmbInputQuery, queryParams);
    const totalTmbInput = parseFloat(tmbInputResult.rows[0].total_tmb_input) || 0;
    const totalCollected = totalLandfillDirect + totalTmbInput;

    // 3. Output stats (Trimis + Acceptat)
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

    // 4. STOC/DIFERENȚĂ (NOU CALCUL)
    // Stoc = TMB Input - (Reciclabil Trimis + Valorificare Trimisă + Depozitare Trimisă)
    const totalOutputSent = recyclingStat.sent + recoveryStat.sent + disposalStat.sent;
    const stockDifference = totalTmbInput - totalOutputSent;

    // 5. Percentages (din TMB Input)
    const recyclingPercent = totalTmbInput > 0 ? (recyclingStat.sent / totalTmbInput) * 100 : 0;
    const recoveryPercent = totalTmbInput > 0 ? (recoveryStat.sent / totalTmbInput) * 100 : 0;
    const disposalPercent = totalTmbInput > 0 ? (disposalStat.sent / totalTmbInput) * 100 : 0;

    // 6. Monthly evolution (pentru grafic Area+Bar+Line)
    const monthlyQuery = `
      WITH tmb_monthly AS (
        SELECT 
          DATE_TRUNC('month', wtt.ticket_date) as month,
          COALESCE(SUM(wtt.net_weight_tons), 0) as tmb_total
        FROM waste_tickets_tmb wtt
        JOIN tmb_associations ta ON (
          wtt.sector_id = ta.sector_id AND
          wtt.operator_id IN (ta.primary_operator_id, ta.secondary_operator_id) AND
          wtt.ticket_date >= ta.valid_from AND
          (ta.valid_to IS NULL OR wtt.ticket_date <= ta.valid_to)
        )
        WHERE ${whereClause.replace('deleted_at', 'wtt.deleted_at')}
        ${sectorFilter ? sectorFilter.replace('sector_id', 'wtt.sector_id') : ''}
        GROUP BY DATE_TRUNC('month', wtt.ticket_date)
      ),
      landfill_monthly AS (
        SELECT 
          DATE_TRUNC('month', ticket_date) as month,
          COALESCE(SUM(net_weight_tons), 0) as landfill_total
        FROM waste_tickets_landfill
        WHERE ${whereClause}
        ${wasteCode2003Id ? `AND waste_code_id = '${wasteCode2003Id}'` : ''}
        ${sectorFilter ? sectorFilter : ''}
        GROUP BY DATE_TRUNC('month', ticket_date)
      ),
      all_months AS (
        SELECT month FROM tmb_monthly
        UNION
        SELECT month FROM landfill_monthly
      )
      SELECT 
        TO_CHAR(am.month, 'Mon') as month,
        COALESCE(tm.tmb_total, 0) as tmb_total,
        COALESCE(lm.landfill_total, 0) as landfill_total
      FROM all_months am
      LEFT JOIN tmb_monthly tm ON am.month = tm.month
      LEFT JOIN landfill_monthly lm ON am.month = lm.month
      ORDER BY am.month ASC
    `;

    const monthlyResult = await pool.query(monthlyQuery, queryParams);

    // 7. Distribution by sector (pentru grafic pie)
    const sectorDistributionQuery = `
      SELECT 
        s.sector_name,
        COALESCE(SUM(wtt.net_weight_tons), 0) as tmb_tons,
        COALESCE(
          (SELECT SUM(net_weight_tons) 
           FROM waste_tickets_landfill wl 
           WHERE wl.sector_id = s.id 
             AND wl.deleted_at IS NULL
             ${wasteCode2003Id ? `AND wl.waste_code_id = '${wasteCode2003Id}'` : ''}
             ${year ? `AND EXTRACT(YEAR FROM wl.ticket_date) = ${year}` : ''}
             ${start_date ? `AND wl.ticket_date >= '${start_date}'` : ''}
             ${end_date ? `AND wl.ticket_date <= '${end_date}'` : ''}
          ), 0
        ) as landfill_tons
      FROM sectors s
      LEFT JOIN waste_tickets_tmb wtt ON s.id = wtt.sector_id AND wtt.deleted_at IS NULL
      LEFT JOIN tmb_associations ta ON (
        wtt.sector_id = ta.sector_id AND
        wtt.operator_id IN (ta.primary_operator_id, ta.secondary_operator_id) AND
        wtt.ticket_date >= ta.valid_from AND
        (ta.valid_to IS NULL OR wtt.ticket_date <= ta.valid_to)
      )
      WHERE s.is_active = true
        ${year ? `AND (wtt.ticket_date IS NULL OR EXTRACT(YEAR FROM wtt.ticket_date) = ${year})` : ''}
        ${start_date ? `AND (wtt.ticket_date IS NULL OR wtt.ticket_date >= '${start_date}')` : ''}
        ${end_date ? `AND (wtt.ticket_date IS NULL OR wtt.ticket_date <= '${end_date}')` : ''}
      GROUP BY s.id, s.sector_name
      ORDER BY s.sector_number
    `;

    const sectorDistributionResult = await pool.query(sectorDistributionQuery);

    // 8. Operators (DOAR cod 20 03 01) - TMB vs Depozitare
    const operatorsQuery = `
      WITH tmb_data AS (
        SELECT 
          i.id,
          i.name,
          COALESCE(SUM(wtt.net_weight_tons), 0) as tmb_total_tons
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
        GROUP BY i.id, i.name
      ),
      landfill_data AS (
        SELECT 
          i.id,
          COALESCE(SUM(wl.net_weight_tons), 0) as landfill_total_tons
        FROM waste_tickets_landfill wl
        JOIN institutions i ON wl.supplier_id = i.id
        WHERE ${whereClause.replace('deleted_at', 'wl.deleted_at')}
        ${wasteCode2003Id ? `AND wl.waste_code_id = '${wasteCode2003Id}'` : ''}
        ${sectorFilter ? sectorFilter.replace('sector_id', 'wl.sector_id') : ''}
        GROUP BY i.id
      )
      SELECT 
        t.id,
        t.name,
        t.tmb_total_tons,
        COALESCE(l.landfill_total_tons, 0) as landfill_total_tons,
        (t.tmb_total_tons + COALESCE(l.landfill_total_tons, 0)) as total_tons
      FROM tmb_data t
      LEFT JOIN landfill_data l ON t.id = l.id
      WHERE t.tmb_total_tons > 0 OR COALESCE(l.landfill_total_tons, 0) > 0
      ORDER BY total_tons DESC
    `;

    const operatorsResult = await pool.query(operatorsQuery, queryParams);

    const operatorsWithPercent = operatorsResult.rows.map(op => {
      const totalTons = parseFloat(op.total_tons);
      return {
        ...op,
        tmb_percent: totalTons > 0 
          ? ((parseFloat(op.tmb_total_tons) / totalTons) * 100).toFixed(2)
          : '0.00',
        landfill_percent: totalTons > 0 
          ? ((parseFloat(op.landfill_total_tons) / totalTons) * 100).toFixed(2)
          : '0.00'
      };
    });

    console.log('✅ TMB Stats calculated successfully');

    res.json({
      success: true,
      data: {
        summary: {
          total_collected: formatNumber(totalCollected),
          total_landfill_direct: formatNumber(totalLandfillDirect),
          total_tmb_input: formatNumber(totalTmbInput),
          stock_difference: formatNumber(stockDifference),
          landfill_percent: totalCollected > 0 
            ? formatNumber((totalLandfillDirect / totalCollected) * 100) 
            : '0.00',
          tmb_percent: totalCollected > 0 
            ? formatNumber((totalTmbInput / totalCollected) * 100) 
            : '0.00'
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
        sector_distribution: sectorDistributionResult.rows,
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