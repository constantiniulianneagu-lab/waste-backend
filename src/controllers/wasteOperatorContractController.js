// src/controllers/wasteCollectorContractController.js
/**
 * ============================================================================
 * WASTE COLLECTOR CONTRACT CONTROLLER (COL-)
 * ============================================================================
 */

import pool from '../config/database.js';
import { autoTerminateSimpleContracts } from '../utils/autoTermination.js';

// ============================================================================
// GET ALL WASTE COLLECTOR CONTRACTS
// ============================================================================
export const getWasteCollectorContracts = async (req, res) => {
  try {
    const { sector_id, is_active } = req.query;

    let whereConditions = ['wcc.deleted_at IS NULL'];
    const params = [];
    let paramCount = 1;

    if (sector_id) {
      whereConditions.push(`wcc.sector_id = $${paramCount}`);
      params.push(sector_id);
      paramCount++;
    }

    if (is_active !== undefined) {
      whereConditions.push(`wcc.is_active = $${paramCount}`);
      params.push(is_active === 'true' || is_active === true);
      paramCount++;
    }

    const whereClause = whereConditions.join(' AND ');

    const query = `
      SELECT
        wcc.id,
        wcc.institution_id,
        wcc.contract_number,
        wcc.contract_date_start,
        wcc.contract_date_end,
        wcc.service_start_date,
        wcc.sector_id,

        wcc.contract_file_url,
        wcc.contract_file_name,
        wcc.contract_file_size,
        wcc.contract_file_type,
        wcc.contract_file_uploaded_at,

        wcc.is_active,
        wcc.notes,
        wcc.created_by,
        wcc.created_at,
        wcc.updated_at,

        wcc.associate_institution_id,
        wcc.attribution_type,

        i.name as institution_name,
        i.short_name as institution_short_name,

        s.sector_number,
        s.sector_name,

        ai.name as associate_name,
        ai.short_name as associate_short_name,

        -- Effective end date (din amendments dacă există)
        COALESCE(
          (SELECT wcca.new_contract_date_end
           FROM waste_collector_contract_amendments wcca
           WHERE wcca.contract_id = wcc.id AND wcca.deleted_at IS NULL AND wcca.new_contract_date_end IS NOT NULL
           ORDER BY wcca.amendment_date DESC, wcca.id DESC
           LIMIT 1),
          wcc.contract_date_end
        ) as effective_date_end,

        (SELECT COUNT(*)
         FROM waste_collector_contract_amendments wcca
         WHERE wcca.contract_id = wcc.id AND wcca.deleted_at IS NULL
        ) as amendments_count

      FROM waste_collector_contracts wcc
      JOIN institutions i ON wcc.institution_id = i.id
      LEFT JOIN sectors s ON wcc.sector_id = s.id
      LEFT JOIN institutions ai ON wcc.associate_institution_id = ai.id
      WHERE ${whereClause}
      ORDER BY s.sector_number, wcc.contract_date_start DESC
    `;

    const result = await pool.query(query, params);

    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Get waste collector contracts error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la obținerea contractelor de colectare',
    });
  }
};

// ============================================================================
// GET SINGLE WASTE COLLECTOR CONTRACT
// ============================================================================
export const getWasteCollectorContract = async (req, res) => {
  try {
    const { contractId } = req.params;

    const query = `
      SELECT
        wcc.*,
        i.name as institution_name,
        i.short_name as institution_short_name,
        s.sector_number,
        s.sector_name,
        ai.name as associate_name,
        ai.short_name as associate_short_name
      FROM waste_collector_contracts wcc
      JOIN institutions i ON wcc.institution_id = i.id
      LEFT JOIN sectors s ON wcc.sector_id = s.id
      LEFT JOIN institutions ai ON wcc.associate_institution_id = ai.id
      WHERE wcc.id = $1 AND wcc.deleted_at IS NULL
    `;

    const result = await pool.query(query, [contractId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Contract de colectare negăsit',
      });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Get waste collector contract error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la obținerea contractului de colectare',
    });
  }
};

// ============================================================================
// CREATE WASTE COLLECTOR CONTRACT
// ============================================================================
export const createWasteCollectorContract = async (req, res) => {
  try {
    const {
      institution_id,
      contract_number,
      contract_date_start,
      contract_date_end,
      service_start_date,
      sector_id,
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
      INSERT INTO waste_collector_contracts (
        institution_id,
        contract_number,
        contract_date_start,
        contract_date_end,
        service_start_date,
        sector_id,
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
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16
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

    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Create waste collector contract error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la crearea contractului de colectare',
      error: error.message,
    });
  }
};

