// src/controllers/sortingContractController.js
/**
 * ============================================================================
 * SORTING CONTRACT CONTROLLER (S-) + AUTO-TERMINATION
 * ============================================================================
 */

import pool from '../config/database.js';
import ContractTerminationService from '../services/ContractTerminationService.js';

// ============================================================================
// GET ALL SORTING CONTRACTS
// ============================================================================
export const getSortingContracts = async (req, res) => {
  try {
    const { sector_id, is_active } = req.query;
    
    let whereConditions = ['sc.deleted_at IS NULL'];
    const params = [];
    let paramCount = 1;

    if (sector_id) {
      whereConditions.push(`sc.sector_id = $${paramCount}`);
      params.push(sector_id);
      paramCount++;
    }

    if (is_active !== undefined) {
      whereConditions.push(`sc.is_active = $${paramCount}`);
      params.push(is_active === 'true');
      paramCount++;
    }

    const whereClause = whereConditions.join(' AND ');

    const query = `
      SELECT 
        sc.id,
        sc.institution_id,
        sc.contract_number,
        sc.contract_date_start,
        sc.contract_date_end,
        sc.tariff_per_ton,
        sc.estimated_quantity_tons,
        sc.contract_value,
        sc.currency,
        sc.contract_file_url,
        sc.contract_file_name,
        sc.contract_file_size,
        sc.is_active,
        sc.notes,
        sc.created_at,
        sc.updated_at,
        
        i.name as institution_name,
        i.short_name as institution_short_name,
        
        s.id as sector_id,
        s.sector_number,
        s.sector_name,
        
        COALESCE(
          (SELECT sca.new_contract_date_end 
           FROM sorting_operator_contract_amendments sca 
           WHERE sca.contract_id = sc.id AND sca.deleted_at IS NULL 
           ORDER BY sca.amendment_date DESC LIMIT 1),
          sc.contract_date_end
        ) as effective_date_end,
        
        COALESCE(
          (SELECT sca.new_tariff_per_ton 
           FROM sorting_operator_contract_amendments sca 
           WHERE sca.contract_id = sc.id AND sca.new_tariff_per_ton IS NOT NULL AND sca.deleted_at IS NULL 
           ORDER BY sca.amendment_date DESC LIMIT 1),
          sc.tariff_per_ton
        ) as effective_tariff,
        
        COALESCE(
          (SELECT sca.new_estimated_quantity_tons 
           FROM sorting_operator_contract_amendments sca 
           WHERE sca.contract_id = sc.id AND sca.new_estimated_quantity_tons IS NOT NULL AND sca.deleted_at IS NULL 
           ORDER BY sca.amendment_date DESC LIMIT 1),
          sc.estimated_quantity_tons
        ) as effective_quantity,
        
        (COALESCE(
          (SELECT sca.new_tariff_per_ton 
           FROM sorting_operator_contract_amendments sca 
           WHERE sca.contract_id = sc.id AND sca.new_tariff_per_ton IS NOT NULL AND sca.deleted_at IS NULL 
           ORDER BY sca.amendment_date DESC LIMIT 1),
          sc.tariff_per_ton
        ) * COALESCE(
          (SELECT sca.new_estimated_quantity_tons 
           FROM sorting_operator_contract_amendments sca 
           WHERE sca.contract_id = sc.id AND sca.new_estimated_quantity_tons IS NOT NULL AND sca.deleted_at IS NULL 
           ORDER BY sca.amendment_date DESC LIMIT 1),
          sc.estimated_quantity_tons
        )) as effective_total_value,
        
        (SELECT COUNT(*)
         FROM sorting_operator_contract_amendments sca
         WHERE sca.contract_id = sc.id AND sca.deleted_at IS NULL
        ) as amendments_count
        
      FROM sorting_operator_contracts sc
      JOIN institutions i ON sc.institution_id = i.id
      LEFT JOIN sectors s ON sc.sector_id = s.id
      WHERE ${whereClause}
      ORDER BY s.sector_number, sc.contract_date_start DESC
    `;

    const result = await pool.query(query, params);

    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('Get sorting contracts error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la obținerea contractelor de sortare'
    });
  }
};

