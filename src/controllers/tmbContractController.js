// controllers/tmbContractController.js
/**
 * ============================================================================
 * TMB CONTRACT CONTROLLER - ES6 VERSION
 * ============================================================================
 * CRUD operations pentru contracte TMB
 * ============================================================================
 */

import pool from '../config/database.js';

/**
 * GET all TMB contracts for an institution
 */
export const getTMBContracts = async (req, res) => {
    // Check if user has access to contracts page
    const { scopes } = req.userAccess;
    if (scopes?.contracts === 'NONE') {
      return res.status(403).json({ 
        success: false, 
        message: 'Nu aveți permisiune să accesați contractele' 
      });
    }

  try {
    const { institutionId } = req.params;

    const query = `
      SELECT 
        tc.id,
        tc.sector_id,
        tc.contract_number,
        tc.contract_date_start,
        tc.contract_date_end,
        tc.tariff_per_ton,
        tc.currency,
        tc.estimated_quantity_tons,
        tc.contract_value,
        tc.notes,
        tc.is_active,
        tc.created_at,
        tc.updated_at,
        tc.contract_file_url,
        tc.contract_file_name,
        tc.contract_file_size,
        tc.contract_file_uploaded_at,
        s.sector_number,
        s.sector_name,
        -- Get amendments
        COALESCE(
          json_agg(
            json_build_object(
              'id', tca.id,
              'amendment_number', tca.amendment_number,
              'amendment_date', tca.amendment_date,
              'new_tariff_per_ton', tca.new_tariff_per_ton,
              'new_estimated_quantity_tons', tca.new_estimated_quantity_tons,
              'new_contract_date_end', tca.new_contract_date_end,
              'amendment_value', tca.amendment_value,
              'reason', tca.reason,
              'notes', tca.notes,
              'created_at', tca.created_at
            ) ORDER BY tca.amendment_date DESC
          ) FILTER (WHERE tca.id IS NOT NULL),
          '[]'
        ) as amendments,
        -- Effective end date (from latest amendment or original)
        COALESCE(
          (SELECT new_contract_date_end 
           FROM tmb_contract_amendments 
           WHERE contract_id = tc.id 
             AND new_contract_date_end IS NOT NULL 
             AND deleted_at IS NULL
           ORDER BY amendment_date DESC 
           LIMIT 1),
          tc.contract_date_end
        ) as effective_end_date
      FROM tmb_contracts tc
      LEFT JOIN sectors s ON tc.sector_id = s.id
      LEFT JOIN tmb_contract_amendments tca ON tc.id = tca.contract_id AND tca.deleted_at IS NULL
      WHERE tc.deleted_at IS NULL
      GROUP BY 
        tc.id, 
        tc.sector_id,
        tc.contract_number,
        tc.contract_date_start,
        tc.contract_date_end,
        tc.tariff_per_ton,
        tc.currency,
        tc.estimated_quantity_tons,
        tc.contract_value,
        tc.notes,
        tc.is_active,
        tc.created_at,
        tc.updated_at,
        tc.contract_file_url,
        tc.contract_file_name,
        tc.contract_file_size,
        tc.contract_file_uploaded_at,
        s.sector_number,
        s.sector_name
      ORDER BY tc.contract_date_start DESC, tc.created_at DESC
    `;

    const result = await pool.query(query);

    res.json({
      success: true,
      data: result.rows
    });

  } catch (err) {
    console.error('Error fetching TMB contracts:', err);
    res.status(500).json({
      success: false,
      message: 'Eroare la încărcarea contractelor TMB'
    });
  }
};

/**
 * GET single TMB contract by ID
 */
export const getTMBContract = async (req, res) => {
  try {
    // Check if user has access to contracts page
    const { scopes } = req.userAccess;
    if (scopes?.contracts === 'NONE') {
      return res.status(403).json({ 
        success: false, 
        message: 'Nu aveți permisiune să accesați contractele' 
      });
    }

    const { institutionId, contractId } = req.params;

    const query = `
      SELECT 
        tc.*,
        s.sector_number,
        s.sector_name,
        COALESCE(
          json_agg(
            json_build_object(
              'id', tca.id,
              'amendment_number', tca.amendment_number,
              'amendment_date', tca.amendment_date,
              'new_tariff_per_ton', tca.new_tariff_per_ton,
              'new_estimated_quantity_tons', tca.new_estimated_quantity_tons,
              'new_contract_date_end', tca.new_contract_date_end,
              'amendment_value', tca.amendment_value,
              'reason', tca.reason,
              'notes', tca.notes,
              'created_at', tca.created_at
            ) ORDER BY tca.amendment_date DESC
          ) FILTER (WHERE tca.id IS NOT NULL),
          '[]'
        ) as amendments
      FROM tmb_contracts tc
      LEFT JOIN sectors s ON tc.sector_id = s.id
      LEFT JOIN tmb_contract_amendments tca ON tc.id = tca.contract_id AND tca.deleted_at IS NULL
      WHERE tc.id = $1 AND tc.deleted_at IS NULL
      GROUP BY tc.id, s.sector_number, s.sector_name
    `;

    const result = await pool.query(query, [contractId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Contract TMB nu a fost găsit'
      });
    }

    res.json({
      success: true,
      data: result.rows[0]
    });

  } catch (err) {
    console.error('Error fetching TMB contract:', err);
    res.status(500).json({
      success: false,
      message: 'Eroare la încărcarea contractului TMB'
    });
  }
};

