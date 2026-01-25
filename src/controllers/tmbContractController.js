// src/controllers/tmbContractController.js
/**
 * ============================================================================
 * TMB CONTRACT CONTROLLER - COMPLETE WITH VALIDATION
 * ============================================================================
 */

import pool from '../config/database.js';

// ============================================================================
// VALIDATE TMB CONTRACT (before save)
// ============================================================================
export const validateTMBContract = async (req, res) => {
  try {
    const {
      id,
      institution_id,
      sector_id,
      contract_number,
      contract_date_start,
      contract_date_end,
    } = req.body;

    const warnings = [];
    const errors = [];

    // 1. CHECK DUPLICATE CONTRACT NUMBER
    if (contract_number) {
      const duplicateNumberQuery = `
        SELECT id, contract_number
        FROM tmb_contracts
        WHERE contract_number = $1 
          AND deleted_at IS NULL
          ${id ? 'AND id != $2' : ''}
      `;
      const duplicateParams = id ? [contract_number, id] : [contract_number];
      const duplicateResult = await pool.query(duplicateNumberQuery, duplicateParams);
      
      if (duplicateResult.rows.length > 0) {
        errors.push({
          type: 'DUPLICATE_NUMBER',
          message: `Există deja un contract cu numărul "${contract_number}"`,
        });
      }
    }

    // 2. CHECK EXISTING CONTRACT FOR SAME OPERATOR + SECTOR
    if (institution_id && sector_id) {
      const existingContractQuery = `
        SELECT tc.id, tc.contract_number, tc.contract_date_start, tc.contract_date_end,
               i.name as institution_name, s.sector_number
        FROM tmb_contracts tc
        LEFT JOIN institutions i ON tc.institution_id = i.id
        LEFT JOIN sectors s ON tc.sector_id = s.id
        WHERE tc.institution_id = $1 
          AND tc.sector_id = $2
          AND tc.is_active = true
          AND tc.deleted_at IS NULL
          ${id ? 'AND tc.id != $3' : ''}
      `;
      const existingParams = id 
        ? [institution_id, sector_id, id] 
        : [institution_id, sector_id];
      const existingResult = await pool.query(existingContractQuery, existingParams);

      if (existingResult.rows.length > 0) {
        const existing = existingResult.rows[0];
        const existingPeriod = `${existing.contract_date_start ? new Date(existing.contract_date_start).toLocaleDateString('ro-RO') : '?'} - ${existing.contract_date_end ? new Date(existing.contract_date_end).toLocaleDateString('ro-RO') : 'nedefinit'}`;
        
        warnings.push({
          type: 'EXISTING_CONTRACT',
          message: `Există deja un contract activ pentru acest operator și sector`,
          details: {
            contract_number: existing.contract_number,
            period: existingPeriod,
          },
        });

        // 3. CHECK OVERLAPPING PERIODS
        if (contract_date_start) {
          for (const exist of existingResult.rows) {
            const newStart = new Date(contract_date_start);
            const existStart = new Date(exist.contract_date_start);
            
            if (exist.contract_date_end && contract_date_end) {
              const newEnd = new Date(contract_date_end);
              const existEnd = new Date(exist.contract_date_end);

              if (newStart <= existEnd && newEnd >= existStart) {
                const overlapStart = newStart > existStart ? newStart : existStart;
                const overlapEnd = newEnd < existEnd ? newEnd : existEnd;
                const overlapDays = Math.ceil((overlapEnd - overlapStart) / (1000 * 60 * 60 * 24));
                
                warnings.push({
                  type: 'OVERLAPPING_PERIOD',
                  message: `Perioada se suprapune cu contractul ${exist.contract_number} (${overlapDays} zile)`,
                  details: {
                    contract_number: exist.contract_number,
                    period: `${existStart.toLocaleDateString('ro-RO')} - ${existEnd.toLocaleDateString('ro-RO')}`,
                    overlap_days: overlapDays,
                  },
                });
              }
            } else if (!exist.contract_date_end) {
              warnings.push({
                type: 'OVERLAPPING_PERIOD',
                message: `Contractul ${exist.contract_number} nu are dată de sfârșit (perioadă nedefinită)`,
                details: {
                  contract_number: exist.contract_number,
                  period: `${existStart.toLocaleDateString('ro-RO')} - nedefinit`,
                },
              });
            }
          }
        }
      }
    }

    // 4. CHECK IF CONTRACT IS ALREADY EXPIRED
    if (contract_date_end) {
      const endDate = new Date(contract_date_end);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      if (endDate < today) {
        warnings.push({
          type: 'EXPIRED_CONTRACT',
          message: 'Contractul va fi creat ca expirat (data sfârșit este în trecut)',
        });
      }
    }

    res.json({
      success: true,
      valid: errors.length === 0,
      errors,
      warnings,
    });
  } catch (err) {
    console.error("Error validating TMB contract:", err);
    res.status(500).json({
      success: false,
      message: "Eroare la validarea contractului",
    });
  }
};