// ============================================================================
// GET SINGLE SORTING CONTRACT
// ============================================================================
export const getSortingContract = async (req, res) => {
  try {
    const { contractId } = req.params;

    const query = `
      SELECT 
        sc.*,
        i.name as institution_name,
        i.short_name as institution_short_name,
        s.sector_number,
        s.sector_name
      FROM sorting_operator_contracts sc
      JOIN institutions i ON sc.institution_id = i.id
      LEFT JOIN sectors s ON sc.sector_id = s.id
      WHERE sc.id = $1 AND sc.deleted_at IS NULL
    `;

    const result = await pool.query(query, [contractId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Contract sortare negăsit'
      });
    }

    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Get sorting contract error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la obținerea contractului de sortare'
    });
  }
};

// ============================================================================
// CREATE SORTING CONTRACT
// ============================================================================
export const createSortingContract = async (req, res) => {
  try {
    const {
      institution_id,
      contract_number,
      contract_date_start,
      contract_date_end,
      service_start_date,
      associate_institution_id,
      attribution_type,
      sector_id,
      tariff_per_ton,
      estimated_quantity_tons,
      contract_file_url,
      contract_file_name,
      contract_file_size,
      is_active,
      notes
    } = req.body;

    const query = `
      INSERT INTO sorting_operator_contracts (
        institution_id, contract_number, contract_date_start, contract_date_end,
        service_start_date, associate_institution_id, attribution_type,
        sector_id, tariff_per_ton, estimated_quantity_tons,
        contract_file_url, contract_file_name, contract_file_size,
        is_active, notes, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING *
    `;

    const values = [
      institution_id, contract_number, contract_date_start, contract_date_end,
      service_start_date || null, associate_institution_id || null, attribution_type || null,
      sector_id, tariff_per_ton, estimated_quantity_tons,
      contract_file_url, contract_file_name, contract_file_size,
      is_active !== undefined ? is_active : true, notes, req.user.id
    ];

    const result = await pool.query(query, values);
    
    let terminationResult = null;
    if (result.rows[0].service_start_date) {
      try {
        terminationResult = await ContractTerminationService.processAutomaticTerminations(
          'SORTING',
          result.rows[0],
          req.user.id
        );
      } catch (termError) {
        console.error('⚠️ Auto-termination failed:', termError);
      }
    }

    res.status(201).json({
      success: true,
      data: result.rows[0],
      autoTerminations: terminationResult
    });
  } catch (error) {
    console.error('Create sorting contract error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la crearea contractului de sortare'
    });
  }
};

// ============================================================================
// UPDATE SORTING CONTRACT
// ============================================================================
export const updateSortingContract = async (req, res) => {
  try {
    const { contractId } = req.params;
    const {
      contract_number,
      contract_date_start,
      contract_date_end,
      sector_id,
      tariff_per_ton,
      estimated_quantity_tons,
      contract_file_url,
      contract_file_name,
      contract_file_size,
      is_active,
      notes
    } = req.body;

    const query = `
      UPDATE sorting_operator_contracts SET
        contract_number = $1,
        contract_date_start = $2,
        contract_date_end = $3,
        sector_id = $4,
        tariff_per_ton = $5,
        estimated_quantity_tons = $6,
        contract_file_url = $7,
        contract_file_name = $8,
        contract_file_size = $9,
        is_active = $10,
        notes = $11,
        updated_at = NOW()
      WHERE id = $12 AND deleted_at IS NULL
      RETURNING *
    `;

    const values = [
      contract_number, contract_date_start, contract_date_end, sector_id,
      tariff_per_ton, estimated_quantity_tons,
      contract_file_url, contract_file_name, contract_file_size,
      is_active, notes, contractId
    ];

    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Contract sortare negăsit'
      });
    }

    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Update sorting contract error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la actualizarea contractului de sortare'
    });
  }
};

