// src/controllers/sortingOperatorContractController.js
/**
 * ============================================================================
 * SORTING OPERATOR CONTRACT CONTROLLER (SORT-)
 * ============================================================================
 */

import pool from '../config/database.js';
import { autoTerminateSimpleContracts } from '../utils/autoTermination.js';

// ============================================================================
// GET ALL SORTING OPERATOR CONTRACTS
// ============================================================================
export const getSortingOperatorContracts = async (req, res) => {
  try {
    const { sector_id, is_active } = req.query;

    let whereConditions = ['soc.deleted_at IS NULL'];
    const params = [];
    let paramCount = 1;

    if (sector_id) {
      whereConditions.push(`soc.sector_id = $${paramCount}`);
      params.push(sector_id);
      paramCount++;
    }

    if (is_active !== undefined) {
      whereConditions.push(`soc.is_active = $${paramCount}`);
      params.push(is_active === 'true' || is_active === true);
      paramCount++;
    }

    const whereClause = whereConditions.join(' AND ');

    const query = `
      SELECT
        soc.id,
        soc.institution_id,
        soc.contract_number,
        soc.contract_date_start,
        soc.contract_date_end,
        soc.service_start_date,
        soc.sector_id,
        soc.tariff_per_ton,
        soc.estimated_quantity_tons,
        soc.contract_value,
        soc.currency,
        soc.contract_file_url,
        soc.contract_file_name,
        soc.contract_file_size,
        soc.contract_file_type,
        soc.contract_file_uploaded_at,
        soc.is_active,
        soc.notes,
        soc.created_by,
        soc.created_at,
        soc.updated_at,
        soc.associate_institution_id,
        soc.attribution_type,

        i.name as institution_name,
        i.short_name as institution_short_name,

        s.sector_number,
        s.sector_name,

        ai.name as associate_name,
        ai.short_name as associate_short_name,

        -- Effective values (din amendments dacă există)
        COALESCE(
          (SELECT soca.new_contract_date_end
           FROM sorting_operator_contract_amendments soca
           WHERE soca.contract_id = soc.id AND soca.deleted_at IS NULL AND soca.new_contract_date_end IS NOT NULL
           ORDER BY soca.amendment_date DESC, soca.id DESC
           LIMIT 1),
          soc.contract_date_end
        ) as effective_date_end,

        COALESCE(
          (SELECT soca.new_tariff_per_ton
           FROM sorting_operator_contract_amendments soca
           WHERE soca.contract_id = soc.id AND soca.deleted_at IS NULL AND soca.new_tariff_per_ton IS NOT NULL
           ORDER BY soca.amendment_date DESC, soca.id DESC
           LIMIT 1),
          soc.tariff_per_ton
        ) as effective_tariff,

        COALESCE(
          (SELECT soca.new_estimated_quantity_tons
           FROM sorting_operator_contract_amendments soca
           WHERE soca.contract_id = soc.id AND soca.deleted_at IS NULL AND soca.new_estimated_quantity_tons IS NOT NULL
           ORDER BY soca.amendment_date DESC, soca.id DESC
           LIMIT 1),
          soc.estimated_quantity_tons
        ) as effective_quantity,

        (
          COALESCE(
            (SELECT soca.new_tariff_per_ton
             FROM sorting_operator_contract_amendments soca
             WHERE soca.contract_id = soc.id AND soca.deleted_at IS NULL AND soca.new_tariff_per_ton IS NOT NULL
             ORDER BY soca.amendment_date DESC, soca.id DESC
             LIMIT 1),
            soc.tariff_per_ton
          )
          *
          COALESCE(
            (SELECT soca.new_estimated_quantity_tons
             FROM sorting_operator_contract_amendments soca
             WHERE soca.contract_id = soc.id AND soca.deleted_at IS NULL AND soca.new_estimated_quantity_tons IS NOT NULL
             ORDER BY soca.amendment_date DESC, soca.id DESC
             LIMIT 1),
            soc.estimated_quantity_tons
          )
        ) as effective_total_value,

        (SELECT COUNT(*)
         FROM sorting_operator_contract_amendments soca
         WHERE soca.contract_id = soc.id AND soca.deleted_at IS NULL
        ) as amendments_count

      FROM sorting_operator_contracts soc
      JOIN institutions i ON soc.institution_id = i.id
      LEFT JOIN sectors s ON soc.sector_id = s.id
      LEFT JOIN institutions ai ON soc.associate_institution_id = ai.id
      WHERE ${whereClause}
      ORDER BY s.sector_number, soc.contract_date_start DESC
    `;

    const result = await pool.query(query, params);

    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Get sorting operator contracts error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la obținerea contractelor de sortare',
    });
  }
};

