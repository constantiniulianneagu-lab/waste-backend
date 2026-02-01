/**
 * ============================================================================
 * TMB CONTRACT CONTROLLER (TMB-)
 * ============================================================================
 */

import pool from '../config/database.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const ALLOWED_TMB_AMENDMENT_TYPES = new Set([
  'MANUAL',
  'AUTO_TERMINATION',
  'PRELUNGIRE',
  'INCETARE',
  'MODIFICARE_TARIF',
  'MODIFICARE_CANTITATE',
  'MODIFICARE_INDICATORI',
  'MODIFICARE_VALABILITATE',
]);

const toNullIfEmpty = (v) => (v === '' ? null : v);

const ensureAllowedAmendmentType = (amendment_type) => {
  const t = amendment_type ? String(amendment_type) : 'MANUAL';
  if (!ALLOWED_TMB_AMENDMENT_TYPES.has(t)) {
    const allowed = Array.from(ALLOWED_TMB_AMENDMENT_TYPES).join(', ');
    const err = new Error(`amendment_type invalid. Permise: ${allowed}`);
    err.statusCode = 400;
    throw err;
  }
  return t;
};

// ============================================================================
// GET ALL TMB CONTRACTS
// ============================================================================
export const getTMBContracts = async (req, res) => {
  try {
    const { sector_id, is_active } = req.query;

    let whereConditions = ['tc.deleted_at IS NULL'];
    const params = [];
    let paramCount = 1;

    if (sector_id) {
      whereConditions.push(`tc.sector_id = $${paramCount}`);
      params.push(sector_id);
      paramCount++;
    }

    if (is_active !== undefined) {
      whereConditions.push(`tc.is_active = $${paramCount}`);
      params.push(is_active === 'true' || is_active === true);
      paramCount++;
    }

    const whereClause = whereConditions.join(' AND ');

    const query = `
      SELECT
        tc.id,
        tc.institution_id,
        tc.sector_id,
        tc.contract_number,
        tc.contract_date_start,
        tc.contract_date_end,
        tc.service_start_date,
        tc.tariff_per_ton,
        tc.estimated_quantity_tons,
        tc.contract_value,
        tc.currency,
        tc.notes,
        tc.is_active,
        tc.contract_file_url,
        tc.contract_file_name,
        tc.contract_file_size,
        tc.contract_file_type,
        tc.contract_file_uploaded_at,
        tc.associate_institution_id,
        tc.indicator_recycling_percent,
        tc.indicator_energy_recovery_percent,
        tc.indicator_disposal_percent,
        tc.attribution_type,
        tc.created_by,
        tc.created_at,
        tc.updated_at,

        s.sector_number,
        s.sector_name,

        i.name as institution_name,
        i.short_name as institution_short_name,

        ai.name as associate_name,
        ai.short_name as associate_short_name,

        -- Effective fields (din amendments dacă există)
        COALESCE(
          (SELECT tca.new_contract_date_end
           FROM tmb_contract_amendments tca
           WHERE tca.contract_id = tc.id AND tca.deleted_at IS NULL AND tca.new_contract_date_end IS NOT NULL
           ORDER BY tca.amendment_date DESC, tca.id DESC
           LIMIT 1),
          tc.contract_date_end
        ) as effective_date_end,

        COALESCE(
          (SELECT tca.new_tariff_per_ton
           FROM tmb_contract_amendments tca
           WHERE tca.contract_id = tc.id AND tca.deleted_at IS NULL AND tca.new_tariff_per_ton IS NOT NULL
           ORDER BY tca.amendment_date DESC, tca.id DESC
           LIMIT 1),
          tc.tariff_per_ton
        ) as effective_tariff,

        COALESCE(
          (SELECT tca.new_estimated_quantity_tons
           FROM tmb_contract_amendments tca
           WHERE tca.contract_id = tc.id AND tca.deleted_at IS NULL AND tca.new_estimated_quantity_tons IS NOT NULL
           ORDER BY tca.amendment_date DESC, tca.id DESC
           LIMIT 1),
          tc.estimated_quantity_tons
        ) as effective_quantity,

        COALESCE(
          (SELECT tca.new_indicator_recycling_percent
           FROM tmb_contract_amendments tca
           WHERE tca.contract_id = tc.id AND tca.deleted_at IS NULL AND tca.new_indicator_recycling_percent IS NOT NULL
           ORDER BY tca.amendment_date DESC, tca.id DESC
           LIMIT 1),
          tc.indicator_recycling_percent
        ) as effective_indicator_recycling_percent,

        COALESCE(
          (SELECT tca.new_indicator_energy_recovery_percent
           FROM tmb_contract_amendments tca
           WHERE tca.contract_id = tc.id AND tca.deleted_at IS NULL AND tca.new_indicator_energy_recovery_percent IS NOT NULL
           ORDER BY tca.amendment_date DESC, tca.id DESC
           LIMIT 1),
          tc.indicator_energy_recovery_percent
        ) as effective_indicator_energy_recovery_percent,

        COALESCE(
          (SELECT tca.new_indicator_disposal_percent
           FROM tmb_contract_amendments tca
           WHERE tca.contract_id = tc.id AND tca.deleted_at IS NULL AND tca.new_indicator_disposal_percent IS NOT NULL
           ORDER BY tca.amendment_date DESC, tca.id DESC
           LIMIT 1),
          tc.indicator_disposal_percent
        ) as effective_indicator_disposal_percent,

        (
          COALESCE(
            (SELECT tca.new_tariff_per_ton
             FROM tmb_contract_amendments tca
             WHERE tca.contract_id = tc.id AND tca.deleted_at IS NULL AND tca.new_tariff_per_ton IS NOT NULL
             ORDER BY tca.amendment_date DESC, tca.id DESC
             LIMIT 1),
            tc.tariff_per_ton
          )
          *
          COALESCE(
            (SELECT tca.new_estimated_quantity_tons
             FROM tmb_contract_amendments tca
             WHERE tca.contract_id = tc.id AND tca.deleted_at IS NULL AND tca.new_estimated_quantity_tons IS NOT NULL
             ORDER BY tca.amendment_date DESC, tca.id DESC
             LIMIT 1),
            tc.estimated_quantity_tons
          )
        ) as effective_total_value,

        (SELECT COUNT(*)
         FROM tmb_contract_amendments tca
         WHERE tca.contract_id = tc.id AND tca.deleted_at IS NULL
        ) as amendments_count

      FROM tmb_contracts tc
      JOIN sectors s ON tc.sector_id = s.id
      LEFT JOIN institutions i ON tc.institution_id = i.id
      LEFT JOIN institutions ai ON tc.associate_institution_id = ai.id
      WHERE ${whereClause}
      ORDER BY s.sector_number, tc.contract_date_start DESC
    `;

    const result = await pool.query(query, params);
    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Get TMB contracts error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la obținerea contractelor TMB',
    });
  }
};

