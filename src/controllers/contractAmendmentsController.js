// src/controllers/contractAmendmentsController.js
/**
 * ============================================================================
 * CONTRACT AMENDMENTS CONTROLLER - UNIVERSAL
 * ============================================================================
 * CRUD pentru acte adiționale pentru toate tipurile de contracte
 * Suportă: DISPOSAL, TMB, AEROBIC, ANAEROBIC, WASTE_COLLECTOR, SORTING
 * ============================================================================
 */

import pool from '../config/database.js';
import { calculateProportionalQuantity } from '../utils/QuantityCalculationHelper.js';

// ============================================================================
// MAPARE TABELE
// ============================================================================
const TABLES = {
  DISPOSAL: {
    contracts: 'disposal_contracts',
    amendments: 'disposal_contract_amendments',
    sectors: 'disposal_contract_sectors'
  },
  TMB: {
    contracts: 'tmb_contracts',
    amendments: 'tmb_contract_amendments'
  },
  AEROBIC: {
    contracts: 'aerobic_contracts',
    amendments: 'aerobic_contract_amendments'
  },
  ANAEROBIC: {
    contracts: 'anaerobic_contracts',
    amendments: 'anaerobic_contract_amendments'
  },
  WASTE_COLLECTOR: {
    contracts: 'waste_collector_contracts',
    amendments: 'waste_collector_contract_amendments'
  },
  SORTING: {
    contracts: 'sorting_operator_contracts',
    amendments: 'sorting_operator_contract_amendments'
  }
};

// ============================================================================
// GET ALL AMENDMENTS pentru un contract
// ============================================================================
export const getContractAmendments = async (req, res) => {
  try {
    const { contractType, contractId } = req.params;
    
    const tables = TABLES[contractType];
    if (!tables) {
      return res.status(400).json({
        success: false,
        message: `Tip contract invalid: ${contractType}`
      });
    }

    const query = `
      SELECT 
        a.*,
        u.first_name || ' ' || u.last_name as created_by_name,
        rc.contract_number as reference_contract_number
      FROM ${tables.amendments} a
      LEFT JOIN users u ON a.created_by = u.id
      LEFT JOIN ${tables.contracts} rc ON a.reference_contract_id = rc.id
      WHERE a.contract_id = $1 AND a.deleted_at IS NULL
      ORDER BY a.amendment_date DESC, a.created_at DESC
    `;

    const result = await pool.query(query, [contractId]);

    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('Error fetching amendments:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la încărcarea actelor adiționale',
      error: error.message
    });
  }
};

