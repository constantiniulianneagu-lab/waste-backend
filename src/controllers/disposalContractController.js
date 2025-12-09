// src/controllers/disposalContractController.js
/**
 * ============================================================================
 * DISPOSAL CONTRACTS CONTROLLER
 * ============================================================================
 * CRUD operations pentru contracte depozite
 * Include gestionare sectoare cu tarife + taxa CEC
 * ============================================================================
 */

import pool from '../config/database.js';

// ============================================================================
// GET ALL CONTRACTS FOR INSTITUTION
// ============================================================================

export const getDisposalContracts = async (req, res) => {
  try {
    const { institutionId } = req.params;
    
    // Verifică că instituția există și e DISPOSAL_CLIENT
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
    
    if (institutionCheck.rows[0].type !== 'DISPOSAL_CLIENT') {
      return res.json({
        success: true,
        data: []
      });
    }
    
    // Get contracts
    const contractsResult = await pool.query(
      `SELECT 
        c.*,
        -- Check if active
        CASE 
          WHEN c.is_active = false THEN false
          WHEN c.contract_date_end IS NOT NULL AND c.contract_date_end < CURRENT_DATE THEN false
          WHEN c.contract_date_start > CURRENT_DATE THEN false
          ELSE true
        END as is_currently_active
       FROM disposal_contracts c
       WHERE c.institution_id = $1
       AND c.deleted_at IS NULL
       ORDER BY c.contract_date_start DESC`,
      [institutionId]
    );
    
    const contracts = contractsResult.rows;
    
    // Get sectors for each contract
    const contractIds = contracts.map(c => c.id);
    let sectors = [];
    
    if (contractIds.length > 0) {
      const placeholders = contractIds.map((_, i) => `$${i + 1}`).join(',');
      const sectorsResult = await pool.query(
        `SELECT 
          dcs.*,
          s.sector_name,
          s.sector_number
         FROM disposal_contract_sectors dcs
         JOIN sectors s ON s.id = dcs.sector_id
         WHERE dcs.contract_id IN (${placeholders})
         AND dcs.deleted_at IS NULL
         ORDER BY s.sector_number`,
        contractIds
      );
      sectors = sectorsResult.rows;
    }
    
    // Get amendments
    let amendments = [];
    if (contractIds.length > 0) {
      const placeholders = contractIds.map((_, i) => `$${i + 1}`).join(',');
      const amendmentsResult = await pool.query(
        `SELECT *
         FROM disposal_contract_amendments
         WHERE contract_id IN (${placeholders})
         AND deleted_at IS NULL
         ORDER BY amendment_date DESC`,
        contractIds
      );
      amendments = amendmentsResult.rows;
    }
    
    // Group sectors and amendments by contract
    const sectorsByContract = {};
    sectors.forEach(s => {
      if (!sectorsByContract[s.contract_id]) {
        sectorsByContract[s.contract_id] = [];
      }
      sectorsByContract[s.contract_id].push(s);
    });
    
    const amendmentsByContract = {};
    amendments.forEach(a => {
      if (!amendmentsByContract[a.contract_id]) {
        amendmentsByContract[a.contract_id] = [];
      }
      amendmentsByContract[a.contract_id].push(a);
    });
    
    // Attach to contracts
    const contractsWithDetails = contracts.map(c => ({
      ...c,
      is_active: c.is_currently_active,
      sectors: sectorsByContract[c.id] || [],
      amendments: amendmentsByContract[c.id] || []
    }));
    
    res.json({
      success: true,
      data: contractsWithDetails
    });
    
  } catch (err) {
    console.error('Get disposal contracts error:', err);
    res.status(500).json({
      success: false,
      message: 'Eroare la obținerea contractelor'
    });
  }
};

// ============================================================================
// GET SINGLE CONTRACT
// ============================================================================

