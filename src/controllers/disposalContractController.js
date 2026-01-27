// controllers/disposalContractController.js
/**
 * ============================================================================
 * DISPOSAL CONTRACT CONTROLLER - COMPLETE WITH AMENDMENTS
 * ============================================================================
 * CRUD operations pentru contracte depozitare + acte adiționale
 * 
 * Fix: institutionId = "0" means ALL contracts (no filter)
 * Updated: 2025-01-24
 * ============================================================================
 */

import pool from "../config/database.js";

// ============================================================================
// GET ALL DISPOSAL CONTRACTS
// ============================================================================
export const getDisposalContracts = async (req, res) => {
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

    let whereConditions = ["dc.deleted_at IS NULL"];
    const params = [];
    let paramCount = 1;

    // ✅ FIX: institutionId = "0" means ALL (no institution filter)
    const useInstitutionFilter = institutionId && institutionId !== "0";
    if (useInstitutionFilter) {
      whereConditions.push(`dc.institution_id = $${paramCount}`);
      params.push(institutionId);
      paramCount++;
    }

    // Filter by sector
    if (sector_id) {
      whereConditions.push(`dcs.sector_id = $${paramCount}`);
      params.push(sector_id);
      paramCount++;
    }

    // Filter by active status
    if (is_active !== undefined) {
      whereConditions.push(`dc.is_active = $${paramCount}`);
      params.push(is_active === "true");
      paramCount++;
    }

    const whereClause = whereConditions.join(" AND ");

    const query = `
      SELECT 
        dc.id,
        dc.institution_id,
        dc.contract_number,
        dc.contract_date_start,
        dc.contract_date_end,
        dc.is_active,
        dc.notes,
        dc.contract_file_url,
        dc.contract_file_name,
        dc.created_at,
        dc.updated_at,
        dc.attribution_type,
        
        -- Institution info
        i.name as institution_name,
        i.short_name as institution_short_name,
        i.type as institution_type,
        
        -- Sector info (from disposal_contract_sectors)
        dcs.id as sector_contract_id,
        dcs.sector_id,
        dcs.tariff_per_ton,
        dcs.cec_tax_per_ton,
        dcs.contracted_quantity_tons,
        COALESCE(dcs.tariff_per_ton, 0) + COALESCE(dcs.cec_tax_per_ton, 0) as total_per_ton,
        COALESCE(dcs.contracted_quantity_tons, 0) * 
          (COALESCE(dcs.tariff_per_ton, 0) + COALESCE(dcs.cec_tax_per_ton, 0)) as total_value,
        
        s.sector_number,
        s.sector_name,
        
        -- Latest amendment info (for effective values)
        (
          SELECT json_build_object(
            'id', dca.id,
            'amendment_number', dca.amendment_number,
            'amendment_date', dca.amendment_date,
            'new_contract_date_end', dca.new_contract_date_end,
            'new_tariff_per_ton', dca.new_tariff_per_ton,
            'new_cec_tax_per_ton', dca.new_cec_tax_per_ton,
            'new_contracted_quantity_tons', dca.new_contracted_quantity_tons,
            'amendment_type', dca.amendment_type
          )
          FROM disposal_contract_amendments dca
          WHERE dca.contract_id = dc.id AND dca.deleted_at IS NULL
          ORDER BY dca.amendment_date DESC, dca.id DESC
          LIMIT 1
        ) as latest_amendment,
        
        -- Count of amendments
        (
          SELECT COUNT(*)
          FROM disposal_contract_amendments dca
          WHERE dca.contract_id = dc.id AND dca.deleted_at IS NULL
        ) as amendments_count,
        
        -- Effective values (considering amendments)
        COALESCE(
          (SELECT dca.new_contract_date_end 
           FROM disposal_contract_amendments dca 
           WHERE dca.contract_id = dc.id 
             AND dca.deleted_at IS NULL 
             AND dca.new_contract_date_end IS NOT NULL
           ORDER BY dca.amendment_date DESC, dca.id DESC 
           LIMIT 1),
          dc.contract_date_end
        ) as effective_date_end,
        
        COALESCE(
          (SELECT dca.new_tariff_per_ton 
           FROM disposal_contract_amendments dca 
           WHERE dca.contract_id = dc.id 
             AND dca.deleted_at IS NULL 
             AND dca.new_tariff_per_ton IS NOT NULL
           ORDER BY dca.amendment_date DESC, dca.id DESC 
           LIMIT 1),
          dcs.tariff_per_ton
        ) as effective_tariff,
        
        COALESCE(
          (SELECT dca.new_cec_tax_per_ton 
           FROM disposal_contract_amendments dca 
           WHERE dca.contract_id = dc.id 
             AND dca.deleted_at IS NULL 
             AND dca.new_cec_tax_per_ton IS NOT NULL
           ORDER BY dca.amendment_date DESC, dca.id DESC 
           LIMIT 1),
          dcs.cec_tax_per_ton
        ) as effective_cec,
        
        COALESCE(
          (SELECT dca.new_contracted_quantity_tons 
           FROM disposal_contract_amendments dca 
           WHERE dca.contract_id = dc.id 
             AND dca.deleted_at IS NULL 
             AND dca.new_contracted_quantity_tons IS NOT NULL
           ORDER BY dca.amendment_date DESC, dca.id DESC 
           LIMIT 1),
          dcs.contracted_quantity_tons
        ) as effective_quantity

      FROM disposal_contracts dc
      LEFT JOIN institutions i ON dc.institution_id = i.id
      LEFT JOIN disposal_contract_sectors dcs ON dc.id = dcs.contract_id AND dcs.deleted_at IS NULL
      LEFT JOIN sectors s ON dcs.sector_id = s.id
      WHERE ${whereClause}
      ORDER BY s.sector_number, dc.contract_date_start DESC
    `;

    const result = await pool.query(query, params);

    // Calculate effective total value for each contract
    const contracts = result.rows.map((contract) => {
      const effectiveTariff = parseFloat(contract.effective_tariff) || 0;
      const effectiveCec = parseFloat(contract.effective_cec) || 0;
      const effectiveQuantity = parseFloat(contract.effective_quantity) || 0;

      return {
        ...contract,
        effective_total_per_ton: effectiveTariff + effectiveCec,
        effective_total_value: effectiveQuantity * (effectiveTariff + effectiveCec),
      };
    });

    res.json({
      success: true,
      data: contracts,
    });
  } catch (err) {
    console.error("Error fetching disposal contracts:", err);
    res.status(500).json({
      success: false,
      message: "Eroare la încărcarea contractelor",
    });
  }
};

