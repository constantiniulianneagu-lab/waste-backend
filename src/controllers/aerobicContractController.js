// src/controllers/aerobicContractController.js
/**
 * ============================================================================
 * AEROBIC CONTRACT CONTROLLER (TA-)
 * ============================================================================
 */

import pool from '../config/database.js';
import { autoTerminateSimpleContracts } from '../utils/autoTermination.js';
import {
  calculateProportionalQuantity,
  getContractDataForProportional,
} from '../utils/proportionalQuantity.js';
const ALLOWED_AMENDMENT_TYPES = new Set(['MANUAL','AUTO_TERMINATION','PRELUNGIRE','INCETARE','MODIFICARE_TARIF','MODIFICARE_CANTITATE','MODIFICARE_INDICATOR','MODIFICARE_VALABILITATE']);

function ensureAllowedAmendmentType(input) {
  if (!input) return null;
  const raw = String(input).trim().toUpperCase();

  // UI aliases → DB allowed codes
  const aliases = {
    EXTENSION: 'PRELUNGIRE',
    PRELUNGIRE: 'PRELUNGIRE',
    TERMINATION: 'INCETARE',
    INCETARE: 'INCETARE',
    TARIFF_CHANGE: 'MODIFICARE_TARIF',
    MODIFICARE_TARIF: 'MODIFICARE_TARIF',
    QUANTITY_CHANGE: 'MODIFICARE_CANTITATE',
    MODIFICARE_CANTITATE: 'MODIFICARE_CANTITATE',
    INDICATOR_CHANGE: 'MODIFICARE_INDICATOR',
    MODIFICARE_INDICATOR: 'MODIFICARE_INDICATOR',
    VALIDITY_CHANGE: 'MODIFICARE_VALABILITATE',
    MODIFICARE_VALABILITATE: 'MODIFICARE_VALABILITATE',
    AUTO_TERMINATION: 'AUTO_TERMINATION',
    MANUAL: 'MANUAL',
    MULTIPLE: 'MANUAL',
  };

  const normalized = aliases[raw] || raw;
  return ALLOWED_AMENDMENT_TYPES.has(normalized) ? normalized : 'MANUAL';
}