export const getDisposalContractById = async (req, res) => {
  try {
    const { contractId } = req.params;
    
    const result = await pool.query(
      'SELECT * FROM disposal_contracts WHERE id = $1 AND deleted_at IS NULL',
      [contractId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Contract negăsit'
      });
    }
    
    // Get sectors
    const sectorsResult = await pool.query(
      `SELECT 
        dcs.*,
        s.sector_name,
        s.sector_number
       FROM disposal_contract_sectors dcs
       JOIN sectors s ON s.id = dcs.sector_id
       WHERE dcs.contract_id = $1
       AND dcs.deleted_at IS NULL
       ORDER BY s.sector_number`,
      [contractId]
    );
    
    // Get amendments
    const amendmentsResult = await pool.query(
      `SELECT *
       FROM disposal_contract_amendments
       WHERE contract_id = $1
       AND deleted_at IS NULL
       ORDER BY amendment_date DESC`,
      [contractId]
    );
    
    res.json({
      success: true,
      data: {
        ...result.rows[0],
        sectors: sectorsResult.rows,
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

export const createDisposalContract = async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const {
      institution_id,
      contract_number,
      contract_date_start,
      contract_date_end,
      notes,
      is_active = true,
      sectors = [] // Array de { sector_id, tariff_per_ton, cec_tax_per_ton, contracted_quantity_tons }
    } = req.body;
    
    // Validare
    if (!institution_id || !contract_number || !contract_date_start) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: 'Câmpuri obligatorii lipsă'
      });
    }
    
    // Check duplicate
    const duplicateCheck = await client.query(
      'SELECT id FROM disposal_contracts WHERE institution_id = $1 AND contract_number = $2 AND deleted_at IS NULL',
      [institution_id, contract_number]
    );
    
    if (duplicateCheck.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: 'Contract cu acest număr există deja'
      });
    }
    
    // Insert contract
    const contractResult = await client.query(
      `INSERT INTO disposal_contracts (
        institution_id, contract_number, contract_date_start, contract_date_end,
        notes, is_active, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *`,
      [
        institution_id,
        contract_number,
        contract_date_start,
        contract_date_end || null,
        notes || null,
        is_active,
        req.user.id
      ]
    );
    
    const contract = contractResult.rows[0];
    
    // Insert sectors
    const insertedSectors = [];
    for (const sector of sectors) {
      if (sector.sector_id && sector.tariff_per_ton !== undefined && sector.cec_tax_per_ton !== undefined) {
        const sectorResult = await client.query(
          `INSERT INTO disposal_contract_sectors (
            contract_id, sector_id, tariff_per_ton, cec_tax_per_ton, contracted_quantity_tons
          ) VALUES ($1, $2, $3, $4, $5)
          RETURNING *`,
          [
            contract.id,
            sector.sector_id,
            sector.tariff_per_ton,
            sector.cec_tax_per_ton,
            sector.contracted_quantity_tons || null
          ]
        );
        insertedSectors.push(sectorResult.rows[0]);
      }
    }
    
    await client.query('COMMIT');
    
    res.status(201).json({
      success: true,
      message: 'Contract creat cu succes',
      data: {
        ...contract,
        sectors: insertedSectors
      }
    });
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Create contract error:', err);
    res.status(500).json({
      success: false,
      message: 'Eroare la crearea contractului'
    });
  } finally {
    client.release();
  }
};

// ============================================================================
// UPDATE CONTRACT
// ============================================================================

export const updateDisposalContract = async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const { contractId } = req.params;
    const {
      contract_number,
      contract_date_start,
      contract_date_end,
      notes,
      is_active,
      sectors = [] // Array complet - se vor înlocui toate
    } = req.body;
    
    // Check if exists
    const existingContract = await client.query(
      'SELECT id FROM disposal_contracts WHERE id = $1 AND deleted_at IS NULL',
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
      UPDATE disposal_contracts
      SET ${updates.join(', ')}
      WHERE id = $${paramCount}
      RETURNING *
    `;
    
    const contractResult = await client.query(updateQuery, params);
    
    // Update sectors - șterge toate și re-inserează
    if (sectors.length > 0) {
      // Soft delete existing
      await client.query(
        'UPDATE disposal_contract_sectors SET deleted_at = NOW() WHERE contract_id = $1',
        [contractId]
      );
      
      // Insert new ones
      for (const sector of sectors) {
        if (sector.sector_id && sector.tariff_per_ton !== undefined && sector.cec_tax_per_ton !== undefined) {
          await client.query(
            `INSERT INTO disposal_contract_sectors (
              contract_id, sector_id, tariff_per_ton, cec_tax_per_ton, contracted_quantity_tons
            ) VALUES ($1, $2, $3, $4, $5)`,
            [
              contractId,
              sector.sector_id,
              sector.tariff_per_ton,
              sector.cec_tax_per_ton,
              sector.contracted_quantity_tons || null
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

export const deleteDisposalContract = async (req, res) => {
  try {
    const { contractId } = req.params;
    
    const result = await pool.query(
      'UPDATE disposal_contracts SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING id',
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

export const createDisposalAmendment = async (req, res) => {
  try {
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
      'SELECT id FROM disposal_contract_amendments WHERE contract_id = $1 AND amendment_number = $2 AND deleted_at IS NULL',
      [contractId, amendment_number]
    );
    
    if (duplicateCheck.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Act adițional cu acest număr există deja'
      });
    }
    
    const result = await pool.query(
      `INSERT INTO disposal_contract_amendments (
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

export const deleteDisposalAmendment = async (req, res) => {
  try {
    const { amendmentId } = req.params;
    
    const result = await pool.query(
      'UPDATE disposal_contract_amendments SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING id',
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