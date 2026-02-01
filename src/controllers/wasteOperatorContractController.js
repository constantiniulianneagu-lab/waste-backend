// src/controllers/wasteOperatorContractController.js
/**
 * ============================================================================
 * WASTE OPERATOR CONTRACTS CONTROLLER + AUTO-TERMINATION
 * ============================================================================
 * CRUD operations pentru contracte operatori colectare
 * Include gestionare coduri deșeuri cu tarife
 * 
 * FIX: Added sector_id and is_active query params filter support
 * ============================================================================
 */

import pool from "../config/database.js";
import ContractTerminationService from '../services/ContractTerminationService.js';

// ============================================================================
// GET ALL CONTRACTS FOR INSTITUTION (or ALL if institutionId = 0)
// ============================================================================

export const getWasteOperatorContracts = async (req, res) => {
  try {
    // Check if user has access to contracts page
    const { scopes } = req.userAccess;
    if (scopes?.contracts === "NONE") {
      return res.status(403).json({
        success: false,
        message: "Nu aveți permisiune să accesați contractele",
      });
    }

    const { institutionId } = req.params;
    // FIX: Extract filter params from query string
    const { sector_id, is_active } = req.query;

    const isAll = institutionId === "0";

    // ------------------------------------------------------------------------
    // 1) Fetch contracts with dynamic filters
    // ------------------------------------------------------------------------
    let contractsResult;

    // Build dynamic WHERE conditions
    let whereConditions = ['c.deleted_at IS NULL'];
    const params = [];
    let paramCount = 1;

    if (isAll) {
      whereConditions.push("i.deleted_at IS NULL");
      whereConditions.push("i.type = 'WASTE_COLLECTOR'");
    } else {
      whereConditions.push(`c.institution_id = $${paramCount}`);
      params.push(institutionId);
      paramCount++;
    }

    // FIX: Add sector_id filter
    if (sector_id) {
      whereConditions.push(`c.sector_id = $${paramCount}`);
      params.push(sector_id);
      paramCount++;
    }

    // FIX: Add is_active filter
    if (is_active !== undefined) {
      whereConditions.push(`c.is_active = $${paramCount}`);
      params.push(is_active === 'true' || is_active === true);
      paramCount++;
    }

    const whereClause = whereConditions.join(' AND ');

    if (isAll) {
      // ✅ ALL waste operator contracts with filters
      contractsResult = await pool.query(
        `SELECT 
          c.*,
          s.sector_name,
          s.sector_number,
          i.name as institution_name,
          i.short_name as institution_short_name,
          i.type as institution_type,
          -- Check if active based on dates
          CASE 
            WHEN c.is_active = false THEN false
            WHEN c.contract_date_end IS NOT NULL AND c.contract_date_end < CURRENT_DATE THEN false
            WHEN c.contract_date_start > CURRENT_DATE THEN false
            ELSE true
          END as is_currently_active
        FROM waste_collector_contracts c
        LEFT JOIN sectors s ON s.id = c.sector_id
        LEFT JOIN institutions i ON i.id = c.institution_id
        WHERE ${whereClause}
        ORDER BY c.contract_date_start DESC`,
        params
      );
    } else {
      // 1. Verifică că instituția există și e WASTE_COLLECTOR
      const institutionCheck = await pool.query(
        "SELECT id, type, name, short_name FROM institutions WHERE id = $1 AND deleted_at IS NULL",
        [institutionId]
      );

      if (institutionCheck.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Instituție negăsită",
        });
      }

      if (institutionCheck.rows[0].type !== "WASTE_COLLECTOR") {
        return res.json({
          success: true,
          data: [],
        });
      }

      // 2. Get contracts cu sector + institution info + filters
      contractsResult = await pool.query(
        `SELECT 
          c.*,
          s.sector_name,
          s.sector_number,
          i.name as institution_name,
          i.short_name as institution_short_name,
          i.type as institution_type,
          -- Check if active based on dates
          CASE 
            WHEN c.is_active = false THEN false
            WHEN c.contract_date_end IS NOT NULL AND c.contract_date_end < CURRENT_DATE THEN false
            WHEN c.contract_date_start > CURRENT_DATE THEN false
            ELSE true
          END as is_currently_active
        FROM waste_collector_contracts c
        LEFT JOIN sectors s ON s.id = c.sector_id
        LEFT JOIN institutions i ON i.id = c.institution_id
        WHERE ${whereClause}
        ORDER BY c.contract_date_start DESC`,
        params
      );
    }

    const contracts = contractsResult.rows;

    // ------------------------------------------------------------------------
    // 2) Fetch waste codes for all returned contracts
    // ------------------------------------------------------------------------
    const contractIds = contracts.map((c) => c.id);
    let wasteCodes = [];

    if (contractIds.length > 0) {
      const placeholders = contractIds.map((_, i) => `$${i + 1}`).join(",");
      const wasteCodesResult = await pool.query(
        `SELECT 
          wcc.*,
          wc.code as waste_code,
          wc.description as waste_description,
          wc.category as waste_category
         FROM waste_collector_contract_codes wcc
         JOIN waste_codes wc ON wc.id = wcc.waste_code_id
         WHERE wcc.contract_id IN (${placeholders})
         AND wcc.deleted_at IS NULL
         ORDER BY wc.code`,
        contractIds
      );
      wasteCodes = wasteCodesResult.rows;
    }

    // ------------------------------------------------------------------------
    // 3) Fetch amendments for all returned contracts
    // ------------------------------------------------------------------------
    let amendments = [];
    if (contractIds.length > 0) {
      const placeholders = contractIds.map((_, i) => `$${i + 1}`).join(",");
      const amendmentsResult = await pool.query(
        `SELECT *
         FROM waste_collector_contract_amendments
         WHERE contract_id IN (${placeholders})
         AND deleted_at IS NULL
         ORDER BY amendment_date DESC`,
        contractIds
      );
      amendments = amendmentsResult.rows;
    }

    // ------------------------------------------------------------------------
    // 4) Group waste codes and amendments by contract
    // ------------------------------------------------------------------------
    const wasteCodesByContract = {};
    wasteCodes.forEach((wc) => {
      if (!wasteCodesByContract[wc.contract_id]) {
        wasteCodesByContract[wc.contract_id] = [];
      }
      wasteCodesByContract[wc.contract_id].push(wc);
    });

    const amendmentsByContract = {};
    amendments.forEach((a) => {
      if (!amendmentsByContract[a.contract_id]) {
        amendmentsByContract[a.contract_id] = [];
      }
      amendmentsByContract[a.contract_id].push(a);
    });

    // ------------------------------------------------------------------------
    // 5) Attach children arrays
    // ------------------------------------------------------------------------
    const enrichedContracts = contracts.map((c) => ({
      ...c,
      waste_codes: wasteCodesByContract[c.id] || [],
      amendments: amendmentsByContract[c.id] || [],
    }));

    res.json({
      success: true,
      data: enrichedContracts,
    });
  } catch (err) {
    console.error("Error fetching waste operator contracts:", err);
    res.status(500).json({
      success: false,
      message: "Eroare la încărcarea contractelor",
    });
  }
};