// ============================================================================
// GET ALL AEROBIC CONTRACTS
// ============================================================================
export const getAerobicContracts = async (req, res) => {
  try {
    const { sector_id, is_active } = req.query;

    let whereConditions = ['ac.deleted_at IS NULL'];
    const params = [];
    let paramCount = 1;

    if (sector_id) {
      whereConditions.push(`ac.sector_id = $${paramCount}`);
      params.push(sector_id);
      paramCount++;
    }

    if (is_active !== undefined) {
      whereConditions.push(`ac.is_active = $${paramCount}`);
      params.push(is_active === 'true' || is_active === true);
      paramCount++;
    }

    const whereClause = whereConditions.join(' AND ');

    const query = `
      SELECT 
        ac.id,
        ac.institution_id,
        ac.contract_number,
        ac.contract_date_start,
        ac.contract_date_end,
        ac.service_start_date,
        ac.tariff_per_ton,
        ac.estimated_quantity_tons,
        ac.contract_value,
        ac.currency,
        ac.associate_institution_id,
        ac.indicator_disposal_percent,
        ac.contract_file_url,
        ac.contract_file_name,
        ac.contract_file_size,
        ac.is_active,
        ac.notes,
        ac.attribution_type,
        ac.created_at,
        ac.updated_at,
        
        i.name as institution_name,
        i.short_name as institution_short_name,
        
        s.id as sector_id,
        s.sector_number,
        s.sector_name,
        
        ai.name as associate_name,
        ai.short_name as associate_short_name,
        
        COALESCE(
          (SELECT aca.new_contract_date_end 
           FROM aerobic_contract_amendments aca 
           WHERE aca.contract_id = ac.id 
             AND aca.new_contract_date_end IS NOT NULL
             AND aca.deleted_at IS NULL 
           ORDER BY aca.amendment_date DESC, aca.id DESC 
           LIMIT 1),
          ac.contract_date_end
        ) as effective_date_end,
        
        COALESCE(
          (SELECT aca.new_tariff_per_ton 
           FROM aerobic_contract_amendments aca 
           WHERE aca.contract_id = ac.id 
             AND aca.new_tariff_per_ton IS NOT NULL 
             AND aca.deleted_at IS NULL 
           ORDER BY aca.amendment_date DESC, aca.id DESC 
           LIMIT 1),
          ac.tariff_per_ton
        ) as effective_tariff,
        
        COALESCE(
          (SELECT aca.new_estimated_quantity_tons 
           FROM aerobic_contract_amendments aca 
           WHERE aca.contract_id = ac.id 
             AND aca.new_estimated_quantity_tons IS NOT NULL 
             AND aca.deleted_at IS NULL 
           ORDER BY aca.amendment_date DESC, aca.id DESC 
           LIMIT 1),
          ac.estimated_quantity_tons
        ) as effective_quantity,
        
        COALESCE(
          (SELECT aca.new_indicator_disposal_percent 
           FROM aerobic_contract_amendments aca 
           WHERE aca.contract_id = ac.id 
             AND aca.new_indicator_disposal_percent IS NOT NULL 
             AND aca.deleted_at IS NULL 
           ORDER BY aca.amendment_date DESC, aca.id DESC 
           LIMIT 1),
          ac.indicator_disposal_percent
        ) as effective_indicator_disposal_percent
        
      FROM aerobic_contracts ac
      LEFT JOIN institutions i ON ac.institution_id = i.id
      LEFT JOIN sectors s ON ac.sector_id = s.id
      LEFT JOIN institutions ai ON ac.associate_institution_id = ai.id
      WHERE ${whereClause}
      ORDER BY ac.created_at DESC
    `;

    const result = await pool.query(query, params);

    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('Get aerobic contracts error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la obținerea contractelor aerobe'
    });
  }
};

// ============================================================================
// GET SINGLE AEROBIC CONTRACT
// ============================================================================
export const getAerobicContract = async (req, res) => {
  try {
    const { contractId } = req.params;

    const query = `
      SELECT 
        ac.*,
        i.name as institution_name,
        i.short_name as institution_short_name,
        s.sector_number,
        s.sector_name,
        ai.name as associate_name,
        ai.short_name as associate_short_name,
        
        COALESCE(
          (SELECT aca.new_contract_date_end 
           FROM aerobic_contract_amendments aca 
           WHERE aca.contract_id = ac.id 
             AND aca.new_contract_date_end IS NOT NULL
             AND aca.deleted_at IS NULL 
           ORDER BY aca.amendment_date DESC, aca.id DESC 
           LIMIT 1),
          ac.contract_date_end
        ) as effective_date_end,
        
        COALESCE(
          (SELECT aca.new_tariff_per_ton 
           FROM aerobic_contract_amendments aca 
           WHERE aca.contract_id = ac.id 
             AND aca.new_tariff_per_ton IS NOT NULL 
             AND aca.deleted_at IS NULL 
           ORDER BY aca.amendment_date DESC, aca.id DESC 
           LIMIT 1),
          ac.tariff_per_ton
        ) as effective_tariff,
        
        COALESCE(
          (SELECT aca.new_estimated_quantity_tons 
           FROM aerobic_contract_amendments aca 
           WHERE aca.contract_id = ac.id 
             AND aca.new_estimated_quantity_tons IS NOT NULL 
             AND aca.deleted_at IS NULL 
           ORDER BY aca.amendment_date DESC, aca.id DESC 
           LIMIT 1),
          ac.estimated_quantity_tons
        ) as effective_quantity,
        
        COALESCE(
          (SELECT aca.new_indicator_disposal_percent 
           FROM aerobic_contract_amendments aca 
           WHERE aca.contract_id = ac.id 
             AND aca.new_indicator_disposal_percent IS NOT NULL 
             AND aca.deleted_at IS NULL 
           ORDER BY aca.amendment_date DESC, aca.id DESC 
           LIMIT 1),
          ac.indicator_disposal_percent
        ) as effective_indicator_disposal_percent
        
      FROM aerobic_contracts ac
      LEFT JOIN institutions i ON ac.institution_id = i.id
      LEFT JOIN sectors s ON ac.sector_id = s.id
      LEFT JOIN institutions ai ON ac.associate_institution_id = ai.id
      WHERE ac.id = $1 AND ac.deleted_at IS NULL
    `;

    const result = await pool.query(query, [contractId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Contract aerob negăsit'
      });
    }

    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Get aerobic contract error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la obținerea contractului aerob'
    });
  }
};