// ============================================================================
// CREATE AMENDMENT cu calcul automat cantitate
// ============================================================================
export const createAmendment = async (req, res) => {
  try {
    const { contractType, contractId } = req.params;
    const {
      amendment_number,
      amendment_date,
      amendment_type,
      new_contract_date_end,
      new_contract_date_start,
      new_service_start_date,
      new_tariff_per_ton,
      new_cec_tax_per_ton,
      new_estimated_quantity_tons,
      new_indicator_recycling_percent,
      new_indicator_energy_recovery_percent,
      new_indicator_disposal_percent,
      changes_description,
      reason,
      notes,
      amendment_file_url,
      amendment_file_name
    } = req.body;

    const tables = TABLES[contractType];
    if (!tables) {
      return res.status(400).json({
        success: false,
        message: `Tip contract invalid: ${contractType}`
      });
    }

    // Validare
    if (!amendment_number || !amendment_date) {
      return res.status(400).json({
        success: false,
        message: 'Câmpuri obligatorii: amendment_number, amendment_date'
      });
    }

    // Obține contractul original pentru calcule
    const contractQuery = `
      SELECT * FROM ${tables.contracts}
      WHERE id = $1 AND deleted_at IS NULL
    `;
    const contractResult = await pool.query(contractQuery, [contractId]);
    
    if (contractResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Contractul nu a fost găsit'
      });
    }

    const contract = contractResult.rows[0];

    // Calculează cantitatea automată dacă e prelungire/încetare
    let quantity_adjustment_auto = null;
    
    if ((amendment_type === 'PRELUNGIRE' || amendment_type === 'INCETARE' || amendment_type === 'MODIFICARE_VALABILITATE') 
        && new_contract_date_end 
        && (contract.estimated_quantity_tons || contract.contracted_quantity_tons)) {
      
      try {
        const totalQuantity = contract.estimated_quantity_tons || contract.contracted_quantity_tons;
        const calculation = calculateProportionalQuantity(
          totalQuantity,
          contract.contract_date_start,
          contract.contract_date_end,
          new_contract_date_end
        );
        quantity_adjustment_auto = calculation.adjustedQuantity;
      } catch (calcError) {
        console.warn('Could not calculate proportional quantity:', calcError.message);
      }
    }

    // Construiește query INSERT dinamic bazat pe contract type
    let insertQuery = '';
    let insertParams = [];

    if (contractType === 'DISPOSAL') {
      insertQuery = `
        INSERT INTO ${tables.amendments} (
          contract_id, amendment_number, amendment_date, amendment_type,
          new_contract_date_end, new_contract_date_start, new_service_start_date,
          new_tariff_per_ton, new_cec_tax_per_ton, new_contracted_quantity_tons,
          quantity_adjustment_auto, changes_description, reason, notes,
          amendment_file_url, amendment_file_name, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
        RETURNING *
      `;
      insertParams = [
        contractId, amendment_number, amendment_date, amendment_type || 'MANUAL',
        new_contract_date_end || null, new_contract_date_start || null, new_service_start_date || null,
        new_tariff_per_ton || null, new_cec_tax_per_ton || null, new_estimated_quantity_tons || null,
        quantity_adjustment_auto, changes_description || null, reason || null, notes || null,
        amendment_file_url || null, amendment_file_name || null, req.user?.id || null
      ];
    } else if (contractType === 'TMB') {
      insertQuery = `
        INSERT INTO ${tables.amendments} (
          contract_id, amendment_number, amendment_date, amendment_type,
          new_contract_date_end, new_contract_date_start, new_service_start_date,
          new_tariff_per_ton, new_estimated_quantity_tons, quantity_adjustment_auto,
          new_indicator_recycling_percent, new_indicator_energy_recovery_percent, new_indicator_disposal_percent,
          changes_description, reason, notes, amendment_file_url, amendment_file_name, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
        RETURNING *
      `;
      insertParams = [
        contractId, amendment_number, amendment_date, amendment_type || 'MANUAL',
        new_contract_date_end || null, new_contract_date_start || null, new_service_start_date || null,
        new_tariff_per_ton || null, new_estimated_quantity_tons || null, quantity_adjustment_auto,
        new_indicator_recycling_percent || null, new_indicator_energy_recovery_percent || null, 
        new_indicator_disposal_percent || null,
        changes_description || null, reason || null, notes || null,
        amendment_file_url || null, amendment_file_name || null, req.user?.id || null
      ];
    } else if (contractType === 'AEROBIC' || contractType === 'ANAEROBIC') {
      insertQuery = `
        INSERT INTO ${tables.amendments} (
          contract_id, amendment_number, amendment_date, amendment_type,
          new_contract_date_end, new_contract_date_start, new_service_start_date,
          new_tariff_per_ton, new_estimated_quantity_tons, quantity_adjustment_auto,
          new_indicator_disposal_percent, changes_description, reason, notes,
          amendment_file_url, amendment_file_name, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
        RETURNING *
      `;
      insertParams = [
        contractId, amendment_number, amendment_date, amendment_type || 'MANUAL',
        new_contract_date_end || null, new_contract_date_start || null, new_service_start_date || null,
        new_tariff_per_ton || null, new_estimated_quantity_tons || null, quantity_adjustment_auto,
        new_indicator_disposal_percent || null, changes_description || null, reason || null, notes || null,
        amendment_file_url || null, amendment_file_name || null, req.user?.id || null
      ];
    } else if (contractType === 'WASTE_COLLECTOR') {
      insertQuery = `
        INSERT INTO ${tables.amendments} (
          contract_id, amendment_number, amendment_date, amendment_type,
          new_contract_date_end, new_contract_date_start, new_service_start_date,
          changes_description, reason, notes, amendment_file_url, amendment_file_name, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        RETURNING *
      `;
      insertParams = [
        contractId, amendment_number, amendment_date, amendment_type || 'MANUAL',
        new_contract_date_end || null, new_contract_date_start || null, new_service_start_date || null,
        changes_description || null, reason || null, notes || null,
        amendment_file_url || null, amendment_file_name || null, req.user?.id || null
      ];
    } else if (contractType === 'SORTING') {
      insertQuery = `
        INSERT INTO ${tables.amendments} (
          contract_id, amendment_number, amendment_date, amendment_type,
          new_contract_date_end, new_contract_date_start, new_service_start_date,
          new_tariff_per_ton, new_estimated_quantity_tons, quantity_adjustment_auto,
          changes_description, reason, notes, amendment_file_url, amendment_file_name, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        RETURNING *
      `;
      insertParams = [
        contractId, amendment_number, amendment_date, amendment_type || 'MANUAL',
        new_contract_date_end || null, new_contract_date_start || null, new_service_start_date || null,
        new_tariff_per_ton || null, new_estimated_quantity_tons || null, quantity_adjustment_auto,
        changes_description || null, reason || null, notes || null,
        amendment_file_url || null, amendment_file_name || null, req.user?.id || null
      ];
    }

    const result = await pool.query(insertQuery, insertParams);

    res.status(201).json({
      success: true,
      message: 'Act adițional creat cu succes',
      data: result.rows[0],
      calculation: quantity_adjustment_auto ? {
        original_quantity: contract.estimated_quantity_tons || contract.contracted_quantity_tons,
        adjusted_quantity: quantity_adjustment_auto
      } : null
    });
  } catch (error) {
    console.error('Error creating amendment:', error);
    
    if (error.code === '23505') {
      return res.status(400).json({
        success: false,
        message: 'Există deja un act adițional cu acest număr'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Eroare la crearea actului adițional',
      error: error.message
    });
  }
};