// ============================================================================
// GET SINGLE TMB CONTRACT
// ============================================================================
export const getTMBContract = async (req, res) => {
  try {
    const { contractId } = req.params;

    const query = `
      SELECT
        tc.*,
        s.sector_number,
        s.sector_name,
        i.name as institution_name,
        i.short_name as institution_short_name,
        ai.name as associate_name,
        ai.short_name as associate_short_name
      FROM tmb_contracts tc
      JOIN sectors s ON tc.sector_id = s.id
      LEFT JOIN institutions i ON tc.institution_id = i.id
      LEFT JOIN institutions ai ON tc.associate_institution_id = ai.id
      WHERE tc.id = $1 AND tc.deleted_at IS NULL
    `;

    const result = await pool.query(query, [contractId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Contract TMB negăsit',
      });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Get TMB contract error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la obținerea contractului TMB',
    });
  }
};

// ============================================================================
// CREATE TMB CONTRACT
// ============================================================================
export const createTMBContract = async (req, res) => {
  try {
    const {
      sector_id,
      institution_id,
      contract_number,
      contract_date_start,
      contract_date_end,
      service_start_date, // ✅ câmp operațional pe contract, NU prin amendments
      tariff_per_ton,
      currency,
      estimated_quantity_tons,
      associate_institution_id,
      indicator_recycling_percent,
      indicator_energy_recovery_percent,
      indicator_disposal_percent,
      contract_file_url,
      contract_file_name,
      contract_file_size,
      contract_file_type,
      contract_file_uploaded_at,
      is_active,
      notes,
      attribution_type,
    } = req.body;

    const query = `
      INSERT INTO tmb_contracts (
        sector_id,
        institution_id,
        contract_number,
        contract_date_start,
        contract_date_end,
        service_start_date,
        tariff_per_ton,
        currency,
        estimated_quantity_tons,
        associate_institution_id,
        indicator_recycling_percent,
        indicator_energy_recovery_percent,
        indicator_disposal_percent,
        contract_file_url,
        contract_file_name,
        contract_file_size,
        contract_file_type,
        contract_file_uploaded_at,
        is_active,
        notes,
        attribution_type,
        created_by
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22
      )
      RETURNING *
    `;

    const values = [
      sector_id,
      institution_id || null,
      contract_number,
      contract_date_start,
      contract_date_end || null,
      service_start_date || null,
      toNullIfEmpty(tariff_per_ton),
      currency || 'RON',
      toNullIfEmpty(estimated_quantity_tons),
      associate_institution_id || null,
      toNullIfEmpty(indicator_recycling_percent),
      toNullIfEmpty(indicator_energy_recovery_percent),
      toNullIfEmpty(indicator_disposal_percent),
      contract_file_url || null,
      contract_file_name || null,
      contract_file_size || null,
      contract_file_type || 'application/pdf',
      contract_file_uploaded_at || null,
      is_active !== undefined ? is_active : true,
      notes || null,
      attribution_type || null,
      req.user.id,
    ];

    const result = await pool.query(query, values);

    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Create TMB contract error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la crearea contractului TMB',
      error: error.message,
    });
  }
};