// ============================================================================
// GET ALL TMB CONTRACTS
// ============================================================================
export const getTMBContracts = async (req, res) => {
  try {
    const { scopes } = req.userAccess;
    if (scopes?.contracts === "NONE") {
      return res.status(403).json({
        success: false,
        message: "Nu aveți permisiune să accesați contractele",
      });
    }

    const { institutionId } = req.params;
    const { sector_id, is_active } = req.query;

    let whereConditions = ["tc.deleted_at IS NULL"];
    const params = [];
    let paramCount = 1;

    // institutionId = "0" means ALL (no filter)
    const useInstitutionFilter = institutionId && institutionId !== "0";
    if (useInstitutionFilter) {
      whereConditions.push(`tc.institution_id = $${paramCount}`);
      params.push(institutionId);
      paramCount++;
    }

    // Filter by sector
    if (sector_id) {
      whereConditions.push(`tc.sector_id = $${paramCount}`);
      params.push(sector_id);
      paramCount++;
    }

    // Filter by active status
    if (is_active !== undefined) {
      whereConditions.push(`tc.is_active = $${paramCount}`);
      params.push(is_active === "true");
      paramCount++;
    }

    const whereClause = whereConditions.join(" AND ");

    const query = `
      SELECT 
        tc.id,
        tc.institution_id,
        tc.sector_id,
        tc.contract_number,
        tc.contract_date_start,
        tc.contract_date_end,
        tc.tariff_per_ton,
        tc.estimated_quantity_tons,
        tc.associate_institution_id,
        tc.indicator_recycling_percent,
        tc.indicator_energy_recovery_percent,
        tc.indicator_disposal_percent,
        tc.contract_file_url,
        tc.contract_file_name,
        tc.notes,
        tc.is_active,
        tc.created_at,
        tc.updated_at,
        
        -- Calculated total value
        COALESCE(tc.tariff_per_ton, 0) * COALESCE(tc.estimated_quantity_tons, 0) as total_value,
        
        -- Sector info (U.A.T.)
        s.sector_number,
        s.sector_name,
        
        -- Main operator (institution) info
        i.name as institution_name,
        i.short_name as institution_short_name,
        i.type as institution_type,
        
        -- Associate institution info
        ai.name as associate_name,
        ai.short_name as associate_short_name,
        
        -- Count of amendments
        (
          SELECT COUNT(*)
          FROM tmb_contract_amendments tca
          WHERE tca.contract_id = tc.id AND tca.deleted_at IS NULL
        ) as amendments_count,
        
        -- Effective values (considering amendments)
        COALESCE(
          (SELECT tca.new_contract_date_end 
           FROM tmb_contract_amendments tca 
           WHERE tca.contract_id = tc.id 
             AND tca.deleted_at IS NULL 
             AND tca.new_contract_date_end IS NOT NULL
           ORDER BY tca.amendment_date DESC, tca.id DESC 
           LIMIT 1),
          tc.contract_date_end
        ) as effective_date_end,
        
        COALESCE(
          (SELECT tca.new_tariff_per_ton 
           FROM tmb_contract_amendments tca 
           WHERE tca.contract_id = tc.id 
             AND tca.deleted_at IS NULL 
             AND tca.new_tariff_per_ton IS NOT NULL
           ORDER BY tca.amendment_date DESC, tca.id DESC 
           LIMIT 1),
          tc.tariff_per_ton
        ) as effective_tariff,
        
        COALESCE(
          (SELECT tca.new_estimated_quantity_tons 
           FROM tmb_contract_amendments tca 
           WHERE tca.contract_id = tc.id 
             AND tca.deleted_at IS NULL 
             AND tca.new_estimated_quantity_tons IS NOT NULL
           ORDER BY tca.amendment_date DESC, tca.id DESC 
           LIMIT 1),
          tc.estimated_quantity_tons
        ) as effective_quantity

      FROM tmb_contracts tc
      LEFT JOIN sectors s ON tc.sector_id = s.id
      LEFT JOIN institutions i ON tc.institution_id = i.id
      LEFT JOIN institutions ai ON tc.associate_institution_id = ai.id
      WHERE ${whereClause}
      ORDER BY s.sector_number, tc.contract_date_start DESC
    `;

    const result = await pool.query(query, params);

    // Calculate effective total value for each contract
    const contracts = result.rows.map((contract) => {
      const effectiveTariff = parseFloat(contract.effective_tariff) || 0;
      const effectiveQuantity = parseFloat(contract.effective_quantity) || 0;

      return {
        ...contract,
        effective_total_value: effectiveTariff * effectiveQuantity,
      };
    });

    res.json({
      success: true,
      data: contracts,
    });
  } catch (err) {
    console.error("Error fetching TMB contracts:", err);
    res.status(500).json({
      success: false,
      message: "Eroare la încărcarea contractelor TMB",
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
        ai.short_name as associate_short_name,
        COALESCE(tc.tariff_per_ton, 0) * COALESCE(tc.estimated_quantity_tons, 0) as total_value
      FROM tmb_contracts tc
      LEFT JOIN sectors s ON tc.sector_id = s.id
      LEFT JOIN institutions i ON tc.institution_id = i.id
      LEFT JOIN institutions ai ON tc.associate_institution_id = ai.id
      WHERE tc.id = $1 AND tc.deleted_at IS NULL
    `;

    const result = await pool.query(query, [contractId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Contract TMB negăsit",
      });
    }

    res.json({
      success: true,
      data: result.rows[0],
    });
  } catch (err) {
    console.error("Error fetching TMB contract:", err);
    res.status(500).json({
      success: false,
      message: "Eroare la încărcarea contractului TMB",
    });
  }
};

// ============================================================================
// CREATE TMB CONTRACT
// ============================================================================
export const createTMBContract = async (req, res) => {
  try {
    const { canCreateData } = req.userAccess;
    if (!canCreateData) {
      return res.status(403).json({
        success: false,
        message: "Nu aveți permisiune să creați contracte",
      });
    }

    const {
      institution_id,
      sector_id,
      contract_number,
      contract_date_start,
      contract_date_end,
      tariff_per_ton,
      estimated_quantity_tons,
      associate_institution_id,
      indicator_recycling_percent,
      indicator_energy_recovery_percent,
      indicator_disposal_percent,
      contract_file_url,
      contract_file_name,
      notes,
      is_active = true,
    } = req.body;

    // Validation
    if (!contract_number || !contract_date_start || !sector_id || !institution_id) {
      return res.status(400).json({
        success: false,
        message: "Câmpuri obligatorii: institution_id, contract_number, contract_date_start, sector_id",
      });
    }

    const query = `
      INSERT INTO tmb_contracts (
        institution_id,
        sector_id,
        contract_number,
        contract_date_start,
        contract_date_end,
        tariff_per_ton,
        estimated_quantity_tons,
        associate_institution_id,
        indicator_recycling_percent,
        indicator_energy_recovery_percent,
        indicator_disposal_percent,
        contract_file_url,
        contract_file_name,
        notes,
        is_active,
        created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING *
    `;

    const result = await pool.query(query, [
      institution_id,
      sector_id,
      contract_number,
      contract_date_start,
      contract_date_end || null,
      tariff_per_ton || null,
      estimated_quantity_tons || null,
      associate_institution_id || null,
      indicator_recycling_percent || null,
      indicator_energy_recovery_percent || null,
      indicator_disposal_percent || null,
      contract_file_url || null,
      contract_file_name || null,
      notes || null,
      is_active,
      req.user?.id || null,
    ]);

    // Get full contract with joins
    const fullContract = await pool.query(
      `
      SELECT tc.*, 
             s.sector_number, s.sector_name,
             i.name as institution_name, i.short_name as institution_short_name,
             ai.name as associate_name, ai.short_name as associate_short_name
      FROM tmb_contracts tc
      LEFT JOIN sectors s ON tc.sector_id = s.id
      LEFT JOIN institutions i ON tc.institution_id = i.id
      LEFT JOIN institutions ai ON tc.associate_institution_id = ai.id
      WHERE tc.id = $1
    `,
      [result.rows[0].id]
    );

    res.status(201).json({
      success: true,
      message: "Contract TMB creat cu succes",
      data: fullContract.rows[0],
    });
  } catch (err) {
    console.error("Error creating TMB contract:", err);

    if (err.code === "23505") {
      return res.status(400).json({
        success: false,
        message: "Există deja un contract TMB cu acest număr",
      });
    }

    res.status(500).json({
      success: false,
      message: "Eroare la crearea contractului TMB",
    });
  }
};

// ============================================================================
// UPDATE TMB CONTRACT
// ============================================================================
export const updateTMBContract = async (req, res) => {
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
      institution_id,
      sector_id,
      contract_number,
      contract_date_start,
      contract_date_end,
      tariff_per_ton,
      estimated_quantity_tons,
      associate_institution_id,
      indicator_recycling_percent,
      indicator_energy_recovery_percent,
      indicator_disposal_percent,
      contract_file_url,
      contract_file_name,
      notes,
      is_active,
    } = req.body;

    const query = `
      UPDATE tmb_contracts SET
        institution_id = COALESCE($1, institution_id),
        sector_id = COALESCE($2, sector_id),
        contract_number = COALESCE($3, contract_number),
        contract_date_start = COALESCE($4, contract_date_start),
        contract_date_end = $5,
        tariff_per_ton = $6,
        estimated_quantity_tons = $7,
        associate_institution_id = $8,
        indicator_recycling_percent = $9,
        indicator_energy_recovery_percent = $10,
        indicator_disposal_percent = $11,
        contract_file_url = $12,
        contract_file_name = $13,
        notes = $14,
        is_active = COALESCE($15, is_active),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $16 AND deleted_at IS NULL
      RETURNING *
    `;

    const result = await pool.query(query, [
      institution_id,
      sector_id,
      contract_number,
      contract_date_start,
      contract_date_end || null,
      tariff_per_ton || null,
      estimated_quantity_tons || null,
      associate_institution_id || null,
      indicator_recycling_percent || null,
      indicator_energy_recovery_percent || null,
      indicator_disposal_percent || null,
      contract_file_url || null,
      contract_file_name || null,
      notes || null,
      is_active,
      contractId,
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Contract TMB negăsit",
      });
    }

    res.json({
      success: true,
      message: "Contract TMB actualizat cu succes",
      data: result.rows[0],
    });
  } catch (err) {
    console.error("Error updating TMB contract:", err);
    res.status(500).json({
      success: false,
      message: "Eroare la actualizarea contractului TMB",
    });
  }
};

// ============================================================================
// DELETE TMB CONTRACT (soft delete)
// ============================================================================
export const deleteTMBContract = async (req, res) => {
  try {
    const { canDeleteData } = req.userAccess;
    if (!canDeleteData) {
      return res.status(403).json({
        success: false,
        message: "Nu aveți permisiune să ștergeți contracte",
      });
    }

    const { contractId } = req.params;

    // Soft delete contract
    const result = await pool.query(
      `UPDATE tmb_contracts 
       SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND deleted_at IS NULL
       RETURNING id`,
      [contractId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Contract TMB negăsit",
      });
    }

    // Soft delete amendments
    await pool.query(
      `UPDATE tmb_contract_amendments 
       SET deleted_at = CURRENT_TIMESTAMP
       WHERE contract_id = $1 AND deleted_at IS NULL`,
      [contractId]
    );

    res.json({
      success: true,
      message: "Contract TMB șters cu succes",
    });
  } catch (err) {
    console.error("Error deleting TMB contract:", err);
    res.status(500).json({
      success: false,
      message: "Eroare la ștergerea contractului TMB",
    });
  }
};

// ============================================================================
// GET TMB CONTRACT AMENDMENTS
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

    res.json({
      success: true,
      data: result.rows,
    });
  } catch (err) {
    console.error("Error fetching TMB amendments:", err);
    res.status(500).json({
      success: false,
      message: "Eroare la încărcarea actelor adiționale",
    });
  }
};

// ============================================================================
// CREATE TMB CONTRACT AMENDMENT
// ============================================================================
export const createTMBContractAmendment = async (req, res) => {
  try {
    const { canCreateData } = req.userAccess;
    if (!canCreateData) {
      return res.status(403).json({
        success: false,
        message: "Nu aveți permisiune să creați acte adiționale",
      });
    }

    const { contractId } = req.params;
    const {
      amendment_number,
      amendment_date,
      amendment_type,
      new_contract_date_end,
      new_tariff_per_ton,
      new_estimated_quantity_tons,
      changes_description,
      reason,
      notes,
      amendment_file_url,
      amendment_file_name,
    } = req.body;

    // Check contract exists
    const contractCheck = await pool.query(
      "SELECT id FROM tmb_contracts WHERE id = $1 AND deleted_at IS NULL",
      [contractId]
    );

    if (contractCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Contract TMB negăsit",
      });
    }

    // Auto-determine amendment type if not provided
    let finalAmendmentType = amendment_type;
    if (!finalAmendmentType) {
      const changes = [];
      if (new_contract_date_end) changes.push("EXTENSION");
      if (new_tariff_per_ton) changes.push("TARIFF_CHANGE");
      if (new_estimated_quantity_tons) changes.push("QUANTITY_CHANGE");

      if (changes.length > 1) {
        finalAmendmentType = "MULTIPLE";
      } else if (changes.length === 1) {
        finalAmendmentType = changes[0];
      } else {
        finalAmendmentType = "EXTENSION";
      }
    }

    const query = `
      INSERT INTO tmb_contract_amendments (
        contract_id,
        amendment_number,
        amendment_date,
        amendment_type,
        new_contract_date_end,
        new_tariff_per_ton,
        new_estimated_quantity_tons,
        changes_description,
        reason,
        notes,
        amendment_file_url,
        amendment_file_name,
        created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *
    `;

    const result = await pool.query(query, [
      contractId,
      amendment_number,
      amendment_date,
      finalAmendmentType,
      new_contract_date_end || null,
      new_tariff_per_ton || null,
      new_estimated_quantity_tons || null,
      changes_description || null,
      reason || null,
      notes || null,
      amendment_file_url || null,
      amendment_file_name || null,
      req.user?.id || null,
    ]);

    res.status(201).json({
      success: true,
      message: "Act adițional creat cu succes",
      data: result.rows[0],
    });
  } catch (err) {
    console.error("Error creating TMB amendment:", err);

    if (err.code === "23505") {
      return res.status(400).json({
        success: false,
        message: "Există deja un act adițional cu acest număr pentru acest contract",
      });
    }

    res.status(500).json({
      success: false,
      message: "Eroare la crearea actului adițional",
    });
  }
};

// ============================================================================
// UPDATE TMB CONTRACT AMENDMENT
// ============================================================================
export const updateTMBContractAmendment = async (req, res) => {
  try {
    const { canEditData } = req.userAccess;
    if (!canEditData) {
      return res.status(403).json({
        success: false,
        message: "Nu aveți permisiune să editați acte adiționale",
      });
    }

    const { amendmentId } = req.params;
    const {
      amendment_number,
      amendment_date,
      amendment_type,
      new_contract_date_end,
      new_tariff_per_ton,
      new_estimated_quantity_tons,
      changes_description,
      reason,
      notes,
      amendment_file_url,
      amendment_file_name,
    } = req.body;

    const query = `
      UPDATE tmb_contract_amendments SET
        amendment_number = COALESCE($1, amendment_number),
        amendment_date = COALESCE($2, amendment_date),
        amendment_type = COALESCE($3, amendment_type),
        new_contract_date_end = $4,
        new_tariff_per_ton = $5,
        new_estimated_quantity_tons = $6,
        changes_description = $7,
        reason = $8,
        notes = $9,
        amendment_file_url = $10,
        amendment_file_name = $11,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $12 AND deleted_at IS NULL
      RETURNING *
    `;

    const result = await pool.query(query, [
      amendment_number,
      amendment_date,
      amendment_type,
      new_contract_date_end || null,
      new_tariff_per_ton || null,
      new_estimated_quantity_tons || null,
      changes_description || null,
      reason || null,
      notes || null,
      amendment_file_url || null,
      amendment_file_name || null,
      amendmentId,
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Act adițional negăsit",
      });
    }

    res.json({
      success: true,
      message: "Act adițional actualizat cu succes",
      data: result.rows[0],
    });
  } catch (err) {
    console.error("Error updating TMB amendment:", err);
    res.status(500).json({
      success: false,
      message: "Eroare la actualizarea actului adițional",
    });
  }
};

// ============================================================================
// DELETE TMB CONTRACT AMENDMENT (soft delete)
// ============================================================================
export const deleteTMBContractAmendment = async (req, res) => {
  try {
    const { canDeleteData } = req.userAccess;
    if (!canDeleteData) {
      return res.status(403).json({
        success: false,
        message: "Nu aveți permisiune să ștergeți acte adiționale",
      });
    }

    const { amendmentId } = req.params;

    const result = await pool.query(
      `UPDATE tmb_contract_amendments 
       SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND deleted_at IS NULL
       RETURNING id`,
      [amendmentId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Act adițional negăsit",
      });
    }

    res.json({
      success: true,
      message: "Act adițional șters cu succes",
    });
  } catch (err) {
    console.error("Error deleting TMB amendment:", err);
    res.status(500).json({
      success: false,
      message: "Eroare la ștergerea actului adițional",
    });
  }
};