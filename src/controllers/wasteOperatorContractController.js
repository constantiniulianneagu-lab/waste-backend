// src/controllers/wasteOperatorContractController.js
/**
 * ============================================================================
 * WASTE OPERATOR (WASTE COLLECTOR) CONTRACT CONTROLLER
 * ============================================================================
 * FIXED / UPDATED (din files.zip):
 * - Added auto-termination on CREATE + UPDATE (non-blocking) using autoTerminateSimpleContracts({contractType:'WASTE_COLLECTOR', ...})
 * - Waste Collector Amendments: COMPLETE implementation
 *   (joins with users + reference_contract_number, full fields)
 * ============================================================================
 *
 * Routes expected (see routes/institutions.js):
 *  GET    /api/institutions/:institutionId/waste-contracts
 *  GET    /api/institutions/:institutionId/waste-contracts/:contractId
 *  POST   /api/institutions/:institutionId/waste-contracts
 *  PUT    /api/institutions/:institutionId/waste-contracts/:contractId
 *  DELETE /api/institutions/:institutionId/waste-contracts/:contractId
 *
 * Amendments (wired via UPDATE_ROUTES.md):
 *  GET    /api/institutions/:institutionId/waste-contracts/:contractId/amendments
 *  POST   /api/institutions/:institutionId/waste-contracts/:contractId/amendments
 *  PUT    /api/institutions/:institutionId/waste-contracts/:contractId/amendments/:amendmentId
 *  DELETE /api/institutions/:institutionId/waste-contracts/:contractId/amendments/:amendmentId
 * ============================================================================
 */

import pool from '../config/database.js';
import { autoTerminateSimpleContracts } from '../utils/autoTermination.js';

// ============================
// Helpers
// ============================
const toNullIfEmpty = (v) => (v === '' ? null : v);

function isAllInstitution(institutionId) {
  return !institutionId || String(institutionId) === '0';
}

// ============================
// Amendment type normalization (UI aliases -> DB allowed)
// ============================
const WASTE_COLLECTOR_ALLOWED_AMENDMENT_TYPES = new Set([
  'MANUAL',
  'AUTO_TERMINATION',
  'PRELUNGIRE',
  'INCETARE',
  'MODIFICARE_VALABILITATE',
]);

function ensureAllowedWasteCollectorAmendmentType(input) {
  if (!input) return 'MANUAL';
  const raw = String(input).trim().toUpperCase();
  const aliases = {
    EXTENSION: 'PRELUNGIRE',
    PRELUNGIRE: 'PRELUNGIRE',
    TERMINATION: 'INCETARE',
    INCETARE: 'INCETARE',
    VALIDITY_CHANGE: 'MODIFICARE_VALABILITATE',
    MODIFICARE_VALABILITATE: 'MODIFICARE_VALABILITATE',
    AUTO_TERMINATION: 'AUTO_TERMINATION',
    MANUAL: 'MANUAL',
    MULTIPLE: 'MANUAL',
  };
  const normalized = aliases[raw] || raw;
  return WASTE_COLLECTOR_ALLOWED_AMENDMENT_TYPES.has(normalized) ? normalized : 'MANUAL';
}

