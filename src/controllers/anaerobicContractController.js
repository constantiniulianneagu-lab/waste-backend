// src/controllers/anaerobicContractController.js
/**
 * ============================================================================
 * ANAEROBIC CONTRACT CONTROLLER (TAN-)
 * ============================================================================
 * FIXED: 
 * - Added IS NOT NULL check for effective_date_end
 * - Added auto-termination in CREATE and UPDATE
 * ============================================================================
 */

import pool from '../config/database.js';
import { autoTerminateSimpleContracts } from '../utils/autoTermination.js';
import { 
  calculateProportionalQuantity, 
  getContractDataForProportional 
} from '../utils/proportionalQuantity.js';

// ============================================================================
// GET ALL ANAEROBIC CONTRACTS
// ============================================================================
export const getAnaerobicContracts = async (req, res) => {
  try {
    const { sector_id, is_active } = req.query;

    let whereConditions = ['anc.deleted_at IS NULL'];
    const params = [];
    let paramCount = 1;

    if (sector_id) {
      whereConditions.push(`anc.sector_id = $${paramCount}`);
      params.push(sector_id);
      paramCount++;
    }

    if (is_active !== undefined) {
      whereConditions.push(`anc.is_active = $${paramCount}`);
      params.push(is_active === 'true' || is_active === true);
      paramCount++;
    }

    const whereClause = whereConditions.join(' AND ');

    const query = `
      SELECT 
        anc.id,
        anc.institution_id,
        anc.contract_number,
        anc.contract_date_start,
        anc.contract_date_end,
        anc.service_start_date,
        anc.tariff_per_ton,
        anc.estimated_quantity_tons,
        anc.contract_value,
        anc.currency,
        anc.associate_institution_id,
        anc.indicator_disposal_percent,
        anc.contract_file_url,
        anc.contract_file_name,
        anc.contract_file_size,
        anc.is_active,
        anc.notes,
        anc.attribution_type,
        anc.created_at,
        anc.updated_at,
        
        i.name as institution_name,
        i.short_name as institution_short_name,
        
        s.id as sector_id,
        s.sector_number,
        s.sector_name,
        
        ai.name as associate_name,
        ai.short_name as associate_short_name,
        
        COALESCE(
          (SELECT anca.new_contract_date_end 
           FROM anaerobic_contract_amendments anca 
           WHERE anca.contract_id = anc.id 
             AND anca.new_contract_date_end IS NOT NULL
             AND anca.deleted_at IS NULL 
           ORDER BY anca.amendment_date DESC, anca.id DESC 
           LIMIT 1),
          anc.contract_date_end
        ) as effective_date_end,
        
        COALESCE(
          (SELECT anca.new_tariff_per_ton 
           FROM anaerobic_contract_amendments anca 
           WHERE anca.contract_id = anc.id 
             AND anca.new_tariff_per_ton IS NOT NULL 
             AND anca.deleted_at IS NULL 
           ORDER BY anca.amendment_date DESC, anca.id DESC 
           LIMIT 1),
          anc.tariff_per_ton
        ) as effective_tariff,
        
        COALESCE(
          (SELECT anca.new_estimated_quantity_tons 
           FROM anaerobic_contract_amendments anca 
           WHERE anca.contract_id = anc.id 
             AND anca.new_estimated_quantity_tons IS NOT NULL 
             AND anca.deleted_at IS NULL 
           ORDER BY anca.amendment_date DESC, anca.id DESC 
           LIMIT 1),
          anc.estimated_quantity_tons
        ) as effective_quantity,
        
        (COALESCE(
          (SELECT anca.new_tariff_per_ton 
           FROM anaerobic_contract_amendments anca 
           WHERE anca.contract_id = anc.id 
             AND anca.new_tariff_per_ton IS NOT NULL 
             AND anca.deleted_at IS NULL 
           ORDER BY anca.amendment_date DESC, anca.id DESC 
           LIMIT 1),
          anc.tariff_per_ton
        ) * COALESCE(
          (SELECT anca.new_estimated_quantity_tons 
           FROM anaerobic_contract_amendments anca 
           WHERE anca.contract_id = anc.id 
             AND anca.new_estimated_quantity_tons IS NOT NULL 
             AND anca.deleted_at IS NULL 
           ORDER BY anca.amendment_date DESC, anca.id DESC 
           LIMIT 1),
          anc.estimated_quantity_tons
        )) as effective_total_value,
        
        (SELECT COUNT(*)
         FROM anaerobic_contract_amendments anca
         WHERE anca.contract_id = anc.id 
           AND anca.deleted_at IS NULL
        ) as amendments_count
        
      FROM anaerobic_contracts anc
      JOIN institutions i ON anc.institution_id = i.id
      LEFT JOIN sectors s ON anc.sector_id = s.id
      LEFT JOIN institutions ai ON anc.associate_institution_id = ai.id
      WHERE ${whereClause}
      ORDER BY s.sector_number, anc.contract_date_start DESC
    `;

    const result = await pool.query(query, params);

    res.json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    console.error('Get anaerobic contracts error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la obținerea contractelor anaerobe',
    });
  }
};

