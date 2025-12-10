// controllers/sortingContractController.js
/**
 * ============================================================================
 * SORTING CONTRACT CONTROLLER - ES6
 * ============================================================================
 * CRUD operations pentru contracte operatori sortare
 * ============================================================================
 */

import pool from '../config/database.js';

/**
 * GET all sorting contracts
 */
export const getSortingContracts = async (req, res) => {
  try {
    const { institutionId } = req.params;

    const query = `
      SELECT 
        sc.*,
        s.sector_number,
        s.sector_name
      FROM sorting_operator_contracts sc
      LEFT JOIN sectors s ON sc.sector_id = s.id
      WHERE sc.deleted_at IS NULL
      ORDER BY sc.contract_date_start DESC
    `;

    const result = await pool.query(query);

    res.json({
      success: true,
      data: result.rows
    });
  } catch (err) {
    console.error('Error fetching sorting contracts:', err);
    res.status(500).json({
      success: false,
      message: 'Eroare la încărcarea contractelor'
    });
  }
};

/**
 * GET single sorting contract
 */
export const getSortingContract = async (req, res) => {
  try {
    const { institutionId, contractId } = req.params;

    const query = `
      SELECT 
        sc.*,
        s.sector_number,
        s.sector_name
      FROM sorting_operator_contracts sc
      LEFT JOIN sectors s ON sc.sector_id = s.id
      WHERE sc.id = $1 AND sc.deleted_at IS NULL
    `;

    const result = await pool.query(query, [contractId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Contract negăsit'
      });
    }

    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (err) {
    console.error('Error fetching contract:', err);
    res.status(500).json({
      success: false,
      message: 'Eroare la încărcarea contractului'
    });
  }
};

/**
 * CREATE sorting contract
 */
export const createSortingContract = async (req, res) => {
  try {
    const { institutionId } = req.params;
    const {
      sector_id,
      contract_number,
      contract_date_start,
      contract_date_end,
      tariff_per_ton,
      currency = 'RON',
      estimated_quantity_tons,
      notes,
      is_active = true
    } = req.body;

    if (!contract_number || !contract_date_start || !tariff_per_ton) {
      return res.status(400).json({
        success: false,
        message: 'Câmpuri obligatorii lipsesc'
      });
    }

    const query = `
      INSERT INTO sorting_operator_contracts (
        sector_id, contract_number, contract_date_start,
        contract_date_end, tariff_per_ton, currency,
        estimated_quantity_tons, notes, is_active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `;

    const result = await pool.query(query, [
      sector_id || null,
      contract_number,
      contract_date_start,
      contract_date_end || null,
      tariff_per_ton,
      currency,
      estimated_quantity_tons || null,
      notes || null,
      is_active
    ]);

    res.status(201).json({
      success: true,
      message: 'Contract creat cu succes',
      data: result.rows[0]
    });
  } catch (err) {
    console.error('Error creating contract:', err);
    res.status(500).json({
      success: false,
      message: 'Eroare la crearea contractului'
    });
  }
};

/**
 * UPDATE sorting contract
 */
export const updateSortingContract = async (req, res) => {
  try {
    const { institutionId, contractId } = req.params;
    const {
      sector_id,
      contract_number,
      contract_date_start,
      contract_date_end,
      tariff_per_ton,
      currency,
      estimated_quantity_tons,
      notes,
      is_active
    } = req.body;

    const query = `
      UPDATE sorting_operator_contracts SET
        sector_id = $1,
        contract_number = $2,
        contract_date_start = $3,
        contract_date_end = $4,
        tariff_per_ton = $5,
        currency = $6,
        estimated_quantity_tons = $7,
        notes = $8,
        is_active = $9,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $10 AND deleted_at IS NULL
      RETURNING *
    `;

    const result = await pool.query(query, [
      sector_id || null,
      contract_number,
      contract_date_start,
      contract_date_end || null,
      tariff_per_ton,
      currency,
      estimated_quantity_tons || null,
      notes || null,
      is_active,
      contractId
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Contract negăsit'
      });
    }

    res.json({
      success: true,
      message: 'Contract actualizat cu succes',
      data: result.rows[0]
    });
  } catch (err) {
    console.error('Error updating contract:', err);
    res.status(500).json({
      success: false,
      message: 'Eroare la actualizarea contractului'
    });
  }
};

/**
 * DELETE sorting contract
 */
export const deleteSortingContract = async (req, res) => {
  try {
    const { institutionId, contractId } = req.params;

    const query = `
      UPDATE sorting_operator_contracts 
      SET deleted_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING id
    `;

    const result = await pool.query(query, [contractId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Contract negăsit'
      });
    }

    res.json({
      success: true,
      message: 'Contract șters cu succes'
    });
  } catch (err) {
    console.error('Error deleting contract:', err);
    res.status(500).json({
      success: false,
      message: 'Eroare la ștergerea contractului'
    });
  }
};