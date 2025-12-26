// src/controllers/sectorController.js
import pool from '../config/database.js';

// ============================================================================
// SECTOR MANAGEMENT
// ============================================================================

// GET ALL SECTORS (cu instituții asociate)
export const getAllSectors = async (req, res) => {
  try {
    const { includeInstitutions = 'true' } = req.query;

    let query = `
      SELECT 
        s.id,
        s.sector_number,
        s.sector_name,
        s.city,
        s.description,
        s.area_km2,
        s.population,
        s.is_active,
        s.created_at,
        s.updated_at
    `;

    // Adaugă instituții asociate dacă e cerut
    if (includeInstitutions === 'true') {
      query += `,
        (
          SELECT json_agg(
            json_build_object(
              'id', i.id,
              'name', i.name,
              'short_name', i.short_name,
              'type', i.type
            )
          )
          FROM institution_sectors ins
          JOIN institutions i ON ins.institution_id = i.id
          WHERE ins.sector_id = s.id AND i.deleted_at IS NULL
        ) as institutions
      `;
    }

    query += `
      FROM sectors s
      WHERE s.is_active = true 
        AND (s.deleted_at IS NULL OR s.deleted_at > NOW())
      ORDER BY s.sector_number ASC
    `;

    const result = await pool.query(query);

    // Statistici
    const statsQuery = `
      SELECT 
        s.sector_number,
        COUNT(DISTINCT ins.institution_id) as institution_count,
        COUNT(DISTINCT CASE WHEN i.type = 'MUNICIPALITY' THEN i.id END) as municipality_count,
        COUNT(DISTINCT CASE WHEN i.type = 'WASTE_COLLECTOR' THEN i.id END) as collector_count,
        COUNT(DISTINCT CASE WHEN i.type = 'TMB_OPERATOR' THEN i.id END) as tmb_count,
        COUNT(DISTINCT CASE WHEN i.type = 'SORTING_OPERATOR' THEN i.id END) as sorting_count
      FROM sectors s
      LEFT JOIN institution_sectors ins ON s.id = ins.sector_id
      LEFT JOIN institutions i ON ins.institution_id = i.id AND i.deleted_at IS NULL
      WHERE s.is_active = true 
        AND (s.deleted_at IS NULL OR s.deleted_at > NOW())
      GROUP BY s.id, s.sector_number
      ORDER BY s.sector_number
    `;

    const statsResult = await pool.query(statsQuery);

    res.json({
      success: true,
      data: result.rows,
      stats: statsResult.rows
    });
  } catch (error) {
    console.error('Get sectors error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la obținerea sectorelor'
    });
  }
};

// GET SECTOR BY ID
export const getSectorById = async (req, res) => {
  try {
    const { id } = req.params;

    const query = `
      SELECT 
        s.id,
        s.sector_number,
        s.sector_name,
        s.city,
        s.description,
        s.area_km2,
        s.population,
        s.is_active,
        s.created_at,
        s.updated_at,
        (
          SELECT json_agg(
            json_build_object(
              'id', i.id,
              'name', i.name,
              'short_name', i.short_name,
              'type', i.type,
              'contact_email', i.contact_email,
              'contact_phone', i.contact_phone
            )
          )
          FROM institution_sectors ins
          JOIN institutions i ON ins.institution_id = i.id
          WHERE ins.sector_id = s.id AND i.deleted_at IS NULL
        ) as institutions
      FROM sectors s
      WHERE s.id = $1 
        AND s.is_active = true 
        AND (s.deleted_at IS NULL OR s.deleted_at > NOW())
    `;

    const result = await pool.query(query, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Sector negăsit'
      });
    }

    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Get sector error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la obținerea sectorului'
    });
  }
};

// UPDATE SECTOR (nume, descriere, date generale)
export const updateSector = async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { id } = req.params;
    const { sector_name, description, area_km2, population } = req.body;

    await client.query('BEGIN');

    // Verifică dacă sectorul există
    const checkQuery = `
      SELECT id FROM sectors 
      WHERE id = $1 
        AND is_active = true 
        AND (deleted_at IS NULL OR deleted_at > NOW())
    `;
    const checkResult = await client.query(checkQuery, [id]);

    if (checkResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        message: 'Sector negăsit'
      });
    }

    // Update sector
    const updateQuery = `
      UPDATE sectors
      SET 
        sector_name = COALESCE($1, sector_name),
        description = COALESCE($2, description),
        area_km2 = COALESCE($3, area_km2),
        population = COALESCE($4, population),
        updated_at = NOW()
      WHERE id = $5
      RETURNING *
    `;

    const result = await client.query(updateQuery, [
      sector_name,
      description,
      area_km2,
      population,
      id
    ]);

    await client.query('COMMIT');

    res.json({
      success: true,
      message: 'Sector actualizat cu succes',
      data: result.rows[0]
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Update sector error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la actualizarea sectorului'
    });
  } finally {
    client.release();
  }
};