// ============================================================================
// GET SINGLE CONTRACT (by ID)
// ============================================================================

export const getWasteOperatorContract = async (req, res) => {
  try {
    const { scopes } = req.userAccess;
    if (scopes?.contracts === "NONE") {
      return res.status(403).json({
        success: false,
        message: "Nu aveți permisiune să accesați contractele",
      });
    }

    const { contractId } = req.params;

    const contractResult = await pool.query(
      `SELECT 
        c.*,
        s.sector_name,
        s.sector_number,
        i.name as institution_name,
        i.short_name as institution_short_name,
        i.type as institution_type
      FROM waste_collector_contracts c
      LEFT JOIN sectors s ON s.id = c.sector_id
      LEFT JOIN institutions i ON i.id = c.institution_id
      WHERE c.id = $1 AND c.deleted_at IS NULL`,
      [contractId]
    );

    if (contractResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Contract negăsit",
      });
    }

    const contract = contractResult.rows[0];

    // Load waste codes
    const wasteCodesResult = await pool.query(
      `SELECT 
        wcc.*,
        wc.code as waste_code,
        wc.description as waste_description,
        wc.category as waste_category
       FROM waste_collector_contract_codes wcc
       JOIN waste_codes wc ON wc.id = wcc.waste_code_id
       WHERE wcc.contract_id = $1 AND wcc.deleted_at IS NULL
       ORDER BY wc.code`,
      [contractId]
    );

    // Load amendments
    const amendmentsResult = await pool.query(
      `SELECT *
       FROM waste_collector_contract_amendments
       WHERE contract_id = $1 AND deleted_at IS NULL
       ORDER BY amendment_date DESC`,
      [contractId]
    );

    res.json({
      success: true,
      data: {
        ...contract,
        waste_codes: wasteCodesResult.rows || [],
        amendments: amendmentsResult.rows || [],
      },
    });
  } catch (err) {
    console.error("Error fetching waste operator contract:", err);
    res.status(500).json({
      success: false,
      message: "Eroare la încărcarea contractului",
    });
  }
};