// ============================================================================
// UPDATE TMB CONTRACT
// ============================================================================
export const updateTMBContract = async (req, res) => {
  try {
    const { contractId } = req.params;

    const {
      sector_id,
      institution_id,
      contract_number,
      contract_date_start,
      contract_date_end,
      service_start_date, // ✅ operațional, update direct pe contract
      tariff_per_ton,
      currency,
      estimated_quantity_tons,
      associate_institution_id,
      indicator_recycling_percent,
      indicator_energy_recovery_percent,
      indicator_disposal_percent,
      contract_file_url,
      contract_file_name,
      contract_file_size,
      contract_file_type,
      contract_file_uploaded_at,
      is_active,
      notes,
      attribution_type,
    } = req.body;

    const query = `
      UPDATE tmb_contracts SET
        sector_id = $1,
        institution_id = $2,
        contract_number = $3,
        contract_date_start = $4,
        contract_date_end = $5,
        service_start_date = $6,
        tariff_per_ton = $7,
        currency = $8,
        estimated_quantity_tons = $9,
        associate_institution_id = $10,
        indicator_recycling_percent = $11,
        indicator_energy_recovery_percent = $12,
        indicator_disposal_percent = $13,
        contract_file_url = $14,
        contract_file_name = $15,
        contract_file_size = $16,
        contract_file_type = $17,
        contract_file_uploaded_at = $18,
        is_active = $19,
        notes = $20,
        attribution_type = $21,
        updated_at = NOW()
      WHERE id = $22 AND deleted_at IS NULL
      RETURNING *
    `;

    const values = [
      sector_id,
      institution_id || null,
      contract_number,
      contract_date_start,
      contract_date_end || null,
      service_start_date || null,
      toNullIfEmpty(tariff_per_ton),
      currency || 'RON',
      toNullIfEmpty(estimated_quantity_tons),
      associate_institution_id || null,
      toNullIfEmpty(indicator_recycling_percent),
      toNullIfEmpty(indicator_energy_recovery_percent),
      toNullIfEmpty(indicator_disposal_percent),
      contract_file_url || null,
      contract_file_name || null,
      contract_file_size || null,
      contract_file_type || 'application/pdf',
      contract_file_uploaded_at || null,
      is_active,
      notes || null,
      attribution_type || null,
      contractId,
    ];

    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Contract TMB negăsit' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Update TMB contract error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la actualizarea contractului TMB',
      error: error.message,
    });
  }
};

