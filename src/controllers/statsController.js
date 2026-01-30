// src/controllers/statsController.js
/**
 * ============================================================================
 * STATS CONTROLLER - General Statistics
 * ============================================================================
 */

import pool from '../config/database.js';

// ============================================================================
// GET GENERAL STATS
// ============================================================================
export const getGeneralStats = async (req, res) => {
  try {
    const stats = {
      institutions: 0,
      contracts: 0,
      activeContracts: 0,
      tickets: 0,
      sectors: 0
    };

    // Get institution count
    const institutionsResult = await pool.query(`
      SELECT COUNT(*) as count 
      FROM institutions 
      WHERE deleted_at IS NULL
    `);
    stats.institutions = parseInt(institutionsResult.rows[0].count);

    // Get total contracts (all types)
    const contractsResult = await pool.query(`
      SELECT 
        (SELECT COUNT(*) FROM waste_collector_contracts WHERE deleted_at IS NULL) +
        (SELECT COUNT(*) FROM sorting_operator_contracts WHERE deleted_at IS NULL) +
        (SELECT COUNT(*) FROM aerobic_contracts WHERE deleted_at IS NULL) +
        (SELECT COUNT(*) FROM anaerobic_contracts WHERE deleted_at IS NULL) +
        (SELECT COUNT(*) FROM tmb_contracts WHERE deleted_at IS NULL) +
        (SELECT COUNT(*) FROM disposal_contracts WHERE deleted_at IS NULL) as total
    `);
    stats.contracts = parseInt(contractsResult.rows[0].total);

    // Get active contracts
    const activeContractsResult = await pool.query(`
      SELECT 
        (SELECT COUNT(*) FROM waste_collector_contracts WHERE deleted_at IS NULL AND is_active = true) +
        (SELECT COUNT(*) FROM sorting_operator_contracts WHERE deleted_at IS NULL AND is_active = true) +
        (SELECT COUNT(*) FROM aerobic_contracts WHERE deleted_at IS NULL AND is_active = true) +
        (SELECT COUNT(*) FROM anaerobic_contracts WHERE deleted_at IS NULL AND is_active = true) +
        (SELECT COUNT(*) FROM tmb_contracts WHERE deleted_at IS NULL AND is_active = true) +
        (SELECT COUNT(*) FROM disposal_contracts WHERE deleted_at IS NULL AND is_active = true) as total
    `);
    stats.activeContracts = parseInt(activeContractsResult.rows[0].total);

    // Get sectors count
    const sectorsResult = await pool.query(`
      SELECT COUNT(*) as count 
      FROM sectors 
      WHERE deleted_at IS NULL
    `);
    stats.sectors = parseInt(sectorsResult.rows[0].count);

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Get general stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la obținerea statisticilor generale'
    });
  }
};

// ============================================================================
// GET CONTRACT STATS
// ============================================================================
export const getContractStats = async (req, res) => {
  try {
    const stats = {
      byType: {
        waste_collector: 0,
        sorting: 0,
        aerobic: 0,
        anaerobic: 0,
        tmb: 0,
        disposal: 0
      },
      byStatus: {
        active: 0,
        inactive: 0,
        expired: 0
      },
      total: 0
    };

    // Get contracts by type
    const byTypeResult = await pool.query(`
      SELECT 
        'waste_collector' as type,
        COUNT(*) as count
      FROM waste_collector_contracts 
      WHERE deleted_at IS NULL
      UNION ALL
      SELECT 
        'sorting' as type,
        COUNT(*) as count
      FROM sorting_operator_contracts 
      WHERE deleted_at IS NULL
      UNION ALL
      SELECT 
        'aerobic' as type,
        COUNT(*) as count
      FROM aerobic_contracts 
      WHERE deleted_at IS NULL
      UNION ALL
      SELECT 
        'anaerobic' as type,
        COUNT(*) as count
      FROM anaerobic_contracts 
      WHERE deleted_at IS NULL
      UNION ALL
      SELECT 
        'tmb' as type,
        COUNT(*) as count
      FROM tmb_contracts 
      WHERE deleted_at IS NULL
      UNION ALL
      SELECT 
        'disposal' as type,
        COUNT(*) as count
      FROM disposal_contracts 
      WHERE deleted_at IS NULL
    `);

    byTypeResult.rows.forEach(row => {
      stats.byType[row.type] = parseInt(row.count);
      stats.total += parseInt(row.count);
    });

    // Get active contracts
    const activeResult = await pool.query(`
      SELECT 
        (SELECT COUNT(*) FROM waste_collector_contracts WHERE deleted_at IS NULL AND is_active = true) +
        (SELECT COUNT(*) FROM sorting_operator_contracts WHERE deleted_at IS NULL AND is_active = true) +
        (SELECT COUNT(*) FROM aerobic_contracts WHERE deleted_at IS NULL AND is_active = true) +
        (SELECT COUNT(*) FROM anaerobic_contracts WHERE deleted_at IS NULL AND is_active = true) +
        (SELECT COUNT(*) FROM tmb_contracts WHERE deleted_at IS NULL AND is_active = true) +
        (SELECT COUNT(*) FROM disposal_contracts WHERE deleted_at IS NULL AND is_active = true) as total
    `);
    stats.byStatus.active = parseInt(activeResult.rows[0].total);
    stats.byStatus.inactive = stats.total - stats.byStatus.active;

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Get contract stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la obținerea statisticilor contractelor'
    });
  }
};

// ============================================================================
// GET TICKET STATS
// ============================================================================
export const getTicketStats = async (req, res) => {
  try {
    const stats = {
      total: 0,
      byStatus: {
        pending: 0,
        approved: 0,
        rejected: 0
      }
    };

    // This is a placeholder - adjust based on your actual ticket tables
    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Get ticket stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la obținerea statisticilor tichetelor'
    });
  }
};

// ============================================================================
// GET INSTITUTION STATS
// ============================================================================
export const getInstitutionStats = async (req, res) => {
  try {
    const stats = {
      byType: {},
      total: 0,
      active: 0,
      inactive: 0
    };

    const result = await pool.query(`
      SELECT 
        type,
        COUNT(*) as count,
        SUM(CASE WHEN is_active = true THEN 1 ELSE 0 END) as active_count
      FROM institutions 
      WHERE deleted_at IS NULL
      GROUP BY type
    `);

    result.rows.forEach(row => {
      stats.byType[row.type] = {
        total: parseInt(row.count),
        active: parseInt(row.active_count)
      };
      stats.total += parseInt(row.count);
      stats.active += parseInt(row.active_count);
    });

    stats.inactive = stats.total - stats.active;

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Get institution stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la obținerea statisticilor instituțiilor'
    });
  }
};