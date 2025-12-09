// src/controllers/sortingContractController.js
/**
 * ============================================================================
 * SORTING OPERATOR CONTRACTS CONTROLLER
 * ============================================================================
 * CRUD operations pentru contracte operatori sortare
 * Simplu: tarif + cantitate (ca TMB)
 * ============================================================================
 */

import pool from '../config/database.js';

// ============================================================================
// GET ALL CONTRACTS FOR INSTITUTION
// ============================================================================

export const getSortingContracts = async (req, res) => {
  try {
    const { institutionId } = req.params;
    
    // Verifică că instituția există și e SORTING_OPERATOR
    const institutionCheck = await pool.query(
      'SELECT id, type FROM institutions WHERE id = $1 AND deleted_at IS NULL',
      [institutionId]
    );
    
    if (institutionCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Instituție negăsită'
      });
    }
    
    if (institutionCheck.rows[0].type !== 'SORTING_OPERATOR') {
      return res.json({
        success: true,
        data: []
      });
    }
    
    // Get contracts
    const contractsResult = await pool.query(
      `SELECT 
        c.*,
        s.sector_name,
        s.sector_number,
        -- Check if active
        CASE 
          WHEN c.is_active = false THEN false
          WHEN c.contract_date_end IS NOT NULL AND c.contract_date_end < CURRENT_DATE THEN false
          WHEN c.contract_date_start > CURRENT_DATE THEN false
          ELSE true
        END as is_currently_active
       FROM sorting_operator_contracts c
       LEFT JOIN sectors s ON s.id = c.sector_id
       WHERE c.institution_id = $1
       AND c.deleted_at IS NULL
       ORDER BY c.contract_date_start DESC`,
      [institutionId]
    );
    
    const contracts = contractsResult.rows;
    
    // Get amendments
    const contractIds = contracts.map(c => c.id);
    let amendments = [];
    
    if (contractIds.length > 0) {
      const placeholders = contractIds.map((_, i) => `$${i + 1}`).join(',');
      const amendmentsResult = await pool.query(
        `SELECT *
         FROM sorting_operator_contract_amendments
         WHERE contract_id IN (${placeholders})
         AND deleted_at IS NULL
         ORDER BY amendment_date DESC`,
        contractIds
      );
      amendments = amendmentsResult.rows;
    }
    
    // Group amendments
    const amendmentsByContract = {};
    amendments.forEach(a => {
      if (!amendmentsByContract[a.contract_id]) {
        amendmentsByContract[a.contract_id] = [];
      }
      amendmentsByContract[a.contract_id].push(a);
    });
    
    // Attach amendments
    const contractsWithAmendments = contracts.map(c => ({
      ...c,
      is_active: c.is_currently_active,
      amendments: amendmentsByContract[c.id] || []
    }));
    
    res.json({
      success: true,
      data: contractsWithAmendments
    });
    
  } catch (err) {
    console.error('Get sorting contracts error:', err);
    res.status(500).json({
      success: false,
      message: 'Eroare la obținerea contractelor'
    });
  }
};

// ============================================================================
// GET SINGLE CONTRACT
// ============================================================================

export const getSortingContractById = async (req, res) => {
  try {
    const { contractId } = req.params;
    
    const result = await pool.query(
      `SELECT 
        c.*,
        s.sector_name,
        s.sector_number
       FROM sorting_operator_contracts c
       LEFT JOIN sectors s ON s.id = c.sector_id
       WHERE c.id = $1 AND c.deleted_at IS NULL`,
      [contractId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Contract negăsit'
      });
    }
    
    // Get amendments
    const amendmentsResult = await pool.query(
      `SELECT *
       FROM sorting_operator_contract_amendments
       WHERE contract_id = $1
       AND deleted_at IS NULL
       ORDER BY amendment_date DESC`,
      [contractId]
    );
    
    res.json({
      success: true,
      data: {
        ...result.rows[0],
        amendments: amendmentsResult.rows
      }
    });
    
  } catch (err) {
    console.error('Get contract error:', err);
    res.status(500).json({
      success: false,
      message: 'Eroare la obținerea contractului'
    });
  }
};

// ============================================================================
// CREATE CONTRACT
// ============================================================================

export const createSortingContract = async (req, res) => {
  try {
    const {
      institution_id,
      contract_number,
      contract_date_start,
      contract_date_end,
      sector_id,
      tariff_per_ton,
      estimated_quantity_tons,
      currency = 'RON',
      notes,
      is_active = true
    } = req.body;
    
    // Validare
    if (!institution_id || !contract_number || !contract_date_start || !tariff_per_ton) {
      return res.status(400).json({
        success: false,
        message: 'Câmpuri obligatorii lipsă'
      });
    }
    
    // Check duplicate
    const duplicateCheck = await pool.query(
      'SELECT id FROM sorting_operator_contracts WHERE institution_id = $1 AND contract_number = $2 AND deleted_at IS NULL',
      [institution_id, contract_number]
    );
    
    if (duplicateCheck.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Contract cu acest număr există deja'
      });
    }
    
    // Insert
    const result = await pool.query(
      `INSERT INTO sorting_operator_contracts (
        institution_id, contract_number, contract_date_start, contract_date_end,
        sector_id, tariff_per_ton, estimated_quantity_tons, currency,
        notes, is_active, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *`,
      [
        institution_id,
        contract_number,
        contract_date_start,
        contract_date_end || null,
        sector_id || null,
        tariff_per_ton,
        estimated_quantity_tons || null,
        currency,
        notes || null,
        is_active,
        req.user.id
      ]
    );
    
    res.status(201).json({
      success: true,
      message: 'Contract creat cu succes',
      data: result.rows[0]
    });
    
  } catch (err) {
    console.error('Create contract error:', err);
    res.status(500).json({
      success: false,
      message: 'Eroare la crearea contractului'
    });
  }
};