// ============================================================================
// DELETE TMB CONTRACT
// ============================================================================
export const deleteTMBContract = async (req, res) => {
  try {
    const { contractId } = req.params;

    const query = `
      UPDATE tmb_contracts
      SET deleted_at = NOW()
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING id
    `;

    const result = await pool.query(query, [contractId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Contract TMB negăsit' });
    }

    res.json({ success: true, message: 'Contract TMB șters cu succes' });
  } catch (error) {
    console.error('Delete TMB contract error:', error);
    res.status(500).json({ success: false, message: 'Eroare la ștergerea contractului TMB' });
  }
};

// ============================================================================
// GET AMENDMENTS FOR TMB CONTRACT
// ============================================================================
export const getTMBContractAmendments = async (req, res) => {
  try {
    const { contractId } = req.params;

    const query = `
      SELECT *
      FROM tmb_contract_amendments
      WHERE contract_id = $1 AND deleted_at IS NULL
      ORDER BY amendment_date DESC, id DESC
    `;

    const result = await pool.query(query, [contractId]);
    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Get TMB amendments error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la obținerea actelor adiționale TMB',
    });
  }
};

// ============================================================================
// CREATE AMENDMENT FOR TMB CONTRACT
// ============================================================================
export const createTMBContractAmendment = async (req, res) => {
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
      new_indicator_recycling_percent,
      new_indicator_energy_recovery_percent,
      new_indicator_disposal_percent,
      new_contract_date_start,
      // IMPORTANT: amendments NU modifică service_start_date
    } = req.body;

    const finalAmendmentType = ensureAllowedAmendmentType(amendment_type);

    const query = `
      INSERT INTO tmb_contract_amendments (
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
        new_indicator_recycling_percent,
        new_indicator_energy_recovery_percent,
        new_indicator_disposal_percent,
        new_contract_date_start,
        created_by
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20
      )
      RETURNING *
    `;

    const values = [
      contractId,
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
      toNullIfEmpty(new_indicator_recycling_percent),
      toNullIfEmpty(new_indicator_energy_recovery_percent),
      toNullIfEmpty(new_indicator_disposal_percent),
      new_contract_date_start || null,
      req.user.id,
    ];

    const result = await pool.query(query, values);
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Create TMB amendment error:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: 'Eroare la crearea actului adițional TMB',
      error: error.message,
    });
  }
};

// ============================================================================
// UPDATE AMENDMENT FOR TMB CONTRACT
// ============================================================================
export const updateTMBContractAmendment = async (req, res) => {
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
      new_indicator_recycling_percent,
      new_indicator_energy_recovery_percent,
      new_indicator_disposal_percent,
      new_contract_date_start,
      // IMPORTANT: amendments NU modifică service_start_date
    } = req.body;

    const finalAmendmentType = ensureAllowedAmendmentType(amendment_type);

    const query = `
      UPDATE tmb_contract_amendments SET
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
        new_indicator_recycling_percent = $15,
        new_indicator_energy_recovery_percent = $16,
        new_indicator_disposal_percent = $17,
        new_contract_date_start = $18,
        updated_at = NOW()
      WHERE id = $19 AND contract_id = $20 AND deleted_at IS NULL
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
      toNullIfEmpty(new_indicator_recycling_percent),
      toNullIfEmpty(new_indicator_energy_recovery_percent),
      toNullIfEmpty(new_indicator_disposal_percent),
      new_contract_date_start || null,
      amendmentId,
      contractId,
    ];

    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Act adițional TMB negăsit' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Update TMB amendment error:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: 'Eroare la actualizarea actului adițional TMB',
      error: error.message,
    });
  }
};

// ============================================================================
// DELETE AMENDMENT FOR TMB CONTRACT
// ============================================================================
export const deleteTMBContractAmendment = async (req, res) => {
  try {
    const { contractId, amendmentId } = req.params;

    const query = `
      UPDATE tmb_contract_amendments
      SET deleted_at = NOW()
      WHERE id = $1 AND contract_id = $2 AND deleted_at IS NULL
      RETURNING id
    `;

    const result = await pool.query(query, [amendmentId, contractId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Act adițional TMB negăsit' });
    }

    res.json({ success: true, message: 'Act adițional TMB șters cu succes' });
  } catch (error) {
    console.error('Delete TMB amendment error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la ștergerea actului adițional TMB',
    });
  }
};