// ============================================================================
// GET SINGLE ANAEROBIC CONTRACT
// ============================================================================
export const getAnaerobicContract = async (req, res) => {
  try {
    const { contractId } = req.params;

    const query = `
      SELECT 
        anc.*,
        i.name as institution_name,
        i.short_name as institution_short_name,
        s.sector_number,
        s.sector_name,
        ai.name as associate_name,
        ai.short_name as associate_short_name
      FROM anaerobic_contracts anc
      JOIN institutions i ON anc.institution_id = i.id
      LEFT JOIN sectors s ON anc.sector_id = s.id
      LEFT JOIN institutions ai ON anc.associate_institution_id = ai.id
      WHERE anc.id = $1 AND anc.deleted_at IS NULL
    `;

    const result = await pool.query(query, [contractId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Contract anaerob negăsit',
      });
    }

    res.json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    console.error('Get anaerobic contract error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la obținerea contractului anaerob',
    });
  }
};

// ============================================================================
// CREATE ANAEROBIC CONTRACT
// ============================================================================
export const createAnaerobicContract = async (req, res) => {
  try {
    const {
      institution_id,
      contract_number,
      contract_date_start,
      contract_date_end,
      service_start_date,
      sector_id,
      tariff_per_ton,
      estimated_quantity_tons,
      associate_institution_id,
      indicator_disposal_percent,
      contract_file_url,
      contract_file_name,
      contract_file_size,
      is_active,
      notes,
      attribution_type,
    } = req.body;

    const query = `
      INSERT INTO anaerobic_contracts (
        institution_id, contract_number, contract_date_start, contract_date_end,
        service_start_date,
        sector_id, tariff_per_ton, estimated_quantity_tons, associate_institution_id,
        indicator_disposal_percent, contract_file_url, contract_file_name,
        contract_file_size, is_active, notes, attribution_type, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      RETURNING *
    `;

    const values = [
      institution_id,
      contract_number,
      contract_date_start,
      contract_date_end || null,
      service_start_date || null,
      sector_id || null,
      tariff_per_ton,
      estimated_quantity_tons === '' ? null : estimated_quantity_tons,
      associate_institution_id || null,
      indicator_disposal_percent === '' ? null : indicator_disposal_percent,
      contract_file_url || null,
      contract_file_name || null,
      contract_file_size || null,
      is_active !== undefined ? is_active : true,
      notes || null,
      attribution_type || null,
      req.user.id,
    ];

    const result = await pool.query(query, values);
    const savedContract = result.rows[0];

    // AUTO-TERMINATION (non-blocking): doar dacă avem service_start_date + sector_id
    let autoTermination = null;
    if (service_start_date && sector_id) {
      try {
        autoTermination = await autoTerminateSimpleContracts({
          contractType: 'ANAEROBIC',
          sectorId: sector_id,
          serviceStartDate: service_start_date,
          newContractId: savedContract.id,
          newContractNumber: contract_number,
          userId: req.user.id
        });
      } catch (e) {
        console.error('Auto-termination error (anaerobic create):', e);
      }
    }

    res.status(201).json({
      success: true,
      data: savedContract,
      auto_termination: autoTermination
    });
  } catch (error) {
    console.error('Create anaerobic contract error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la crearea contractului anaerob',
      error: error.message,
    });
  }
};