// ============================================================================
// CREATE CONTRACT
// ============================================================================
export const createWasteOperatorContract = async (req, res) => {
  try {
    const { canCreateData } = req.userAccess;
    if (!canCreateData) {
      return res.status(403).json({
        success: false,
        message: "Nu aveți permisiune să creați contracte",
      });
    }

    const { institutionId } = req.params;
    const {
      sector_id,
      contract_number,
      contract_date_start,
      contract_date_end,
      service_start_date,
      associate_institution_id,
      attribution_type,
      currency = "RON",
      notes,
      is_active = true,
      contract_file_url,
      contract_file_name,
      contract_file_size,
      contract_file_uploaded_at,
      waste_codes, // [{ waste_code_id, tariff_per_ton, notes }]
    } = req.body;

    if (!contract_number || !contract_date_start) {
      return res.status(400).json({
        success: false,
        message: "Câmpuri obligatorii lipsesc",
      });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const contractInsert = await client.query(
        `INSERT INTO waste_collector_contracts (
          institution_id, sector_id, contract_number, contract_date_start, contract_date_end,
          service_start_date, associate_institution_id, attribution_type,
          currency, notes, is_active,
          contract_file_url, contract_file_name, contract_file_size, contract_file_uploaded_at,
          created_by
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
        RETURNING *`,
        [
          institutionId,
          sector_id || null,
          contract_number,
          contract_date_start,
          contract_date_end || null,
          service_start_date || null,
          associate_institution_id || null,
          attribution_type || null,
          currency,
          notes || null,
          is_active,
          contract_file_url || null,
          contract_file_name || null,
          contract_file_size || null,
          contract_file_uploaded_at || null,
          req.user?.id || null,
        ]
      );

      const contract = contractInsert.rows[0];

      // Insert waste codes
      if (Array.isArray(waste_codes) && waste_codes.length > 0) {
        for (const wc of waste_codes) {
          await client.query(
            `INSERT INTO waste_collector_contract_codes (
              contract_id, waste_code_id, tariff_per_ton, notes
            ) VALUES ($1,$2,$3,$4)`,
            [
              contract.id,
              wc.waste_code_id,
              wc.tariff_per_ton || null,
              wc.notes || null,
            ]
          );
        }
      }

      await client.query("COMMIT");
      
      let terminationResult = null;
      if (contract.service_start_date) {
        try {
          terminationResult = await ContractTerminationService.processAutomaticTerminations(
            'WASTE_COLLECTOR',
            contract,
            req.user?.id
          );
        } catch (termError) {
          console.error('⚠️ Auto-termination failed:', termError);
        }
      }

      res.status(201).json({
        success: true,
        message: "Contract creat cu succes",
        data: contract,
        autoTerminations: terminationResult,
      });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("Error creating waste operator contract:", err);
    res.status(500).json({
      success: false,
      message: "Eroare la crearea contractului",
    });
  }
};

// ============================================================================
// UPDATE CONTRACT
// ============================================================================
export const updateWasteOperatorContract = async (req, res) => {
  try {
    const { canEditData } = req.userAccess;
    if (!canEditData) {
      return res.status(403).json({
        success: false,
        message: "Nu aveți permisiune să editați contracte",
      });
    }

    const { contractId } = req.params;

    const {
      sector_id,
      contract_number,
      contract_date_start,
      contract_date_end,
      currency,
      notes,
      is_active,
      contract_file_url,
      contract_file_name,
      contract_file_size,
      contract_file_uploaded_at,
      waste_codes, // full replace list
    } = req.body;

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const updated = await client.query(
        `UPDATE waste_collector_contracts SET
          sector_id = $1,
          contract_number = $2,
          contract_date_start = $3,
          contract_date_end = $4,
          currency = $5,
          notes = $6,
          is_active = $7,
          contract_file_url = $8,
          contract_file_name = $9,
          contract_file_size = $10,
          contract_file_uploaded_at = $11,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $12 AND deleted_at IS NULL
        RETURNING *`,
        [
          sector_id || null,
          contract_number,
          contract_date_start,
          contract_date_end || null,
          currency || "RON",
          notes || null,
          is_active,
          contract_file_url || null,
          contract_file_name || null,
          contract_file_size || null,
          contract_file_uploaded_at || null,
          contractId,
        ]
      );

      if (updated.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({
          success: false,
          message: "Contract negăsit",
        });
      }

      // Replace waste codes
      await client.query(
        `UPDATE waste_collector_contract_codes
         SET deleted_at = CURRENT_TIMESTAMP
         WHERE contract_id = $1 AND deleted_at IS NULL`,
        [contractId]
      );

      if (Array.isArray(waste_codes) && waste_codes.length > 0) {
        for (const wc of waste_codes) {
          await client.query(
            `INSERT INTO waste_collector_contract_codes (
              contract_id, waste_code_id, tariff_per_ton, notes
            ) VALUES ($1,$2,$3,$4)`,
            [
              contractId,
              wc.waste_code_id,
              wc.tariff_per_ton || null,
              wc.notes || null,
            ]
          );
        }
      }

      await client.query("COMMIT");

      res.json({
        success: true,
        message: "Contract actualizat cu succes",
        data: updated.rows[0],
      });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("Error updating contract:", err);
    res.status(500).json({
      success: false,
      message: "Eroare la actualizarea contractului",
    });
  }
};

// ============================================================================
// DELETE CONTRACT (soft delete)
// ============================================================================
export const deleteWasteOperatorContract = async (req, res) => {
  try {
    const { canDeleteData } = req.userAccess;
    if (!canDeleteData) {
      return res.status(403).json({
        success: false,
        message: "Nu aveți permisiune să ștergeți contracte",
      });
    }

    const { contractId } = req.params;

    const result = await pool.query(
      `UPDATE waste_collector_contracts SET
        deleted_at = CURRENT_TIMESTAMP,
        is_active = false,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND deleted_at IS NULL
       RETURNING id`,
      [contractId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Contract negăsit",
      });
    }

    res.json({
      success: true,
      message: "Contract șters cu succes",
    });
  } catch (err) {
    console.error("Error deleting contract:", err);
    res.status(500).json({
      success: false,
      message: "Eroare la ștergerea contractului",
    });
  }
};