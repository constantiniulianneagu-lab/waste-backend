// src/controllers/wasteOperatorContractController.js
/**
 * ============================================================================
 * WASTE OPERATOR CONTRACTS CONTROLLER
 * ============================================================================
 * CRUD operations pentru contracte operatori colectare
 * Include gestionare coduri deșeuri cu tarife
 * ============================================================================
 */

import pool from '../config/database.js';

// ============================================================================
// GET ALL CONTRACTS FOR INSTITUTION
// ============================================================================

export const getWasteOperatorContracts = async (req, res) => {
  try {
    // Check if user has access to contracts page
    const { scopes } = req.userAccess;
    if (scopes?.contracts === 'NONE') {
      return res.status(403).json({ 
        success: false, 
        message: 'Nu aveți permisiune să accesați contractele' 
      });
    }

    const { institutionId } = req.params;
    
    // 1. Verifică că instituția există și e WASTE_OPERATOR
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
    
    if (institutionCheck.rows[0].type !== 'WASTE_OPERATOR') {
      return res.json({
        success: true,
        data: []
      });
    }
    
    // 2. Get contracts cu sector info
    const contractsResult = await pool.query(
      `SELECT 
        c.*,
        s.sector_name,
        s.sector_number,
        -- Check if active based on dates
        CASE 
          WHEN c.is_active = false THEN false
          WHEN c.contract_date_end IS NOT NULL AND c.contract_date_end < CURRENT_DATE THEN false
          WHEN c.contract_date_start > CURRENT_DATE THEN false
          ELSE true
        END as is_currently_active
       FROM waste_collector_contracts c
       LEFT JOIN sectors s ON s.id = c.sector_id
       WHERE c.institution_id = $1
       AND c.deleted_at IS NULL
       ORDER BY c.contract_date_start DESC`,
      [institutionId]
    );
    
    const contracts = contractsResult.rows;
    
    // 3. Get waste codes for each contract
    const contractIds = contracts.map(c => c.id);
    let wasteCodes = [];
    
    if (contractIds.length > 0) {
      const placeholders = contractIds.map((_, i) => `$${i + 1}`).join(',');
      const wasteCodesResult = await pool.query(
        `SELECT 
          wcc.*,
          wc.code as waste_code,
          wc.description as waste_description,
          wc.category as waste_category
         FROM waste_collector_contract_codes wcc
         JOIN waste_codes wc ON wc.id = wcc.waste_code_id
         WHERE wcc.contract_id IN (${placeholders})
         AND wcc.deleted_at IS NULL
         ORDER BY wc.code`,
        contractIds
      );
      wasteCodes = wasteCodesResult.rows;
    }
    
    // 4. Get amendments
    let amendments = [];
    if (contractIds.length > 0) {
      const placeholders = contractIds.map((_, i) => `$${i + 1}`).join(',');
      const amendmentsResult = await pool.query(
        `SELECT *
         FROM waste_collector_contract_amendments
         WHERE contract_id IN (${placeholders})
         AND deleted_at IS NULL
         ORDER BY amendment_date DESC`,
        contractIds
      );
      amendments = amendmentsResult.rows;
    }
    
    // 5. Group waste codes and amendments by contract
    const wasteCodesByContract = {};
    wasteCodes.forEach(wc => {
      if (!wasteCodesByContract[wc.contract_id]) {
        wasteCodesByContract[wc.contract_id] = [];
      }
      wasteCodesByContract[wc.contract_id].push(wc);
    });
    
    const amendmentsByContract = {};
    amendments.forEach(a => {
      if (!amendmentsByContract[a.contract_id]) {
        amendmentsByContract[a.contract_id] = [];
      }
      amendmentsByContract[a.contract_id].push(a);
    });
    
    // 6. Attach to contracts
    const contractsWithDetails = contracts.map(c => ({
      ...c,
      is_active: c.is_currently_active,
      waste_codes: wasteCodesByContract[c.id] || [],
      amendments: amendmentsByContract[c.id] || []
    }));
    
    res.json({
      success: true,
      data: contractsWithDetails
    });
    
  } catch (err) {
    console.error('Get waste operator contracts error:', err);
    res.status(500).json({
      success: false,
      message: 'Eroare la obținerea contractelor',
      error: err.message
    });
  }
};