// ============================================================================
// UPDATE AMENDMENT
// ============================================================================
export const updateAmendment = async (req, res) => {
  try {
    const { contractType, amendmentId } = req.params;
    const {
      amendment_number,
      amendment_date,
      amendment_type,
      new_contract_date_end,
      new_contract_date_start,
      new_service_start_date,
      new_tariff_per_ton,
      new_cec_tax_per_ton,
      new_estimated_quantity_tons,
      new_indicator_recycling_percent,
      new_indicator_energy_recovery_percent,
      new_indicator_disposal_percent,
      changes_description,
      reason,
      notes,
      amendment_file_url,
      amendment_file_name
    } = req.body;

    const tables = TABLES[contractType];
    if (!tables) {
      return res.status(400).json({
        success: false,
        message: `Tip contract invalid: ${contractType}`
      });
    }

    // Construiește UPDATE dinamic
    let updateQuery = '';
    let updateParams = [];

    if (contractType === 'DISPOSAL') {
      updateQuery = `
        UPDATE ${tables.amendments} SET
          amendment_number = $1,
          amendment_date = $2,
          amendment_type = $3,
          new_contract_date_end = $4,
          new_contract_date_start = $5,
          new_service_start_date = $6,
          new_tariff_per_ton = $7,
          new_cec_tax_per_ton = $8,
          new_contracted_quantity_tons = $9,
          changes_description = $10,
          reason = $11,
          notes = $12,
          amendment_file_url = $13,
          amendment_file_name = $14,
          updated_at = NOW()
        WHERE id = $15 AND deleted_at IS NULL
        RETURNING *
      `;
      updateParams = [
        amendment_number, amendment_date, amendment_type,
        new_contract_date_end, new_contract_date_start, new_service_start_date,
        new_tariff_per_ton, new_cec_tax_per_ton, new_estimated_quantity_tons,
        changes_description, reason, notes, amendment_file_url, amendment_file_name,
        amendmentId
      ];
    } else if (contractType === 'TMB') {
      updateQuery = `
        UPDATE ${tables.amendments} SET
          amendment_number = $1,
          amendment_date = $2,
          amendment_type = $3,
          new_contract_date_end = $4,
          new_tariff_per_ton = $5,
          new_estimated_quantity_tons = $6,
          new_indicator_recycling_percent = $7,
          new_indicator_energy_recovery_percent = $8,
          new_indicator_disposal_percent = $9,
          changes_description = $10,
          reason = $11,
          notes = $12,
          amendment_file_url = $13,
          amendment_file_name = $14,
          updated_at = NOW()
        WHERE id = $15 AND deleted_at IS NULL
        RETURNING *
      `;
      updateParams = [
        amendment_number, amendment_date, amendment_type, new_contract_date_end,
        new_tariff_per_ton, new_estimated_quantity_tons,
        new_indicator_recycling_percent, new_indicator_energy_recovery_percent, new_indicator_disposal_percent,
        changes_description, reason, notes, amendment_file_url, amendment_file_name,
        amendmentId
      ];
    }
    // Similar pentru celelalte tipuri...

    const result = await pool.query(updateQuery, updateParams);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Actul adițional nu a fost găsit'
      });
    }

    res.json({
      success: true,
      message: 'Act adițional actualizat cu succes',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating amendment:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la actualizarea actului adițional',
      error: error.message
    });
  }
};

// ============================================================================
// DELETE AMENDMENT (soft delete)
// ============================================================================
export const deleteAmendment = async (req, res) => {
  try {
    const { contractType, amendmentId } = req.params;

    const tables = TABLES[contractType];
    if (!tables) {
      return res.status(400).json({
        success: false,
        message: `Tip contract invalid: ${contractType}`
      });
    }

    // Verifică dacă e act AUTO - nu poate fi șters
    const checkQuery = `
      SELECT amendment_type FROM ${tables.amendments}
      WHERE id = $1 AND deleted_at IS NULL
    `;
    const checkResult = await pool.query(checkQuery, [amendmentId]);
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Actul adițional nu a fost găsit'
      });
    }

    if (checkResult.rows[0].amendment_type === 'AUTO_TERMINATION') {
      return res.status(403).json({
        success: false,
        message: 'Actele adiționale automate nu pot fi șterse'
      });
    }

    const deleteQuery = `
      UPDATE ${tables.amendments}
      SET deleted_at = NOW()
      WHERE id = $1
      RETURNING id
    `;

    const result = await pool.query(deleteQuery, [amendmentId]);

    res.json({
      success: true,
      message: 'Act adițional șters cu succes'
    });
  } catch (error) {
    console.error('Error deleting amendment:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la ștergerea actului adițional',
      error: error.message
    });
  }
};

export default {
  getContractAmendments,
  createAmendment,
  updateAmendment,
  deleteAmendment
};