// ============================================================================
// UPDATE ANAEROBIC CONTRACT
// ============================================================================
export const updateAnaerobicContract = async (req, res) => {
  try {
    const { contractId } = req.params;

    // Citim vechiul service_start_date/sector_id ca să declanșăm auto-termination doar când se schimbă
    const prev = await pool.query(
      `SELECT sector_id, service_start_date FROM anaerobic_contracts WHERE id = $1 AND deleted_at IS NULL`,
      [contractId]
    );
    const prevRow = prev.rows?.[0] || null;
    const prevSector = prevRow?.sector_id || null;
    const prevService = prevRow?.service_start_date
      ? String(prevRow.service_start_date).slice(0, 10)
      : null;

    const {
      contract_number,
      contract_date_start,
      contract_date_end,
      service_start_date,
      sector_id,
      tariff_per_ton,
      estimated_quantity_tons,
      associate_institution_id,
      indicator_disposal_percent,
      contract_file_url,
      contract_file_name,
      contract_file_size,
      is_active,
      notes,
      attribution_type,
    } = req.body;

    const query = `
      UPDATE anaerobic_contracts SET
        contract_number = $1,
        contract_date_start = $2,
        contract_date_end = $3,
        service_start_date = $4,
        sector_id = $5,
        tariff_per_ton = $6,
        estimated_quantity_tons = $7,
        associate_institution_id = $8,
        indicator_disposal_percent = $9,
        contract_file_url = $10,
        contract_file_name = $11,
        contract_file_size = $12,
        is_active = COALESCE($13, is_active),
        notes = $14,
        attribution_type = $15,
        updated_at = NOW()
      WHERE id = $16 AND deleted_at IS NULL
      RETURNING *
    `;

    const values = [
      contract_number,
      contract_date_start,
      contract_date_end || null,
      service_start_date || null,
      sector_id || null,
      tariff_per_ton,
      estimated_quantity_tons === '' ? null : estimated_quantity_tons,
      associate_institution_id || null,
      indicator_disposal_percent === '' ? null : indicator_disposal_percent,
      contract_file_url || null,
      contract_file_name || null,
      contract_file_size || null,
      is_active === undefined ? null : is_active,
      notes || null,
      attribution_type || null,
      contractId,
    ];

    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Contract anaerob negăsit',
      });
    }

    const updatedContract = result.rows[0];

    // AUTO-TERMINATION (non-blocking)
    let autoTermination = null;

    const nextSector = sector_id || prevSector;
    const nextService = service_start_date || prevService;

    const changed =
      (service_start_date && String(nextService) !== String(prevService)) ||
      (sector_id && String(nextSector) !== String(prevSector));

    if (changed && nextService && nextSector) {
      try {
        autoTermination = await autoTerminateSimpleContracts({
          contractType: 'ANAEROBIC',
          sectorId: nextSector,
          serviceStartDate: nextService,
          newContractId: updatedContract.id,
          newContractNumber: updatedContract.contract_number,
          userId: req.user.id
        });
      } catch (e) {
        console.error('Auto-termination error (anaerobic update):', e);
      }
    }

    res.json({
      success: true,
      data: updatedContract,
      auto_termination: autoTermination
    });
  } catch (error) {
    console.error('Update anaerobic contract error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la actualizarea contractului anaerob',
      error: error.message,
    });
  }
};

// ============================================================================
// DELETE ANAEROBIC CONTRACT
// ============================================================================
export const deleteAnaerobicContract = async (req, res) => {
  try {
    const { contractId } = req.params;

    const query = `
      UPDATE anaerobic_contracts 
      SET deleted_at = NOW()
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING id
    `;

    const result = await pool.query(query, [contractId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Contract anaerob negăsit',
      });
    }

    res.json({
      success: true,
      message: 'Contract anaerob șters cu succes',
    });
  } catch (error) {
    console.error('Delete anaerobic contract error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la ștergerea contractului anaerob',
    });
  }
};

// ============================================================================
// GET AMENDMENTS FOR ANAEROBIC CONTRACT
// ============================================================================
export const getAnaerobicContractAmendments = async (req, res) => {
  try {
    const { contractId } = req.params;

    const query = `
      SELECT * FROM anaerobic_contract_amendments
      WHERE contract_id = $1 AND deleted_at IS NULL
      ORDER BY amendment_date DESC, id DESC
    `;

    const result = await pool.query(query, [contractId]);

    res.json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    console.error('Get anaerobic amendments error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la obținerea actelor adiționale',
    });
  }
};

