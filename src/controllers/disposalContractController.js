// controllers/disposalContractController.js
/**
 * ============================================================================
 * DISPOSAL CONTRACT CONTROLLER - ES6
 * ============================================================================
 * CRUD operations pentru contracte clienți depozit
 * ============================================================================
 */

import pool from '../config/database.js';

/**
 * GET all disposal contracts
 */
export const getDisposalContracts = async (req, res) => {
  try {
    const { institutionId } = req.params;

    const query = `
      SELECT 
        dc.*,
        -- Get sectors with tariffs
        COALESCE(
          json_agg(
            json_build_object(
              'sector_id', dcs.sector_id,
              'sector_number', s.sector_number,
              'sector_name', s.sector_name,
              'tariff', dcs.tariff,
              'cec', dcs.cec,
              'notes', dcs.notes
            ) ORDER BY s.sector_number
          ) FILTER (WHERE dcs.id IS NOT NULL),
          '[]'
        ) as sectors
      FROM disposal_contracts dc
      LEFT JOIN disposal_contract_sectors dcs ON dc.id = dcs.contract_id
      LEFT JOIN sectors s ON dcs.sector_id = s.id
      WHERE dc.deleted_at IS NULL
      GROUP BY dc.id
      ORDER BY dc.contract_date_start DESC
    `;

    const result = await pool.query(query);

    res.json({
      success: true,
      data: result.rows
    });
  } catch (err) {
    console.error('Error fetching disposal contracts:', err);
    res.status(500).json({
      success: false,
      message: 'Eroare la încărcarea contractelor'
    });
  }
};

/**
 * GET single disposal contract
 */
export const getDisposalContract = async (req, res) => {
  try {
    const { institutionId, contractId } = req.params;

    const query = `
      SELECT 
        dc.*,
        COALESCE(
          json_agg(
            json_build_object(
              'sector_id', dcs.sector_id,
              'sector_number', s.sector_number,
              'sector_name', s.sector_name,
              'tariff', dcs.tariff,
              'cec', dcs.cec,
              'notes', dcs.notes
            ) ORDER BY s.sector_number
          ) FILTER (WHERE dcs.id IS NOT NULL),
          '[]'
        ) as sectors
      FROM disposal_contracts dc
      LEFT JOIN disposal_contract_sectors dcs ON dc.id = dcs.contract_id
      LEFT JOIN sectors s ON dcs.sector_id = s.id
      WHERE dc.id = $1 AND dc.deleted_at IS NULL
      GROUP BY dc.id
    `;

    const result = await pool.query(query, [contractId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Contract negăsit'
      });
    }

    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (err) {
    console.error('Error fetching contract:', err);
    res.status(500).json({
      success: false,
      message: 'Eroare la încărcarea contractului'
    });
  }
};

/**
 * CREATE disposal contract
 */
export const createDisposalContract = async (req, res) => {
  try {
    const { institutionId } = req.params;
    const {
      contract_number,
      contract_date_start,
      contract_date_end,
      currency = 'RON',
      notes,
      is_active = true,
      sectors = []
    } = req.body;

    if (!contract_number || !contract_date_start || sectors.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Câmpuri obligatorii lipsesc'
      });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Insert contract
      const contractQuery = `
        INSERT INTO disposal_contracts (
          contract_number, contract_date_start,
          contract_date_end, currency, notes, is_active
        ) VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `;

      const contractResult = await client.query(contractQuery, [
        contract_number,
        contract_date_start,
        contract_date_end || null,
        currency,
        notes || null,
        is_active
      ]);

      const contractId = contractResult.rows[0].id;

      // Insert sectors with tariffs
      for (const sector of sectors) {
        await client.query(
          `INSERT INTO disposal_contract_sectors 
           (contract_id, sector_id, tariff, cec, notes)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            contractId,
            sector.sector_id,
            sector.tariff,
            sector.cec || null,
            sector.notes || null
          ]
        );
      }

      await client.query('COMMIT');

      res.status(201).json({
        success: true,
        message: 'Contract creat cu succes',
        data: contractResult.rows[0]
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Error creating contract:', err);
    res.status(500).json({
      success: false,
      message: 'Eroare la crearea contractului'
    });
  }
};

/**
 * UPDATE disposal contract
 */
export const updateDisposalContract = async (req, res) => {
  try {
    const { institutionId, contractId } = req.params;
    const {
      contract_number,
      contract_date_start,
      contract_date_end,
      currency,
      notes,
      is_active,
      sectors = []
    } = req.body;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Update contract
      const contractQuery = `
        UPDATE disposal_contracts SET
          contract_number = $1,
          contract_date_start = $2,
          contract_date_end = $3,
          currency = $4,
          notes = $5,
          is_active = $6,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $7 AND deleted_at IS NULL
        RETURNING *
      `;

      const result = await client.query(contractQuery, [
        contract_number,
        contract_date_start,
        contract_date_end || null,
        currency,
        notes || null,
        is_active,
        contractId
      ]);

      if (result.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          message: 'Contract negăsit'
        });
      }

      // Delete old sectors
      await client.query(
        'DELETE FROM disposal_contract_sectors WHERE contract_id = $1',
        [contractId]
      );

      // Insert new sectors
      for (const sector of sectors) {
        await client.query(
          `INSERT INTO disposal_contract_sectors 
           (contract_id, sector_id, tariff, cec, notes)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            contractId,
            sector.sector_id,
            sector.tariff,
            sector.cec || null,
            sector.notes || null
          ]
        );
      }

      await client.query('COMMIT');

      res.json({
        success: true,
        message: 'Contract actualizat cu succes',
        data: result.rows[0]
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Error updating contract:', err);
    res.status(500).json({
      success: false,
      message: 'Eroare la actualizarea contractului'
    });
  }
};

/**
 * DELETE disposal contract
 */
export const deleteDisposalContract = async (req, res) => {
  try {
    const { institutionId, contractId } = req.params;

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
        message: 'Contract negăsit'
      });
    }

    res.json({
      success: true,
      message: 'Contract șters cu succes'
    });
  } catch (err) {
    console.error('Error deleting contract:', err);
    res.status(500).json({
      success: false,
      message: 'Eroare la ștergerea contractului'
    });
  }
};