// UPDATE SECTOR INSTITUTIONS (asociere/disociere instituții)
export const updateSectorInstitutions = async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { id } = req.params;
    const { institutionIds } = req.body; // Array of institution IDs

    if (!Array.isArray(institutionIds)) {
      return res.status(400).json({
        success: false,
        message: 'institutionIds trebuie să fie un array'
      });
    }

    await client.query('BEGIN');

    // Verifică dacă sectorul există
    const checkQuery = `
      SELECT id FROM sectors 
      WHERE id = $1 
        AND is_active = true 
        AND (deleted_at IS NULL OR deleted_at > NOW())
    `;
    const checkResult = await client.query(checkQuery, [id]);

    if (checkResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        message: 'Sector negăsit'
      });
    }

    // Șterge toate asocierile curente
    await client.query('DELETE FROM institution_sectors WHERE sector_id = $1', [id]);

    // Inserează noile asocieri
    if (institutionIds.length > 0) {
      const insertPromises = institutionIds.map(instId => {
        return client.query(
          'INSERT INTO institution_sectors (institution_id, sector_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [instId, id]
        );
      });

      await Promise.all(insertPromises);
    }

    await client.query('COMMIT');

    // Returnează sectorul actualizat cu instituțiile
    const updatedSector = await pool.query(`
      SELECT 
        s.*,
        (
          SELECT json_agg(
            json_build_object(
              'id', i.id,
              'name', i.name,
              'short_name', i.short_name,
              'type', i.type
            )
          )
          FROM institution_sectors ins
          JOIN institutions i ON ins.institution_id = i.id
          WHERE ins.sector_id = s.id AND i.deleted_at IS NULL
        ) as institutions
      FROM sectors s
      WHERE s.id = $1
    `, [id]);

    res.json({
      success: true,
      message: 'Instituții actualizate cu succes',
      data: updatedSector.rows[0]
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Update sector institutions error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la actualizarea instituțiilor'
    });
  } finally {
    client.release();
  }
};

// GET SECTOR STATISTICS
export const getSectorStatistics = async (req, res) => {
  try {
    const { id } = req.params;

    const statsQuery = `
      SELECT 
        s.sector_number,
        s.sector_name,
        s.population,
        s.area_km2,
        COUNT(DISTINCT ins.institution_id) as total_institutions,
        COUNT(DISTINCT CASE WHEN i.type = 'MUNICIPALITY' THEN i.id END) as municipalities,
        COUNT(DISTINCT CASE WHEN i.type = 'WASTE_COLLECTOR' THEN i.id END) as waste_collectors,
        COUNT(DISTINCT CASE WHEN i.type = 'TMB_OPERATOR' THEN i.id END) as tmb_operators,
        COUNT(DISTINCT CASE WHEN i.type = 'SORTING_OPERATOR' THEN i.id END) as sorting_operators,
        COUNT(DISTINCT CASE WHEN i.type = 'LANDFILL' THEN i.id END) as landfills,
        COUNT(DISTINCT CASE WHEN i.type = 'REGULATOR' THEN i.id END) as regulators
      FROM sectors s
      LEFT JOIN institution_sectors ins ON s.id = ins.sector_id
      LEFT JOIN institutions i ON ins.institution_id = i.id AND i.deleted_at IS NULL
      WHERE s.id = $1 
        AND s.is_active = true 
        AND (s.deleted_at IS NULL OR s.deleted_at > NOW())
      GROUP BY s.id, s.sector_number, s.sector_name, s.population, s.area_km2
    `;

    const result = await pool.query(statsQuery, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Sector negăsit'
      });
    }

    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Get sector statistics error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la obținerea statisticilor'
    });
  }
};

// GET INSTITUTIONS BY SECTOR
export const getInstitutionsBySector = async (req, res) => {
  try {
    const { id } = req.params;
    const { type } = req.query; // Optional: filter by institution type

    let query = `
      SELECT 
        i.id,
        i.name,
        i.short_name,
        i.type,
        i.contact_email,
        i.contact_phone,
        i.address
      FROM institution_sectors ins
      JOIN institutions i ON ins.institution_id = i.id
      WHERE ins.sector_id = $1 AND i.deleted_at IS NULL
    `;

    const params = [id];

    if (type) {
      query += ' AND i.type = $2';
      params.push(type);
    }

    query += ' ORDER BY i.type, i.name';

    const result = await pool.query(query, params);

    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('Get institutions by sector error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la obținerea instituțiilor'
    });
  }
};