// ============================================================================
// GET SINGLE SORTING OPERATOR CONTRACT
// ============================================================================
export const getSortingOperatorContract = async (req, res) => {
  try {
    const { contractId } = req.params;

    const query = `
      SELECT
        soc.*,
        i.name as institution_name,
        i.short_name as institution_short_name,
        s.sector_number,
        s.sector_name,
        ai.name as associate_name,
        ai.short_name as associate_short_name
      FROM sorting_operator_contracts soc
      JOIN institutions i ON soc.institution_id = i.id
      LEFT JOIN sectors s ON soc.sector_id = s.id
      LEFT JOIN institutions ai ON soc.associate_institution_id = ai.id
      WHERE soc.id = $1 AND soc.deleted_at IS NULL
    `;

    const result = await pool.query(query, [contractId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Contract de sortare negăsit',
      });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Get sorting operator contract error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la obținerea contractului de sortare',
    });
  }
};

// ============================================================================
// CREATE SORTING OPERATOR CONTRACT
// ============================================================================
export const createSortingOperatorContract = async (req, res) => {
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
      currency,
      contract_file_url,
      contract_file_name,
      contract_file_size,
      contract_file_type,
      contract_file_uploaded_at,
      is_active,
      notes,
      associate_institution_id,
      attribution_type,
    } = req.body;

    const query = `
      INSERT INTO sorting_operator_contracts (
        institution_id,
        contract_number,
        contract_date_start,
        contract_date_end,
        service_start_date,
        sector_id,
        tariff_per_ton,
        estimated_quantity_tons,
        contract_value,
        currency,
        contract_file_url,
        contract_file_name,
        contract_file_size,
        contract_file_type,
        contract_file_uploaded_at,
        is_active,
        notes,
        created_by,
        associate_institution_id,
        attribution_type
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,
        COALESCE($8, 0) * $7,
        $9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19
      )
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
      currency || 'RON',
      contract_file_url || null,
      contract_file_name || null,
      contract_file_size || null,
      contract_file_type || 'application/pdf',
      contract_file_uploaded_at || null,
      is_active !== undefined ? is_active : true,
      notes || null,
      req.user.id,
      associate_institution_id || null,
      attribution_type || null,
    ];

    const result = await pool.query(query, values);
    const savedContract = result.rows[0];

    // AUTO-TERMINATION (non-blocking): doar dacă avem service_start_date + sector_id
    let autoTermination = null;
    if (service_start_date && sector_id) {
      try {
        autoTermination = await autoTerminateSimpleContracts({
          contractType: 'SORTING',
          sectorId: sector_id,
          serviceStartDate: service_start_date,
          newContractId: savedContract.id,
          newContractNumber: contract_number,
          userId: req.user.id
        });
      } catch (e) {
        console.error('Auto-termination error (sorting create):', e);
      }
    }

    res.status(201).json({
      success: true,
      data: savedContract,
      auto_termination: autoTermination
    });
  } catch (error) {
    console.error('Create sorting operator contract error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la crearea contractului de sortare',
      error: error.message,
    });
  }
};

// ============================================================================
// UPDATE SORTING OPERATOR CONTRACT
// ============================================================================
export const updateSortingOperatorContract = async (req, res) => {
  try {
    const { contractId } = req.params;

    const {
      institution_id,
      contract_number,
      contract_date_start,
      contract_date_end,
      service_start_date,
      sector_id,
      tariff_per_ton,
      estimated_quantity_tons,
      currency,
      contract_file_url,
      contract_file_name,
      contract_file_size,
      contract_file_type,
      contract_file_uploaded_at,
      is_active,
      notes,
      associate_institution_id,
      attribution_type,
    } = req.body;

    const query = `
      UPDATE sorting_operator_contracts SET
        institution_id = $1,
        contract_number = $2,
        contract_date_start = $3,
        contract_date_end = $4,
        service_start_date = $5,
        sector_id = $6,
        tariff_per_ton = $7,
        estimated_quantity_tons = $8,
        contract_value = COALESCE($8, 0) * $7,
        currency = $9,
        contract_file_url = $10,
        contract_file_name = $11,
        contract_file_size = $12,
        contract_file_type = $13,
        contract_file_uploaded_at = $14,
        is_active = $15,
        notes = $16,
        associate_institution_id = $17,
        attribution_type = $18,
        updated_at = NOW()
      WHERE id = $19 AND deleted_at IS NULL
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
      currency || 'RON',
      contract_file_url || null,
      contract_file_name || null,
      contract_file_size || null,
      contract_file_type || 'application/pdf',
      contract_file_uploaded_at || null,
      is_active,
      notes || null,
      associate_institution_id || null,
      attribution_type || null,
      contractId,
    ];

    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Contract de sortare negăsit' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Update sorting operator contract error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la actualizarea contractului de sortare',
      error: error.message,
    });
  }
};