// ============================================================================
// DELETE SORTING CONTRACT
// ============================================================================
export const deleteSortingContract = async (req, res) => {
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
      return res.status(404).json({
        success: false,
        message: 'Contract sortare negăsit'
      });
    }

    res.json({
      success: true,
      message: 'Contract sortare șters cu succes'
    });
  } catch (error) {
    console.error('Delete sorting contract error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la ștergerea contractului de sortare'
    });
  }
};

// ============================================================================
// GET AMENDMENTS FOR SORTING CONTRACT
// ============================================================================
export const getSortingContractAmendments = async (req, res) => {
  try {
    const { contractId } = req.params;

    const query = `
      SELECT * FROM sorting_operator_contract_amendments
      WHERE contract_id = $1 AND deleted_at IS NULL
      ORDER BY amendment_date DESC
    `;

    const result = await pool.query(query, [contractId]);

    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('Get sorting amendments error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la obținerea actelor adiționale'
    });
  }
};

// ============================================================================
// CREATE AMENDMENT FOR SORTING CONTRACT
// ============================================================================
export const createSortingContractAmendment = async (req, res) => {
  try {
    const { contractId } = req.params;
    const {
      amendment_number,
      amendment_date,
      new_tariff_per_ton,
      new_estimated_quantity_tons,
      new_contract_date_end,
      reason,
      notes,
      amendment_file_url,
      amendment_file_name,
      amendment_file_size
    } = req.body;

    const query = `
      INSERT INTO sorting_operator_contract_amendments (
        contract_id, amendment_number, amendment_date, new_tariff_per_ton,
        new_estimated_quantity_tons, new_contract_date_end,
        reason, notes, amendment_file_url,
        amendment_file_name, amendment_file_size, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *
    `;

    const values = [
      contractId, amendment_number, amendment_date, new_tariff_per_ton,
      new_estimated_quantity_tons, new_contract_date_end,
      reason, notes, amendment_file_url,
      amendment_file_name, amendment_file_size, req.user.id
    ];

    const result = await pool.query(query, values);

    res.status(201).json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Create sorting amendment error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la crearea actului adițional'
    });
  }
};

// ============================================================================
// UPDATE AMENDMENT FOR SORTING CONTRACT
// ============================================================================
export const updateSortingContractAmendment = async (req, res) => {
  try {
    const { contractId, amendmentId } = req.params;
    const {
      amendment_number,
      amendment_date,
      new_tariff_per_ton,
      new_estimated_quantity_tons,
      new_contract_date_end,
      reason,
      notes,
      amendment_file_url,
      amendment_file_name,
      amendment_file_size
    } = req.body;

    const query = `
      UPDATE sorting_operator_contract_amendments SET
        amendment_number = $1,
        amendment_date = $2,
        new_tariff_per_ton = $3,
        new_estimated_quantity_tons = $4,
        new_contract_date_end = $5,
        reason = $6,
        notes = $7,
        amendment_file_url = $8,
        amendment_file_name = $9,
        amendment_file_size = $10,
        updated_at = NOW()
      WHERE id = $11 AND contract_id = $12 AND deleted_at IS NULL
      RETURNING *
    `;

    const values = [
      amendment_number, amendment_date, new_tariff_per_ton,
      new_estimated_quantity_tons, new_contract_date_end,
      reason, notes, amendment_file_url,
      amendment_file_name, amendment_file_size, amendmentId, contractId
    ];

    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Act adițional negăsit'
      });
    }

    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Update sorting amendment error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la actualizarea actului adițional'
    });
  }
};

// ============================================================================
// DELETE AMENDMENT FOR SORTING CONTRACT
// ============================================================================
export const deleteSortingContractAmendment = async (req, res) => {
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
      return res.status(404).json({
        success: false,
        message: 'Act adițional negăsit'
      });
    }

    res.json({
      success: true,
      message: 'Act adițional șters cu succes'
    });
  } catch (error) {
    console.error('Delete sorting amendment error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la ștergerea actului adițional'
    });
  }
};