// ============================================================================
// UPDATE WASTE COLLECTOR CONTRACT
// ============================================================================
export const updateWasteCollectorContract = async (req, res) => {
  try {
    const { contractId } = req.params;

    // Citim vechiul service_start_date/sector_id ca să declanșăm auto-termination doar când se schimbă
    const prev = await pool.query(
      `SELECT sector_id, service_start_date FROM waste_collector_contracts WHERE id = $1 AND deleted_at IS NULL`,
      [contractId]
    );
    const prevRow = prev.rows?.[0] || null;
    const prevSector = prevRow?.sector_id || null;
    const prevService = prevRow?.service_start_date
      ? String(prevRow.service_start_date).slice(0, 10)
      : null;

    const {
      institution_id,
      contract_number,
      contract_date_start,
      contract_date_end,
      service_start_date,
      sector_id,
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
      UPDATE waste_collector_contracts SET
        institution_id = $1,
        contract_number = $2,
        contract_date_start = $3,
        contract_date_end = $4,
        service_start_date = $5,
        sector_id = $6,
        contract_file_url = $7,
        contract_file_name = $8,
        contract_file_size = $9,
        contract_file_type = $10,
        contract_file_uploaded_at = $11,
        is_active = $12,
        notes = $13,
        associate_institution_id = $14,
        attribution_type = $15,
        updated_at = NOW()
      WHERE id = $16 AND deleted_at IS NULL
      RETURNING *
    `;

    const values = [
      institution_id,
      contract_number,
      contract_date_start,
      contract_date_end || null,
      service_start_date || null,
      sector_id || null,
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
      return res.status(404).json({ success: false, message: 'Contract de colectare negăsit' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Update waste collector contract error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la actualizarea contractului de colectare',
      error: error.message,
    });
  }
};

// ============================================================================
// DELETE WASTE COLLECTOR CONTRACT
// ============================================================================
export const deleteWasteCollectorContract = async (req, res) => {
  try {
    const { contractId } = req.params;

    const query = `
      UPDATE waste_collector_contracts
      SET deleted_at = NOW()
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING id
    `;

    const result = await pool.query(query, [contractId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Contract de colectare negăsit' });
    }

    res.json({ success: true, message: 'Contract de colectare șters cu succes' });
  } catch (error) {
    console.error('Delete waste collector contract error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la ștergerea contractului de colectare',
    });
  }
};

// ============================================================================
// GET AMENDMENTS FOR WASTE COLLECTOR CONTRACT
// ============================================================================
export const getWasteCollectorContractAmendments = async (req, res) => {
  try {
    const { contractId } = req.params;

    const query = `
      SELECT *
      FROM waste_collector_contract_amendments
      WHERE contract_id = $1 AND deleted_at IS NULL
      ORDER BY amendment_date DESC, id DESC
    `;

    const result = await pool.query(query, [contractId]);

    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Get waste collector amendments error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la obținerea actelor adiționale (colectare)',
    });
  }
};

// ============================================================================
// CREATE AMENDMENT FOR WASTE COLLECTOR CONTRACT
// ============================================================================
export const createWasteCollectorContractAmendment = async (req, res) => {
  try {
    const { contractId } = req.params;

    const {
      amendment_number,
      amendment_date,
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
    } = req.body;

    const query = `
      INSERT INTO waste_collector_contract_amendments (
        contract_id,
        amendment_number,
        amendment_date,
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
        created_by
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14
      )
      RETURNING *
    `;

    const values = [
      contractId,
      amendment_number,
      amendment_date,
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
      req.user.id,
    ];

    const result = await pool.query(query, values);

    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Create waste collector amendment error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la crearea actului adițional (colectare)',
      error: error.message,
    });
  }
};

// ============================================================================
// UPDATE AMENDMENT FOR WASTE COLLECTOR CONTRACT
// ============================================================================
export const updateWasteCollectorContractAmendment = async (req, res) => {
  try {
    const { contractId, amendmentId } = req.params;

    const {
      amendment_number,
      amendment_date,
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
    } = req.body;

    const query = `
      UPDATE waste_collector_contract_amendments SET
        amendment_number = $1,
        amendment_date = $2,
        new_contract_date_end = $3,
        new_contract_date_start = $4,
        amendment_type = $5,
        changes_description = $6,
        reason = $7,
        notes = $8,
        amendment_file_url = $9,
        amendment_file_name = $10,
        amendment_file_size = $11,
        reference_contract_id = $12,
        updated_at = NOW()
      WHERE id = $13 AND contract_id = $14 AND deleted_at IS NULL
      RETURNING *
    `;

    const values = [
      amendment_number,
      amendment_date,
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
      amendmentId,
      contractId,
    ];

    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Act adițional (colectare) negăsit' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Update waste collector amendment error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la actualizarea actului adițional (colectare)',
      error: error.message,
    });
  }
};

// ============================================================================
// DELETE AMENDMENT FOR WASTE COLLECTOR CONTRACT
// ============================================================================
export const deleteWasteCollectorContractAmendment = async (req, res) => {
  try {
    const { contractId, amendmentId } = req.params;

    const query = `
      UPDATE waste_collector_contract_amendments
      SET deleted_at = NOW()
      WHERE id = $1 AND contract_id = $2 AND deleted_at IS NULL
      RETURNING id
    `;

    const result = await pool.query(query, [amendmentId, contractId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Act adițional (colectare) negăsit' });
    }

    res.json({ success: true, message: 'Act adițional (colectare) șters cu succes' });
  } catch (error) {
    console.error('Delete waste collector amendment error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la ștergerea actului adițional (colectare)',
    });
  }
};