// ============================================================================
// CREATE AEROBIC CONTRACT
// ============================================================================
export const createAerobicContract = async (req, res) => {
  try {
    const {
      institution_id,
      contract_number,
      contract_date_start,
      contract_date_end,
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
      service_start_date
    } = req.body;

    const query = `
      INSERT INTO aerobic_contracts (
        institution_id, contract_number, contract_date_start, contract_date_end,
        sector_id, tariff_per_ton, estimated_quantity_tons, associate_institution_id,
        indicator_disposal_percent, contract_file_url, contract_file_name,
        contract_file_size, is_active, notes, attribution_type, service_start_date, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      RETURNING *
    `;

    const values = [
      institution_id,
      contract_number,
      contract_date_start,
      contract_date_end || null,
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
      service_start_date || null,
      req.user.id
    ];

    const result = await pool.query(query, values);
    const savedContract = result.rows[0];

    // AUTO-TERMINATION (non-blocking): doar dacă avem service_start_date + sector_id
    let autoTermination = null;
    if (service_start_date && sector_id) {
      try {
        autoTermination = await autoTerminateSimpleContracts({
          contractType: 'AEROBIC',
          sectorId: sector_id,
          serviceStartDate: service_start_date,
          newContractId: savedContract.id,
          newContractNumber: contract_number,
          userId: req.user.id
        });
      } catch (e) {
        console.error('Auto-termination error (aerobic create):', e);
      }
    }

    res.status(201).json({
      success: true,
      data: savedContract,
      auto_termination: autoTermination
    });
  } catch (error) {
    console.error('Create aerobic contract error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la crearea contractului aerob',
      error: error.message
    });
  }
};

// ============================================================================
// UPDATE AEROBIC CONTRACT
// ============================================================================
export const updateAerobicContract = async (req, res) => {
  try {
    const { contractId } = req.params;
    const {
      institution_id,
      contract_number,
      contract_date_start,
      contract_date_end,
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
      service_start_date
    } = req.body;

    const query = `
      UPDATE aerobic_contracts SET
        institution_id = $1,
        contract_number = $2,
        contract_date_start = $3,
        contract_date_end = $4,
        sector_id = $5,
        tariff_per_ton = $6,
        estimated_quantity_tons = $7,
        associate_institution_id = $8,
        indicator_disposal_percent = $9,
        contract_file_url = $10,
        contract_file_name = $11,
        contract_file_size = $12,
        is_active = $13,
        notes = $14,
        attribution_type = $15,
        service_start_date = $16,
        updated_at = NOW()
      WHERE id = $17 AND deleted_at IS NULL
      RETURNING *
    `;

    const values = [
      institution_id,
      contract_number,
      contract_date_start,
      contract_date_end || null,
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
      service_start_date || null,
      contractId
    ];

    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Contract aerob negăsit'
      });
    }

    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Update aerobic contract error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la actualizarea contractului aerob'
    });
  }
};