// ============================================================================
// DELETE SORTING OPERATOR CONTRACT
// ============================================================================
export const deleteSortingOperatorContract = async (req, res) => {
  try {
    const { contractId } = req.params;

    const query = `
      UPDATE sorting_operator_contracts
      SET deleted_at = NOW()
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING id
    `;

    const result = await pool.query(query, [contractId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Contract de sortare negăsit' });
    }

    res.json({ success: true, message: 'Contract de sortare șters cu succes' });
  } catch (error) {
    console.error('Delete sorting operator contract error:', error);
    res.status(500).json({ success: false, message: 'Eroare la ștergerea contractului de sortare' });
  }
};

// ============================================================================
// GET AMENDMENTS FOR SORTING OPERATOR CONTRACT
// ============================================================================
export const getSortingOperatorContractAmendments = async (req, res) => {
  try {
    const { contractId } = req.params;

    const query = `
      SELECT *
      FROM sorting_operator_contract_amendments
      WHERE contract_id = $1 AND deleted_at IS NULL
      ORDER BY amendment_date DESC, id DESC
    `;

    const result = await pool.query(query, [contractId]);

    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Get sorting amendments error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la obținerea actelor adiționale (sortare)',
    });
  }
};

// ============================================================================
// CREATE AMENDMENT FOR SORTING OPERATOR CONTRACT
// ============================================================================
export const createSortingOperatorContractAmendment = async (req, res) => {
  try {
    const { contractId } = req.params;

    const {
      amendment_number,
      amendment_date,
      new_tariff_per_ton,
      new_estimated_quantity_tons,
      new_contract_date_end,
      new_contract_date_start,
      amendment_type,
      changes_description,
      reason,
      notes,
      amendment_file_url,
      amendment_file_name,
      amendment_file_size,
      reference_contract_id,
      quantity_adjustment_auto,
    } = req.body;

    const query = `
      INSERT INTO sorting_operator_contract_amendments (
        contract_id,
        amendment_number,
        amendment_date,
        new_tariff_per_ton,
        new_estimated_quantity_tons,
        new_contract_date_end,
        new_contract_date_start,
        amendment_type,
        changes_description,
        reason,
        notes,
        amendment_file_url,
        amendment_file_name,
        amendment_file_size,
        reference_contract_id,
        quantity_adjustment_auto,
        created_by
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17
      )
      RETURNING *
    `;

    const values = [
      contractId,
      amendment_number,
      amendment_date,
      new_tariff_per_ton === '' ? null : new_tariff_per_ton,
      new_estimated_quantity_tons === '' ? null : new_estimated_quantity_tons,
      new_contract_date_end || null,
      new_contract_date_start || null,
      amendment_type || null,
      changes_description || null,
      reason || null,
      notes || null,
      amendment_file_url || null,
      amendment_file_name || null,
      amendment_file_size || null,
      reference_contract_id || null,
      quantity_adjustment_auto === '' ? null : quantity_adjustment_auto,
      req.user.id,
    ];

    const result = await pool.query(query, values);

    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Create sorting amendment error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la crearea actului adițional (sortare)',
      error: error.message,
    });
  }
};