/**
 * CREATE new TMB contract
 */
export const createTMBContract = async (req, res) => {
  try {
    // Check permission
    const { canCreateData } = req.userAccess;
    if (!canCreateData) {
      return res.status(403).json({ 
        success: false, 
        message: 'Nu aveți permisiune să creați contracte' 
      });
    }

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

    // Validation
    if (!contract_number || !contract_date_start || !tariff_per_ton) {
      return res.status(400).json({
        success: false,
        message: 'Câmpurile obligatorii lipsesc'
      });
    }

    // Check for duplicate contract number
    const duplicateCheck = await pool.query(
      'SELECT id FROM tmb_contracts WHERE contract_number = $1 AND deleted_at IS NULL',
      [contract_number]
    );

    if (duplicateCheck.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Există deja un contract cu acest număr'
      });
    }

    const query = `
      INSERT INTO tmb_contracts (
        sector_id,
        contract_number,
        contract_date_start,
        contract_date_end,
        tariff_per_ton,
        currency,
        estimated_quantity_tons,
        notes,
        is_active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `;

    const values = [
      sector_id || null,
      contract_number,
      contract_date_start,
      contract_date_end || null,
      tariff_per_ton,
      currency,
      estimated_quantity_tons || null,
      notes || null,
      is_active
    ];

    const result = await pool.query(query, values);

    res.status(201).json({
      success: true,
      message: 'Contract TMB creat cu succes',
      data: result.rows[0]
    });

  } catch (err) {
    console.error('Error creating TMB contract:', err);
    res.status(500).json({
      success: false,
      message: 'Eroare la crearea contractului TMB'
    });
  }
};

/**
 * UPDATE TMB contract
 */
export const updateTMBContract = async (req, res) => {
  try {
    // Check permission
    const { canEditData } = req.userAccess;
    if (!canEditData) {
      return res.status(403).json({ 
        success: false, 
        message: 'Nu aveți permisiune să editați contracte' 
      });
    }

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

    // Check if contract exists
    const existingContract = await pool.query(
      'SELECT id FROM tmb_contracts WHERE id = $1 AND deleted_at IS NULL',
      [contractId]
    );

    if (existingContract.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Contract TMB nu a fost găsit'
      });
    }

    // Check for duplicate contract number (excluding current contract)
    const duplicateCheck = await pool.query(
      'SELECT id FROM tmb_contracts WHERE contract_number = $1 AND id != $2 AND deleted_at IS NULL',
      [contract_number, contractId]
    );

    if (duplicateCheck.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Există deja un contract cu acest număr'
      });
    }

    const query = `
      UPDATE tmb_contracts SET
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

    const values = [
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
    ];

    const result = await pool.query(query, values);

    res.json({
      success: true,
      message: 'Contract TMB actualizat cu succes',
      data: result.rows[0]
    });

  } catch (err) {
    console.error('Error updating TMB contract:', err);
    res.status(500).json({
      success: false,
      message: 'Eroare la actualizarea contractului TMB'
    });
  }
};

/**
 * DELETE TMB contract (soft delete)
 */
export const deleteTMBContract = async (req, res) => {
  try {
    // Check permission
    const { canDeleteData } = req.userAccess;
    if (!canDeleteData) {
      return res.status(403).json({ 
        success: false, 
        message: 'Nu aveți permisiune să ștergeți contracte' 
      });
    }

    const { institutionId, contractId } = req.params;

    // Check if contract exists
    const existingContract = await pool.query(
      'SELECT id FROM tmb_contracts WHERE id = $1 AND deleted_at IS NULL',
      [contractId]
    );

    if (existingContract.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Contract TMB nu a fost găsit'
      });
    }

    const query = `
      UPDATE tmb_contracts 
      SET deleted_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING id
    `;

    await pool.query(query, [contractId]);

    res.json({
      success: true,
      message: 'Contract TMB șters cu succes'
    });

  } catch (err) {
    console.error('Error deleting TMB contract:', err);
    res.status(500).json({
      success: false,
      message: 'Eroare la ștergerea contractului TMB'
    });
  }
};