// ============================================================================
// GET SINGLE CONTRACT
// ============================================================================

export const getWasteOperatorContractById = async (req, res) => {
  try {
    // Check if user has access to contracts page
    const { scopes } = req.userAccess;
    if (scopes?.contracts === 'NONE') {
      return res.status(403).json({ 
        success: false, 
        message: 'Nu aveți permisiune să accesați contractele' 
      });
    }

    const { contractId } = req.params;
    
    const result = await pool.query(
      `SELECT 
        c.*,
        s.sector_name,
        s.sector_number
       FROM waste_collector_contracts c
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
    
    // Get waste codes
    const wasteCodesResult = await pool.query(
      `SELECT 
        wcc.*,
        wc.code as waste_code,
        wc.description as waste_description,
        wc.category as waste_category
       FROM waste_collector_contract_codes wcc
       JOIN waste_codes wc ON wc.id = wcc.waste_code_id
       WHERE wcc.contract_id = $1
       AND wcc.deleted_at IS NULL
       ORDER BY wc.code`,
      [contractId]
    );
    
    // Get amendments
    const amendmentsResult = await pool.query(
      `SELECT *
       FROM waste_collector_contract_amendments
       WHERE contract_id = $1
       AND deleted_at IS NULL
       ORDER BY amendment_date DESC`,
      [contractId]
    );
    
    res.json({
      success: true,
      data: {
        ...result.rows[0],
        waste_codes: wasteCodesResult.rows,
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

export const createWasteOperatorContract = async (req, res) => {
  const client = await pool.connect();
  
  try {
    // Check permission
    const { canCreateData } = req.userAccess;
    if (!canCreateData) {
      return res.status(403).json({ 
        success: false, 
        message: 'Nu aveți permisiune să creați contracte' 
      });
    }

    await client.query('BEGIN');
    
    const {
      institution_id,
      contract_number,
      contract_date_start,
      contract_date_end,
      sector_id,
      notes,
      is_active = true,
      waste_codes = [] // Array de { waste_code_id, tariff, unit, estimated_quantity }
    } = req.body;
    
    // Validare
    if (!institution_id || !contract_number || !contract_date_start) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: 'Câmpuri obligatorii lipsă'
      });
    }
    
    // Check duplicate contract number
    const duplicateCheck = await client.query(
      'SELECT id FROM waste_collector_contracts WHERE institution_id = $1 AND contract_number = $2 AND deleted_at IS NULL',
      [institution_id, contract_number]
    );
    
    if (duplicateCheck.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: 'Contract cu acest număr există deja pentru această instituție'
      });
    }
    
    // Insert contract
    const contractResult = await client.query(
      `INSERT INTO waste_collector_contracts (
        institution_id, contract_number, contract_date_start, contract_date_end,
        sector_id, notes, is_active, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *`,
      [
        institution_id,
        contract_number,
        contract_date_start,
        contract_date_end || null,
        sector_id || null,
        notes || null,
        is_active,
        req.user.id
      ]
    );
    
    const contract = contractResult.rows[0];
    
    // Insert waste codes
    const insertedWasteCodes = [];
    for (const wc of waste_codes) {
      if (wc.waste_code_id && wc.tariff && wc.unit) {
        const wcResult = await client.query(
          `INSERT INTO waste_collector_contract_codes (
            contract_id, waste_code_id, tariff, unit, estimated_quantity
          ) VALUES ($1, $2, $3, $4, $5)
          RETURNING *`,
          [
            contract.id,
            wc.waste_code_id,
            wc.tariff,
            wc.unit,
            wc.estimated_quantity || null
          ]
        );
        insertedWasteCodes.push(wcResult.rows[0]);
      }
    }
    
    await client.query('COMMIT');
    
    res.status(201).json({
      success: true,
      message: 'Contract creat cu succes',
      data: {
        ...contract,
        waste_codes: insertedWasteCodes
      }
    });
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Create contract error:', err);
    res.status(500).json({
      success: false,
      message: 'Eroare la crearea contractului',
      error: err.message
    });
  } finally {
    client.release();
  }
};

// ============================================================================
// UPDATE CONTRACT
// ============================================================================

export const updateWasteOperatorContract = async (req, res) => {
  const client = await pool.connect();
  
  try {
    // Check permission
    const { canEditData } = req.userAccess;
    if (!canEditData) {
      return res.status(403).json({ 
        success: false, 
        message: 'Nu aveți permisiune să editați contracte' 
      });
    }

    await client.query('BEGIN');
    
    const { contractId } = req.params;
    const {
      contract_number,
      contract_date_start,
      contract_date_end,
      sector_id,
      notes,
      is_active,
      waste_codes = [] // Array complet - se vor înlocui toate
    } = req.body;
    
    // Check if contract exists
    const existingContract = await client.query(
      'SELECT id FROM waste_collector_contracts WHERE id = $1 AND deleted_at IS NULL',
      [contractId]
    );
    
    if (existingContract.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        message: 'Contract negăsit'
      });
    }
    
    // Update contract
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
      UPDATE waste_collector_contracts
      SET ${updates.join(', ')}
      WHERE id = $${paramCount}
      RETURNING *
    `;
    
    const contractResult = await client.query(updateQuery, params);
    
    // Update waste codes - șterge toate și re-inserează
    if (waste_codes.length > 0) {
      // Soft delete existing
      await client.query(
        'UPDATE waste_collector_contract_codes SET deleted_at = NOW() WHERE contract_id = $1',
        [contractId]
      );
      
      // Insert new ones
      for (const wc of waste_codes) {
        if (wc.waste_code_id && wc.tariff && wc.unit) {
          await client.query(
            `INSERT INTO waste_collector_contract_codes (
              contract_id, waste_code_id, tariff, unit, estimated_quantity
            ) VALUES ($1, $2, $3, $4, $5)`,
            [
              contractId,
              wc.waste_code_id,
              wc.tariff,
              wc.unit,
              wc.estimated_quantity || null
            ]
          );
        }
      }
    }
    
    await client.query('COMMIT');
    
    res.json({
      success: true,
      message: 'Contract actualizat cu succes',
      data: contractResult.rows[0]
    });
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Update contract error:', err);
    res.status(500).json({
      success: false,
      message: 'Eroare la actualizarea contractului'
    });
  } finally {
    client.release();
  }
};

// ============================================================================
// DELETE CONTRACT
// ============================================================================

export const deleteWasteOperatorContract = async (req, res) => {
  try {
    // Check permission
    const { canDeleteData } = req.userAccess;
    if (!canDeleteData) {
      return res.status(403).json({ 
        success: false, 
        message: 'Nu aveți permisiune să ștergeți contracte' 
      });
    }

    const { contractId } = req.params;
    
    const result = await pool.query(
      'UPDATE waste_collector_contracts SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING id',
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

export const createWasteOperatorAmendment = async (req, res) => {
  try {
    // Check permission
    const { canCreateData } = req.userAccess;
    if (!canCreateData) {
      return res.status(403).json({ 
        success: false, 
        message: 'Nu aveți permisiune să creați amendamente' 
      });
    }

    const { contractId } = req.params;
    const {
      amendment_number,
      amendment_date,
      new_contract_date_end,
      changes_description,
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
      'SELECT id FROM waste_collector_contract_amendments WHERE contract_id = $1 AND amendment_number = $2 AND deleted_at IS NULL',
      [contractId, amendment_number]
    );
    
    if (duplicateCheck.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Act adițional cu acest număr există deja'
      });
    }
    
    const result = await pool.query(
      `INSERT INTO waste_collector_contract_amendments (
        contract_id, amendment_number, amendment_date, new_contract_date_end,
        changes_description, reason, notes, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *`,
      [
        contractId,
        amendment_number,
        amendment_date,
        new_contract_date_end || null,
        changes_description || null,
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

export const deleteWasteOperatorAmendment = async (req, res) => {
  try {
    // Check permission
    const { canDeleteData } = req.userAccess;
    if (!canDeleteData) {
      return res.status(403).json({ 
        success: false, 
        message: 'Nu aveți permisiune să ștergeți amendamente' 
      });
    }

    const { amendmentId } = req.params;
    
    const result = await pool.query(
      'UPDATE waste_collector_contract_amendments SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING id',
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