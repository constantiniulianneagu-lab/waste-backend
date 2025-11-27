// ============================================================================
// TMB OPERATORS CONTROLLER
// ============================================================================

import pool from '../config/database.js';

export const getTmbOperatorsBySector = async (req, res) => {
  try {
    const { sector_id, date } = req.query;

    if (!sector_id) {
      return res.status(400).json({
        success: false,
        message: 'sector_id is required'
      });
    }

    let sectorUuid = sector_id;
    
    if (!isNaN(sector_id) && parseInt(sector_id) >= 1 && parseInt(sector_id) <= 6) {
      const sectorQuery = await pool.query(
        `SELECT id FROM sectors WHERE sector_number = $1 AND is_active = true`,
        [parseInt(sector_id)]
      );
      
      if (sectorQuery.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: `Sector ${sector_id} not found`
        });
      }
      
      sectorUuid = sectorQuery.rows[0].id;
    }

    const validationDate = date || new Date().toISOString().split('T')[0];

    const query = `
      SELECT DISTINCT
        i.id,
        i.name,
        i.short_name,
        ta.association_name,
        ta.valid_from,
        ta.valid_to,
        CASE 
          WHEN i.id = ta.primary_operator_id THEN 'primary'
          WHEN i.id = ta.secondary_operator_id THEN 'secondary'
        END as role,
        ta.is_active as association_active
      FROM tmb_associations ta
      JOIN institutions i ON (
        i.id = ta.primary_operator_id OR 
        i.id = ta.secondary_operator_id
      )
      WHERE ta.sector_id = $1
        AND $2 >= ta.valid_from
        AND (ta.valid_to IS NULL OR $2 <= ta.valid_to)
        AND ta.is_active = true
        AND i.is_active = true
        AND i.deleted_at IS NULL
      ORDER BY 
        CASE WHEN i.id = ta.primary_operator_id THEN 1 ELSE 2 END,
        i.name
    `;

    const result = await pool.query(query, [sectorUuid, validationDate]);

    res.json({
      success: true,
      data: result.rows,
      meta: {
        sector_id: sectorUuid,
        validation_date: validationDate,
        count: result.rows.length
      }
    });

  } catch (error) {
    console.error('❌ Get TMB operators error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch TMB operators',
      error: error.message
    });
  }
};

export const getTmbAssociations = async (req, res) => {
  try {
    const { sector_id, include_history } = req.query;

    let query = `
      SELECT 
        ta.id,
        ta.sector_id,
        s.sector_name,
        s.sector_number,
        ta.primary_operator_id,
        ip.name as primary_operator_name,
        ta.secondary_operator_id,
        is_op.name as secondary_operator_name,
        ta.association_name,
        ta.valid_from,
        ta.valid_to,
        ta.is_active,
        CASE 
          WHEN ta.valid_to IS NULL OR ta.valid_to >= CURRENT_DATE THEN 'active'
          ELSE 'historic'
        END as status
      FROM tmb_associations ta
      JOIN sectors s ON ta.sector_id = s.id
      JOIN institutions ip ON ta.primary_operator_id = ip.id
      LEFT JOIN institutions is_op ON ta.secondary_operator_id = is_op.id
      WHERE 1=1
    `;

    const params = [];
    let paramIndex = 1;

    if (sector_id) {
      let sectorUuid = sector_id;
      
      if (!isNaN(sector_id) && parseInt(sector_id) >= 1 && parseInt(sector_id) <= 6) {
        const sectorQuery = await pool.query(
          `SELECT id FROM sectors WHERE sector_number = $1`,
          [parseInt(sector_id)]
        );
        
        if (sectorQuery.rows.length > 0) {
          sectorUuid = sectorQuery.rows[0].id;
        }
      }
      
      query += ` AND ta.sector_id = $${paramIndex}`;
      params.push(sectorUuid);
      paramIndex++;
    }

    if (include_history !== 'true') {
      query += ` AND ta.is_active = true`;
      query += ` AND (ta.valid_to IS NULL OR ta.valid_to >= CURRENT_DATE)`;
    }

    query += ` ORDER BY s.sector_number, ta.valid_from DESC`;

    const result = await pool.query(query, params);

    res.json({
      success: true,
      data: result.rows,
      meta: {
        count: result.rows.length,
        include_history: include_history === 'true'
      }
    });

  } catch (error) {
    console.error('❌ Get TMB associations error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch TMB associations',
      error: error.message
    });
  }
};

export default {
  getTmbOperatorsBySector,
  getTmbAssociations
};