// ============================================================================
// GET ALL WASTE COLLECTOR CONTRACTS (institutionId=0 => ALL)
// ============================================================================
export const getWasteCollectorContracts = async (req, res) => {
  try {
    const { institutionId } = req.params;
    const { sector_id, is_active } = req.query;

    const where = ['wcc.deleted_at IS NULL'];
    const params = [];
    let p = 1;

    if (!isAllInstitution(institutionId)) {
      where.push(`wcc.institution_id = $${p}`);
      params.push(institutionId);
      p++;
    }

    if (sector_id) {
      where.push(`wcc.sector_id = $${p}`);
      params.push(sector_id);
      p++;
    }

    if (is_active !== undefined) {
      where.push(`wcc.is_active = $${p}`);
      params.push(is_active === 'true' || is_active === true);
      p++;
    }

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

        COALESCE(
          (SELECT wcca.new_contract_date_end
           FROM waste_collector_contract_amendments wcca
           WHERE wcca.contract_id = wcc.id
             AND wcca.deleted_at IS NULL
             AND wcca.new_contract_date_end IS NOT NULL
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
      WHERE ${where.join(' AND ')}
      ORDER BY s.sector_number NULLS LAST, wcc.contract_date_start DESC
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
    const { institutionId, contractId } = req.params;

    const where = ['wcc.id = $1', 'wcc.deleted_at IS NULL'];
    const params = [contractId];
    let p = 2;

    if (!isAllInstitution(institutionId)) {
      where.push(`wcc.institution_id = $${p}`);
      params.push(institutionId);
      p++;
    }

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
      WHERE ${where.join(' AND ')}
      LIMIT 1
    `;

    const result = await pool.query(query, params);

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
    const { institutionId } = req.params;

    const {
      institution_id, // acceptăm și din body, dar param are prioritate dacă nu e 0
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

    const finalInstitutionId = !isAllInstitution(institutionId) ? Number(institutionId) : institution_id;

    if (!finalInstitutionId || !contract_number || !contract_date_start) {
      return res.status(400).json({
        success: false,
        message: 'Câmpuri obligatorii: institution_id, contract_number, contract_date_start',
      });
    }

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
      finalInstitutionId,
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
      req.user?.id || null,
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
          contractType: 'WASTE_COLLECTOR',
          sectorId: sector_id,
          serviceStartDate: service_start_date,
          newContractId: savedContract.id,
          newContractNumber: contract_number,
          userId: req.user?.id || null,
        });
      } catch (e) {
        console.error('Auto-termination error (waste collector create):', e);
      }
    }

    res.status(201).json({
      success: true,
      data: savedContract,
      auto_termination: autoTermination,
    });
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
    const { institutionId, contractId } = req.params;

    // citim vechiul sector/service pentru auto-termination
    const prev = await pool.query(
      `SELECT institution_id, sector_id, service_start_date FROM waste_collector_contracts WHERE id = $1 AND deleted_at IS NULL`,
      [contractId]
    );
    const prevRow = prev.rows?.[0] || null;

    if (!prevRow) {
      return res.status(404).json({ success: false, message: 'Contract de colectare negăsit' });
    }

    if (!isAllInstitution(institutionId) && Number(institutionId) !== Number(prevRow.institution_id)) {
      return res.status(404).json({ success: false, message: 'Contract de colectare negăsit (instituție diferită)' });
    }

    const prevSector = prevRow?.sector_id || null;
    const prevService = prevRow?.service_start_date ? String(prevRow.service_start_date).slice(0, 10) : null;

    const {
      institution_id, // acceptăm, dar param are prioritate dacă nu e 0
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

    const finalInstitutionId = !isAllInstitution(institutionId)
      ? Number(institutionId)
      : (institution_id ?? prevRow.institution_id);

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
      finalInstitutionId,
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
      associate_institution_id || null,
      attribution_type || null,
      contractId,
    ];

    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Contract de colectare negăsit' });
    }

    const updatedContract = result.rows[0];

    // AUTO-TERMINATION (non-blocking) - doar când se schimbă sector/service
    let autoTermination = null;

    const nextSector = sector_id ?? prevSector;
    const nextService = (service_start_date ?? prevService) || null;

    const changed =
      (sector_id && String(nextSector) !== String(prevSector)) ||
      (service_start_date && String(nextService) !== String(prevService));

    if (changed && nextSector && nextService) {
      try {
        autoTermination = await autoTerminateSimpleContracts({
          contractType: 'WASTE_COLLECTOR',
          sectorId: nextSector,
          serviceStartDate: nextService,
          newContractId: updatedContract.id,
          newContractNumber: updatedContract.contract_number,
          userId: req.user?.id || null,
        });
      } catch (e) {
        console.error('Auto-termination error (waste collector update):', e);
      }
    }

    res.json({
      success: true,
      data: updatedContract,
      auto_termination: autoTermination,
    });
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
    const { institutionId, contractId } = req.params;

    const where = ['id = $1', 'deleted_at IS NULL'];
    const params = [contractId];
    let p = 2;

    if (!isAllInstitution(institutionId)) {
      where.push(`institution_id = $${p}`);
      params.push(institutionId);
      p++;
    }

    const query = `
      UPDATE waste_collector_contracts
      SET deleted_at = NOW()
      WHERE ${where.join(' AND ')}
      RETURNING id
    `;

    const result = await pool.query(query, params);

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
// WASTE COLLECTOR CONTRACT AMENDMENTS - COMPLETE IMPLEMENTATION
// Note: Waste Collector contracts do NOT have quantity fields - only dates
// ============================================================================

// ============================================================================
// GET ALL AMENDMENTS FOR WASTE COLLECTOR CONTRACT
// ============================================================================
export const getWasteCollectorContractAmendments = async (req, res) => {
  try {
    const { contractId } = req.params;

    const query = `
      SELECT
        wcca.*,
        u.first_name || ' ' || u.last_name as created_by_name,
        rc.contract_number as reference_contract_number
      FROM waste_collector_contract_amendments wcca
      LEFT JOIN users u ON wcca.created_by = u.id
      LEFT JOIN waste_collector_contracts rc ON wcca.reference_contract_id = rc.id
      WHERE wcca.contract_id = $1 AND wcca.deleted_at IS NULL
      ORDER BY wcca.amendment_date DESC, wcca.created_at DESC
    `;

    const result = await pool.query(query, [contractId]);

    res.json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    console.error('Get waste collector amendments error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la obținerea actelor adiționale pentru contract colectare',
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
      amendment_type,
      changes_description,
      reason,
      notes,
      amendment_file_url,
      amendment_file_name,
      amendment_file_size,
      reference_contract_id,
      new_contract_date_start,
      new_service_start_date,
    } = req.body;

    if (!amendment_number || !amendment_date) {
      return res.status(400).json({
        success: false,
        message: 'Numărul și data actului adițional sunt obligatorii',
      });
    }

    const finalAmendmentType = ensureAllowedWasteCollectorAmendmentType(amendment_type);

    const query = `
      INSERT INTO waste_collector_contract_amendments (
        contract_id,
        amendment_number,
        amendment_date,
        new_contract_date_end,
        amendment_type,
        changes_description,
        reason,
        notes,
        amendment_file_url,
        amendment_file_name,
        amendment_file_size,
        reference_contract_id,
        new_contract_date_start,
        new_service_start_date,
        created_by
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15
      )
      RETURNING *
    `;

    const values = [
      contractId,
      amendment_number,
      amendment_date,
      new_contract_date_end || null,
      finalAmendmentType,
      changes_description || null,
      reason || null,
      notes || null,
      amendment_file_url || null,
      amendment_file_name || null,
      amendment_file_size || null,
      reference_contract_id || null,
      new_contract_date_start || null,
      new_service_start_date || null,
      req.user?.id || null,
    ];

    const result = await pool.query(query, values);

    res.status(201).json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    console.error('Create waste collector amendment error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la crearea actului adițional pentru contract colectare',
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
      amendment_type,
      changes_description,
      reason,
      notes,
      amendment_file_url,
      amendment_file_name,
      amendment_file_size,
      reference_contract_id,
      new_contract_date_start,
      new_service_start_date,
    } = req.body;

    const finalAmendmentType = ensureAllowedWasteCollectorAmendmentType(amendment_type);

    const query = `
      UPDATE waste_collector_contract_amendments SET
        amendment_number = $1,
        amendment_date = $2,
        new_contract_date_end = $3,
        amendment_type = $4,
        changes_description = $5,
        reason = $6,
        notes = $7,
        amendment_file_url = $8,
        amendment_file_name = $9,
        amendment_file_size = $10,
        reference_contract_id = $11,
        new_contract_date_start = $12,
        new_service_start_date = $13,
        updated_at = NOW()
      WHERE id = $14 AND contract_id = $15 AND deleted_at IS NULL
      RETURNING *
    `;

    const values = [
      amendment_number,
      amendment_date,
      new_contract_date_end || null,
      finalAmendmentType,
      changes_description || null,
      reason || null,
      notes || null,
      amendment_file_url || null,
      amendment_file_name || null,
      amendment_file_size || null,
      reference_contract_id || null,
      new_contract_date_start || null,
      new_service_start_date || null,
      amendmentId,
      contractId,
    ];

    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Act adițional colectare negăsit' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Update waste collector amendment error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la actualizarea actului adițional pentru contract colectare',
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
      return res.status(404).json({ success: false, message: 'Act adițional colectare negăsit' });
    }

    res.json({ success: true, message: 'Act adițional colectare șters cu succes' });
  } catch (error) {
    console.error('Delete waste collector amendment error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la ștergerea actului adițional pentru contract colectare',
    });
  }
};