// ============================================================================
// CREATE AMENDMENT FOR ANAEROBIC CONTRACT
// ============================================================================
export const createAnaerobicContractAmendment = async (req, res) => {
  try {
    const { contractId } = req.params;
    const {
      amendment_number,
      amendment_date,
      new_tariff_per_ton,
      new_estimated_quantity_tons,
      new_contract_date_end,
      amendment_type,
      changes_description,
      reason,
      notes,
      amendment_file_url,
      amendment_file_name,
      amendment_file_size,
    } = req.body;

// ======================================================================
    // PROPORTIONAL QUANTITY CALCULATION FOR EXTENSION
    // ======================================================================
    let finalQuantity = new_estimated_quantity_tons;
    let wasAutoCalculated = false;

    if (finalAmendmentType === 'EXTENSION' && !new_estimated_quantity_tons && new_contract_date_end) {
      const contractData = await getContractDataForProportional(
        pool,
        'TABLE_NAME',  // ← Vezi tabelul mai jos
        contractId,
        'estimated_quantity_tons'
      );

      if (contractData) {
        const calculated = calculateProportionalQuantity({
          originalStartDate: contractData.contract_date_start,
          originalEndDate: contractData.contract_date_end,
          newEndDate: new_contract_date_end,
          originalQuantity: contractData.quantity,
          amendmentType: finalAmendmentType
        });

        if (calculated !== null) {
          finalQuantity = calculated;
          wasAutoCalculated = true;
          console.log(`✅ CONTROLLER_NAME Amendment: Proportional quantity auto-calculated: ${finalQuantity} t`);
        }
      }
    }

    const query = `
      INSERT INTO anaerobic_contract_amendments (
        contract_id, amendment_number, amendment_date, new_tariff_per_ton,
        new_estimated_quantity_tons, new_contract_date_end, amendment_type,
        changes_description, reason, notes, amendment_file_url,
        amendment_file_name, amendment_file_size, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *
    `;

    const values = [
      contractId,
      amendment_number,
      amendment_date,
      toNullIfEmpty(new_tariff_per_ton),
      toNullIfEmpty(finalQuantity),  // ← FOLOSEȘTE finalQuantity
      new_contract_date_end || null,
      amendment_type || null,
      changes_description || null,
      reason || null,
      notes || null,
      amendment_file_url || null,
      amendment_file_name || null,
      amendment_file_size || null,
      req.user.id,
    ];

    const result = await pool.query(query, values);

    res.status(201).json({ 
      success: true, 
      data: result.rows[0],
      quantity_auto_calculated: wasAutoCalculated
    });
  } catch (error) {
    console.error('Create anaerobic amendment error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la crearea actului adițional',
      error: error.message,
    });
  }
};

// ============================================================================
// UPDATE AMENDMENT FOR ANAEROBIC CONTRACT
// ============================================================================
export const updateAnaerobicContractAmendment = async (req, res) => {
  try {
    const { contractId, amendmentId } = req.params;
    const {
      amendment_number,
      amendment_date,
      new_tariff_per_ton,
      new_estimated_quantity_tons,
      new_contract_date_end,
      amendment_type,
      changes_description,
      reason,
      notes,
      amendment_file_url,
      amendment_file_name,
      amendment_file_size,
    } = req.body;

    const query = `
      UPDATE anaerobic_contract_amendments SET
        amendment_number = $1,
        amendment_date = $2,
        new_tariff_per_ton = $3,
        new_estimated_quantity_tons = $4,
        new_contract_date_end = $5,
        amendment_type = $6,
        changes_description = $7,
        reason = $8,
        notes = $9,
        amendment_file_url = $10,
        amendment_file_name = $11,
        amendment_file_size = $12,
        updated_at = NOW()
      WHERE id = $13 AND contract_id = $14 AND deleted_at IS NULL
      RETURNING *
    `;

    const values = [
      amendment_number,
      amendment_date,
      new_tariff_per_ton || null,
      new_estimated_quantity_tons || null,
      new_contract_date_end || null,
      amendment_type || null,
      changes_description || null,
      reason || null,
      notes || null,
      amendment_file_url || null,
      amendment_file_name || null,
      amendment_file_size || null,
      amendmentId,
      contractId,
    ];

    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Act adițional negăsit',
      });
    }

    res.json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    console.error('Update anaerobic amendment error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la actualizarea actului adițional',
      error: error.message,
    });
  }
};

// ============================================================================
// DELETE AMENDMENT FOR ANAEROBIC CONTRACT
// ============================================================================
export const deleteAnaerobicContractAmendment = async (req, res) => {
  try {
    const { contractId, amendmentId } = req.params;

    const query = `
      UPDATE anaerobic_contract_amendments 
      SET deleted_at = NOW()
      WHERE id = $1 AND contract_id = $2 AND deleted_at IS NULL
      RETURNING id
    `;

    const result = await pool.query(query, [amendmentId, contractId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Act adițional negăsit',
      });
    }

    res.json({
      success: true,
      message: 'Act adițional șters cu succes',
    });
  } catch (error) {
    console.error('Delete anaerobic amendment error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la ștergerea actului adițional',
    });
  }
};