// ============================================================================
// GET SINGLE DISPOSAL CONTRACT WITH ALL AMENDMENTS
// ============================================================================
export const getDisposalContract = async (req, res) => {
  try {
    const { scopes } = req.userAccess;
    if (scopes?.contracts === "NONE") {
      return res.status(403).json({
        success: false,
        message: "Nu aveți permisiune să accesați contractele",
      });
    }

    const { institutionId, contractId } = req.params;

    const query = `
      SELECT 
        dc.*,
        i.name as institution_name,
        i.short_name as institution_short_name,
        
        -- Sector details
        dcs.id as sector_contract_id,
        dcs.sector_id,
        dcs.tariff_per_ton,
        dcs.cec_tax_per_ton,
        dcs.contracted_quantity_tons,
        s.sector_number,
        s.sector_name

      FROM disposal_contracts dc
      LEFT JOIN institutions i ON dc.institution_id = i.id
      LEFT JOIN disposal_contract_sectors dcs ON dc.id = dcs.contract_id AND dcs.deleted_at IS NULL
      LEFT JOIN sectors s ON dcs.sector_id = s.id
      WHERE dc.id = $1 AND dc.deleted_at IS NULL
    `;

    const contractResult = await pool.query(query, [contractId]);

    if (contractResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Contract negăsit",
      });
    }

    // Get amendments
    const amendmentsQuery = `
      SELECT *
      FROM disposal_contract_amendments
      WHERE contract_id = $1 AND deleted_at IS NULL
      ORDER BY amendment_date DESC, id DESC
    `;
    const amendmentsResult = await pool.query(amendmentsQuery, [contractId]);

    res.json({
      success: true,
      data: {
        ...contractResult.rows[0],
        amendments: amendmentsResult.rows,
      },
    });
  } catch (err) {
    console.error("Error fetching contract:", err);
    res.status(500).json({
      success: false,
      message: "Eroare la încărcarea contractului",
    });
  }
};