// ============================================================================
// UPDATE CONTRACT
// ============================================================================

export const updateSortingContract = async (req, res) => {
  try {
    const { contractId } = req.params;
    const {
      contract_number,
      contract_date_start,
      contract_date_end,
      sector_id,
      tariff_per_ton,
      estimated_quantity_tons,
      currency,
      notes,
      is_active
    } = req.body;
    
    // Check if exists
    const existingContract = await pool.query(
      'SELECT id FROM sorting_operator_contracts WHERE id = $1 AND deleted_at IS NULL',
      [contractId]
    );
    
    if (existingContract.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Contract negăsit'
      });
    }
    
    // Build update query
    const updates = [];
    const params = [];
    let paramCount = 1;
    
    if (contract_number !== undefined) {
      updates.push(`contract_number = $${paramCount}`);
      params.push(contract_number);
      paramCount++;
    }
    if (contract_date_start !== undefined) {
      updates.push(`contract_date_start = $${paramCount}`);
      params.push(contract_date_start);
      paramCount++;
    }
    if (contract_date_end !== undefined) {
      updates.push(`contract_date_end = $${paramCount}`);
      params.push(contract_date_end);
      paramCount++;
    }
    if (sector_id !== undefined) {
      updates.push(`sector_id = $${paramCount}`);
      params.push(sector_id);
      paramCount++;
    }
    if (tariff_per_ton !== undefined) {
      updates.push(`tariff_per_ton = $${paramCount}`);
      params.push(tariff_per_ton);
      paramCount++;
    }
    if (estimated_quantity_tons !== undefined) {
      updates.push(`estimated_quantity_tons = $${paramCount}`);
      params.push(estimated_quantity_tons);
      paramCount++;
    }
    if (currency !== undefined) {
      updates.push(`currency = $${paramCount}`);
      params.push(currency);
      paramCount++;
    }
    if (notes !== undefined) {
      updates.push(`notes = $${paramCount}`);
      params.push(notes);
      paramCount++;
    }
    if (is_active !== undefined) {
      updates.push(`is_active = $${paramCount}`);
      params.push(is_active);
      paramCount++;
    }
    
    updates.push(`updated_at = NOW()`);
    params.push(contractId);
    
    const updateQuery = `
      UPDATE sorting_operator_contracts
      SET ${updates.join(', ')}
      WHERE id = $${paramCount}
      RETURNING *
    `;
    
    const result = await pool.query(updateQuery, params);
    
    res.json({
      success: true,
      message: 'Contract actualizat cu succes',
      data: result.rows[0]
    });
    
  } catch (err) {
    console.error('Update contract error:', err);
    res.status(500).json({
      success: false,
      message: 'Eroare la actualizarea contractului'
    });
  }
};

// ============================================================================
// DELETE CONTRACT
// ============================================================================

export const deleteSortingContract = async (req, res) => {
  try {
    const { contractId } = req.params;
    
    const result = await pool.query(
      'UPDATE sorting_operator_contracts SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING id',
      [contractId]
    );
    
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
    console.error('Delete contract error:', err);
    res.status(500).json({
      success: false,
      message: 'Eroare la ștergerea contractului'
    });
  }
};

// ============================================================================
// CREATE AMENDMENT
// ============================================================================

export const createSortingAmendment = async (req, res) => {
  try {
    const { contractId } = req.params;
    const {
      amendment_number,
      amendment_date,
      new_tariff_per_ton,
      new_estimated_quantity_tons,
      new_contract_date_end,
      reason,
      notes
    } = req.body;
    
    // Validare
    if (!amendment_number || !amendment_date) {
      return res.status(400).json({
        success: false,
        message: 'Număr act adițional și dată sunt obligatorii'
      });
    }
    
    // Check duplicate
    const duplicateCheck = await pool.query(
      'SELECT id FROM sorting_operator_contract_amendments WHERE contract_id = $1 AND amendment_number = $2 AND deleted_at IS NULL',
      [contractId, amendment_number]
    );
    
    if (duplicateCheck.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Act adițional cu acest număr există deja'
      });
    }
    
    const result = await pool.query(
      `INSERT INTO sorting_operator_contract_amendments (
        contract_id, amendment_number, amendment_date,
        new_tariff_per_ton, new_estimated_quantity_tons, new_contract_date_end,
        reason, notes, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *`,
      [
        contractId,
        amendment_number,
        amendment_date,
        new_tariff_per_ton || null,
        new_estimated_quantity_tons || null,
        new_contract_date_end || null,
        reason || null,
        notes || null,
        req.user.id
      ]
    );
    
    res.status(201).json({
      success: true,
      message: 'Act adițional creat cu succes',
      data: result.rows[0]
    });
    
  } catch (err) {
    console.error('Create amendment error:', err);
    res.status(500).json({
      success: false,
      message: 'Eroare la crearea actului adițional'
    });
  }
};

// ============================================================================
// DELETE AMENDMENT
// ============================================================================

export const deleteSortingAmendment = async (req, res) => {
  try {
    const { amendmentId } = req.params;
    
    const result = await pool.query(
      'UPDATE sorting_operator_contract_amendments SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING id',
      [amendmentId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Act adițional negăsit'
      });
    }
    
    res.json({
      success: true,
      message: 'Act adițional șters cu succes'
    });
    
  } catch (err) {
    console.error('Delete amendment error:', err);
    res.status(500).json({
      success: false,
      message: 'Eroare la ștergerea actului adițional'
    });
  }
};