// ============================================================================
// DELETE AEROBIC CONTRACT
// ============================================================================
export const deleteAerobicContract = async (req, res) => {
  try {
    const { contractId } = req.params;

    const query = `
      UPDATE aerobic_contracts 
      SET deleted_at = NOW()
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING id
    `;

    const result = await pool.query(query, [contractId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Contract aerob negăsit'
      });
    }

    res.json({
      success: true,
      message: 'Contract aerob șters cu succes'
    });
  } catch (error) {
    console.error('Delete aerobic contract error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la ștergerea contractului aerob'
    });
  }
};

// ============================================================================
// AEROBIC CONTRACT AMENDMENTS
// ============================================================================

const toNullIfEmpty = (v) => (v === '' ? null : v);

const ALLOWED_AEROBIC_AMENDMENT_TYPES = new Set([
  'MANUAL',
  'AUTO_TERMINATION',
  'PRELUNGIRE',
  'INCETARE',
  'MODIFICARE_TARIF',
  'MODIFICARE_CANTITATE',
  'MODIFICARE_INDICATOR',
  'MODIFICARE_VALABILITATE',
]);

const ensureAllowedAerobicAmendmentType = (amendment_type) => {
  const t = amendment_type ? String(amendment_type) : 'MANUAL';
  if (!ALLOWED_AEROBIC_AMENDMENT_TYPES.has(t)) {
    const allowed = Array.from(ALLOWED_AEROBIC_AMENDMENT_TYPES).join(', ');
    const err = new Error(`amendment_type invalid. Permise: ${allowed}`);
    err.statusCode = 400;
    throw err;
  }
  return t;
};

// ============================================================================
// GET ALL AMENDMENTS FOR AEROBIC CONTRACT
// ============================================================================
export const getAerobicContractAmendments = async (req, res) => {
  try {
    const { contractId } = req.params;

    const query = `
      SELECT
        aca.*,
        u.first_name || ' ' || u.last_name as created_by_name,
        rc.contract_number as reference_contract_number
      FROM aerobic_contract_amendments aca
      LEFT JOIN users u ON aca.created_by = u.id
      LEFT JOIN aerobic_contracts rc ON aca.reference_contract_id = rc.id
      WHERE aca.contract_id = $1 AND aca.deleted_at IS NULL
      ORDER BY aca.amendment_date DESC, aca.created_at DESC
    `;

    const result = await pool.query(query, [contractId]);

    res.json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    console.error('Get aerobic amendments error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la obținerea actelor adiționale pentru contract aerob',
    });
  }
};