// ============================================================================
// VALIDATE DISPOSAL CONTRACT (before save)
// ============================================================================
export const validateDisposalContract = async (req, res) => {
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
        SELECT dc.id, dc.contract_number
        FROM disposal_contracts dc
        WHERE dc.contract_number = $1 
          AND dc.deleted_at IS NULL
          ${id ? 'AND dc.id != $2' : ''}
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

    // 2. CHECK EXISTING CONTRACT FOR SAME INSTITUTION + SECTOR
    if (institution_id && sector_id) {
      const existingContractQuery = `
        SELECT dc.id, dc.contract_number, dc.contract_date_start, dc.contract_date_end,
               i.name as institution_name, s.sector_number
        FROM disposal_contracts dc
        LEFT JOIN disposal_contract_sectors dcs ON dc.id = dcs.contract_id AND dcs.deleted_at IS NULL
        LEFT JOIN institutions i ON dc.institution_id = i.id
        LEFT JOIN sectors s ON dcs.sector_id = s.id
        WHERE dc.institution_id = $1 
          AND dcs.sector_id = $2
          AND dc.is_active = true
          AND dc.deleted_at IS NULL
          ${id ? 'AND dc.id != $3' : ''}
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
          message: `Există deja un contract activ pentru această instituție și sector`,
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
    console.error("Error validating disposal contract:", err);
    res.status(500).json({
      success: false,
      message: "Eroare la validarea contractului",
    });
  }
};

// ============================================================================
// CREATE DISPOSAL CONTRACT
// ============================================================================
export const createDisposalContract = async (req, res) => {
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
      contract_number,
      contract_date_start,
      contract_date_end,
      notes,
      is_active = true,
      // Sector data (simplified: one sector per contract)
      sector_id,
      tariff_per_ton,
      cec_tax_per_ton,
      contracted_quantity_tons,
      attribution_type,
      // ✅ ADD THESE (file fields)
  contract_file_url,
  contract_file_name,
  contract_file_size,
  contract_file_type,
  contract_file_uploaded_at,
    } = req.body;

    // Validation
    if (!contract_number || !contract_date_start) {
      return res.status(400).json({
        success: false,
        message: "Câmpuri obligatorii: contract_number, contract_date_start",
      });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Insert contract
      const contractQuery = `
        INSERT INTO disposal_contracts (
          institution_id,
          contract_number,
          contract_date_start,
          contract_date_end,
          notes,
          is_active,
          attribution_type,
          created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *
      `;

      const contractResult = await client.query(contractQuery, [
        institutionId,
        contract_number,
        contract_date_start,
        contract_date_end || null,
        notes || null,
        is_active,
        attribution_type || null,
        req.user?.id || null,
      ]);

      const contractId = contractResult.rows[0].id;

      // Insert sector details
      const sectorQuery = `
        INSERT INTO disposal_contract_sectors (
          contract_id,
          sector_id,
          tariff_per_ton,
          cec_tax_per_ton,
          contracted_quantity_tons
        ) VALUES ($1, $2, $3, $4, $5)
        RETURNING *
      `;

      await client.query(sectorQuery, [
        contractId,
        sector_id || null,
        tariff_per_ton || 0,
        cec_tax_per_ton || 0,
        contracted_quantity_tons || null,
      ]);

      await client.query("COMMIT");

      // Return the full contract
      const fullContract = await pool.query(
        `
        SELECT 
          dc.*,
          dcs.sector_id,
          dcs.tariff_per_ton,
          dcs.cec_tax_per_ton,
          dcs.contracted_quantity_tons,
          s.sector_number,
          s.sector_name,
          i.name as institution_name
        FROM disposal_contracts dc
        LEFT JOIN disposal_contract_sectors dcs ON dc.id = dcs.contract_id
        LEFT JOIN sectors s ON dcs.sector_id = s.id
        LEFT JOIN institutions i ON dc.institution_id = i.id
        WHERE dc.id = $1
      `,
        [contractId]
      );

      res.status(201).json({
        success: true,
        message: "Contract creat cu succes",
        data: fullContract.rows[0],
      });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("Error creating contract:", err);

    // Check for unique constraint violation
    if (err.code === "23505") {
      return res.status(400).json({
        success: false,
        message: "Există deja un contract cu acest număr pentru această instituție",
      });
    }

    res.status(500).json({
      success: false,
      message: "Eroare la crearea contractului",
    });
  }
};

// ============================================================================
// UPDATE DISPOSAL CONTRACT
// ============================================================================
export const updateDisposalContract = async (req, res) => {
  try {
    const { canEditData } = req.userAccess;
    if (!canEditData) {
      return res.status(403).json({
        success: false,
        message: "Nu aveți permisiune să editați contracte",
      });
    }

    const { institutionId, contractId } = req.params;
    const {
      contract_number,
      contract_date_start,
      contract_date_end,
      notes,
      is_active,
      // Sector data
      sector_id,
      tariff_per_ton,
      cec_tax_per_ton,
      contracted_quantity_tons,
      attribution_type,
    } = req.body;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Update contract
      const contractQuery = `
        UPDATE disposal_contracts SET
          contract_number = COALESCE($1, contract_number),
          contract_date_start = COALESCE($2, contract_date_start),
          contract_date_end = $3,
          notes = $4,
          is_active = COALESCE($5, is_active),
          attribution_type = COALESCE($7, attribution_type),
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $6 AND deleted_at IS NULL
        RETURNING *
      `;

      const result = await client.query(contractQuery, [
        contract_number,
        contract_date_start,
        contract_date_end || null,
        notes || null,
        is_active,
        contractId,
        attribution_type || null,
      ]);

      if (result.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({
          success: false,
          message: "Contract negăsit",
        });
      }

      // Update sector details if provided
      if (sector_id !== undefined) {
        // Delete old sector link and create new one
        await client.query("DELETE FROM disposal_contract_sectors WHERE contract_id = $1", [
          contractId,
        ]);

        await client.query(
          `
          INSERT INTO disposal_contract_sectors (
            contract_id,
            sector_id,
            tariff_per_ton,
            cec_tax_per_ton,
            contracted_quantity_tons
          ) VALUES ($1, $2, $3, $4, $5)
        `,
          [
            contractId,
            sector_id,
            tariff_per_ton || 0,
            cec_tax_per_ton || 0,
            contracted_quantity_tons || null,
          ]
        );
      }

      await client.query("COMMIT");

      res.json({
        success: true,
        message: "Contract actualizat cu succes",
        data: result.rows[0],
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
// DELETE DISPOSAL CONTRACT
// ============================================================================
export const deleteDisposalContract = async (req, res) => {
  try {
    const { canDeleteData } = req.userAccess;
    if (!canDeleteData) {
      return res.status(403).json({
        success: false,
        message: "Nu aveți permisiune să ștergeți contracte",
      });
    }

    const { contractId } = req.params;

    const query = `
      UPDATE disposal_contracts 
      SET deleted_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING id
    `;

    const result = await pool.query(query, [contractId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Contract negăsit",
      });
    }

    // Also soft-delete related sectors
    await pool.query(
      "UPDATE disposal_contract_sectors SET deleted_at = CURRENT_TIMESTAMP WHERE contract_id = $1",
      [contractId]
    );

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

// ============================================================================
// AMENDMENTS CRUD
// ============================================================================

/**
 * GET all amendments for a contract
 */
export const getContractAmendments = async (req, res) => {
  try {
    const { contractId } = req.params;

    const query = `
      SELECT 
        dca.*,
        u.first_name || ' ' || u.last_name as created_by_name
      FROM disposal_contract_amendments dca
      LEFT JOIN users u ON dca.created_by = u.id
      WHERE dca.contract_id = $1 AND dca.deleted_at IS NULL
      ORDER BY dca.amendment_date DESC, dca.id DESC
    `;

    const result = await pool.query(query, [contractId]);

    res.json({
      success: true,
      data: result.rows,
    });
  } catch (err) {
    console.error("Error fetching amendments:", err);
    res.status(500).json({
      success: false,
      message: "Eroare la încărcarea actelor adiționale",
    });
  }
};

/**
 * CREATE amendment for a contract
 */
export const createContractAmendment = async (req, res) => {
  try {
    const { canEditData } = req.userAccess;
    if (!canEditData) {
      return res.status(403).json({
        success: false,
        message: "Nu aveți permisiune să adăugați acte adiționale",
      });
    }

    const { contractId } = req.params;
    const {
      amendment_number,
      amendment_date,
      amendment_type, // EXTENSION, TARIFF_CHANGE, QUANTITY_CHANGE, MULTIPLE
      new_contract_date_end,
      new_tariff_per_ton,
      new_cec_tax_per_ton,
      new_contracted_quantity_tons,
      changes_description,
      reason,
      notes,
    } = req.body;

    // Validation
    if (!amendment_number || !amendment_date) {
      return res.status(400).json({
        success: false,
        message: "Numărul și data actului adițional sunt obligatorii",
      });
    }

    // Check contract exists
    const contractCheck = await pool.query(
      "SELECT id, contract_number FROM disposal_contracts WHERE id = $1 AND deleted_at IS NULL",
      [contractId]
    );

    if (contractCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Contract negăsit",
      });
    }

    // Determine amendment type if not provided
    let finalAmendmentType = amendment_type;
    if (!finalAmendmentType) {
      const changes = [];
      if (new_contract_date_end) changes.push("EXTENSION");
      if (new_tariff_per_ton !== undefined || new_cec_tax_per_ton !== undefined)
        changes.push("TARIFF_CHANGE");
      if (new_contracted_quantity_tons !== undefined) changes.push("QUANTITY_CHANGE");

      finalAmendmentType = changes.length > 1 ? "MULTIPLE" : changes[0] || "MULTIPLE";
    }

    const query = `
      INSERT INTO disposal_contract_amendments (
        contract_id,
        amendment_number,
        amendment_date,
        amendment_type,
        new_contract_date_end,
        new_tariff_per_ton,
        new_cec_tax_per_ton,
        new_contracted_quantity_tons,
        changes_description,
        reason,
        notes,
        created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *
    `;

    const result = await pool.query(query, [
      contractId,
      amendment_number,
      amendment_date,
      finalAmendmentType,
      new_contract_date_end || null,
      new_tariff_per_ton || null,
      new_cec_tax_per_ton || null,
      new_contracted_quantity_tons || null,
      changes_description || null,
      reason || null,
      notes || null,
      req.user?.id || null,
    ]);

    res.status(201).json({
      success: true,
      message: "Act adițional adăugat cu succes",
      data: result.rows[0],
    });
  } catch (err) {
    console.error("Error creating amendment:", err);

    if (err.code === "23505") {
      return res.status(400).json({
        success: false,
        message: "Există deja un act adițional cu acest număr pentru acest contract",
      });
    }

    res.status(500).json({
      success: false,
      message: "Eroare la adăugarea actului adițional",
    });
  }
};

/**
 * UPDATE amendment
 */
export const updateContractAmendment = async (req, res) => {
  try {
    const { canEditData } = req.userAccess;
    if (!canEditData) {
      return res.status(403).json({
        success: false,
        message: "Nu aveți permisiune să editați acte adiționale",
      });
    }

    const { contractId, amendmentId } = req.params;
    const {
      amendment_number,
      amendment_date,
      amendment_type,
      new_contract_date_end,
      new_tariff_per_ton,
      new_cec_tax_per_ton,
      new_contracted_quantity_tons,
      changes_description,
      reason,
      notes,
    } = req.body;

    const query = `
      UPDATE disposal_contract_amendments SET
        amendment_number = COALESCE($1, amendment_number),
        amendment_date = COALESCE($2, amendment_date),
        amendment_type = COALESCE($3, amendment_type),
        new_contract_date_end = $4,
        new_tariff_per_ton = $5,
        new_cec_tax_per_ton = $6,
        new_contracted_quantity_tons = $7,
        changes_description = $8,
        reason = $9,
        notes = $10,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $11 AND contract_id = $12 AND deleted_at IS NULL
      RETURNING *
    `;

    const result = await pool.query(query, [
      amendment_number,
      amendment_date,
      amendment_type,
      new_contract_date_end || null,
      new_tariff_per_ton || null,
      new_cec_tax_per_ton || null,
      new_contracted_quantity_tons || null,
      changes_description || null,
      reason || null,
      notes || null,
      amendmentId,
      contractId,
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
    console.error("Error updating amendment:", err);
    res.status(500).json({
      success: false,
      message: "Eroare la actualizarea actului adițional",
    });
  }
};

/**
 * DELETE amendment
 */
export const deleteContractAmendment = async (req, res) => {
  try {
    const { canDeleteData } = req.userAccess;
    if (!canDeleteData) {
      return res.status(403).json({
        success: false,
        message: "Nu aveți permisiune să ștergeți acte adiționale",
      });
    }

    const { contractId, amendmentId } = req.params;

    const query = `
      UPDATE disposal_contract_amendments 
      SET deleted_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND contract_id = $2 AND deleted_at IS NULL
      RETURNING id
    `;

    const result = await pool.query(query, [amendmentId, contractId]);

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
    console.error("Error deleting amendment:", err);
    res.status(500).json({
      success: false,
      message: "Eroare la ștergerea actului adițional",
    });
  }
};

// ============================================================================
// EXPORT ALL
// ============================================================================
export default {
  getDisposalContracts,
  getDisposalContract,
  validateDisposalContract,
  createDisposalContract,
  updateDisposalContract,
  deleteDisposalContract,
  getContractAmendments,
  createContractAmendment,
  updateContractAmendment,
  deleteContractAmendment,
};