// ============================================================================
// UPDATE AMENDMENT FOR SORTING OPERATOR CONTRACT
// ============================================================================
export const updateSortingOperatorContractAmendment = async (req, res) => {
  try {
    const { contractId, amendmentId } = req.params;

    const {
      amendment_number,
      amendment_date,
      new_tariff_per_ton,
      new_estimated_quantity_tons,
      new_contract_date_end,
      new_contract_date_start,
      amendment_type,
      changes_description,
      reason,
      notes,
      amendment_file_url,
      amendment_file_name,
      amendment_file_size,
      reference_contract_id,
      quantity_adjustment_auto,
    } = req.body;

    const query = `
      UPDATE sorting_operator_contract_amendments SET
        amendment_number = $1,
        amendment_date = $2,
        new_tariff_per_ton = $3,
        new_estimated_quantity_tons = $4,
        new_contract_date_end = $5,
        new_contract_date_start = $6,
        amendment_type = $7,
        changes_description = $8,
        reason = $9,
        notes = $10,
        amendment_file_url = $11,
        amendment_file_name = $12,
        amendment_file_size = $13,
        reference_contract_id = $14,
        quantity_adjustment_auto = $15,
        updated_at = NOW()
      WHERE id = $16 AND contract_id = $17 AND deleted_at IS NULL
      RETURNING *
    `;

    const values = [
      amendment_number,
      amendment_date,
      new_tariff_per_ton === '' ? null : new_tariff_per_ton,
      new_estimated_quantity_tons === '' ? null : new_estimated_quantity_tons,
      new_contract_date_end || null,
      new_contract_date_start || null,
      amendment_type || null,
      changes_description || null,
      reason || null,
      notes || null,
      amendment_file_url || null,
      amendment_file_name || null,
      amendment_file_size || null,
      reference_contract_id || null,
      quantity_adjustment_auto === '' ? null : quantity_adjustment_auto,
      amendmentId,
      contractId,
    ];

    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Act adițional (sortare) negăsit' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Update sorting amendment error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la actualizarea actului adițional (sortare)',
      error: error.message,
    });
  }
};

// ============================================================================
// DELETE AMENDMENT FOR SORTING OPERATOR CONTRACT
// ============================================================================
export const deleteSortingOperatorContractAmendment = async (req, res) => {
  try {
    const { contractId, amendmentId } = req.params;

    const query = `
      UPDATE sorting_operator_contract_amendments
      SET deleted_at = NOW()
      WHERE id = $1 AND contract_id = $2 AND deleted_at IS NULL
      RETURNING id
    `;

    const result = await pool.query(query, [amendmentId, contractId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Act adițional (sortare) negăsit' });
    }

    res.json({ success: true, message: 'Act adițional (sortare) șters cu succes' });
  } catch (error) {
    console.error('Delete sorting amendment error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la ștergerea actului adițional (sortare)',
    });
  }
};