// ============================================================================
// CREATE AMENDMENT FOR AEROBIC CONTRACT
// ============================================================================
export const createAerobicContractAmendment = async (req, res) => {
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
      reference_contract_id,
      quantity_adjustment_auto,
      new_indicator_disposal_percent,
      new_contract_date_start,
      new_service_start_date,
    } = req.body;

    const finalAmendmentType = ensureAllowedAerobicAmendmentType(amendment_type);

    // ======================================================================
    // PROPORTIONAL QUANTITY CALCULATION FOR EXTENSION (CUMULATIVE)
    // ======================================================================
    let finalQuantity = new_estimated_quantity_tons;
    let wasAutoCalculated = false;

    if (finalAmendmentType === 'PRELUNGIRE' && !new_estimated_quantity_tons && new_contract_date_end) {
      const contractData = await getContractDataForProportional(
        pool,
        'aerobic_contracts',
        contractId,
        'estimated_quantity_tons'
      );

      if (contractData) {
        const calculated = calculateProportionalQuantity({
          originalStartDate: contractData.contract_date_start,
          originalEndDate: contractData.contract_date_end,
          newEndDate: new_contract_date_end,
          originalQuantity: contractData.quantity,
          amendmentType: finalAmendmentType,
        });

        if (calculated !== null) {
          finalQuantity = calculated;
          wasAutoCalculated = true;
          console.log(`✅ Aerobic Amendment: CUMULATIVE proportional quantity auto-calculated: ${finalQuantity} t`);
        }
      }
    }

    const query = `
      INSERT INTO aerobic_contract_amendments (
        contract_id,
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
        reference_contract_id,
        quantity_adjustment_auto,
        new_indicator_disposal_percent,
        new_contract_date_start,
        new_service_start_date,
        created_by
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19
      )
      RETURNING *
    `;

    const values = [
      contractId,
      amendment_number,
      amendment_date,
      toNullIfEmpty(new_tariff_per_ton),
      toNullIfEmpty(finalQuantity),
      new_contract_date_end || null,
      finalAmendmentType,
      changes_description || null,
      reason || null,
      notes || null,
      amendment_file_url || null,
      amendment_file_name || null,
      amendment_file_size || null,
      reference_contract_id || null,
      toNullIfEmpty(quantity_adjustment_auto),
      toNullIfEmpty(new_indicator_disposal_percent),
      new_contract_date_start || null,
      new_service_start_date || null,
      req.user.id,
    ];

    const result = await pool.query(query, values);
    res.status(201).json({
      success: true,
      data: result.rows[0],
      quantity_auto_calculated: wasAutoCalculated,
    });
  } catch (error) {
    console.error('Create aerobic amendment error:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: 'Eroare la crearea actului adițional pentru contract aerob',
      error: error.message,
    });
  }
};

// ============================================================================
// UPDATE AMENDMENT FOR AEROBIC CONTRACT
// ============================================================================
export const updateAerobicContractAmendment = async (req, res) => {
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
      reference_contract_id,
      quantity_adjustment_auto,
      new_indicator_disposal_percent,
      new_contract_date_start,
      new_service_start_date,
    } = req.body;

    const finalAmendmentType = ensureAllowedAerobicAmendmentType(amendment_type);

    const query = `
      UPDATE aerobic_contract_amendments SET
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
        reference_contract_id = $13,
        quantity_adjustment_auto = $14,
        new_indicator_disposal_percent = $15,
        new_contract_date_start = $16,
        new_service_start_date = $17,
        updated_at = NOW()
      WHERE id = $18 AND contract_id = $19 AND deleted_at IS NULL
      RETURNING *
    `;

    const values = [
      amendment_number,
      amendment_date,
      toNullIfEmpty(new_tariff_per_ton),
      toNullIfEmpty(new_estimated_quantity_tons),
      new_contract_date_end || null,
      finalAmendmentType,
      changes_description || null,
      reason || null,
      notes || null,
      amendment_file_url || null,
      amendment_file_name || null,
      amendment_file_size || null,
      reference_contract_id || null,
      toNullIfEmpty(quantity_adjustment_auto),
      toNullIfEmpty(new_indicator_disposal_percent),
      new_contract_date_start || null,
      new_service_start_date || null,
      amendmentId,
      contractId,
    ];

    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Act adițional aerob negăsit' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Update aerobic amendment error:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: 'Eroare la actualizarea actului adițional pentru contract aerob',
      error: error.message,
    });
  }
};

// ============================================================================
// DELETE AMENDMENT FOR AEROBIC CONTRACT
// ============================================================================
export const deleteAerobicContractAmendment = async (req, res) => {
  try {
    const { contractId, amendmentId } = req.params;

    const query = `
      UPDATE aerobic_contract_amendments
      SET deleted_at = NOW()
      WHERE id = $1 AND contract_id = $2 AND deleted_at IS NULL
      RETURNING id
    `;

    const result = await pool.query(query, [amendmentId, contractId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Act adițional aerob negăsit' });
    }

    res.json({ success: true, message: 'Act adițional aerob șters cu succes' });
  } catch (error) {
    console.error('Delete aerobic amendment error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la ștergerea actului adițional pentru contract aerob',
    });
  }
};
