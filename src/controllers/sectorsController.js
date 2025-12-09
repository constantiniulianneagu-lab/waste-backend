// src/controllers/sectorsController.js
/**
 * ============================================================================
 * SECTORS CONTROLLER
 * ============================================================================
 * Get sectors pentru dropdown-uri în contracte
 * ============================================================================
 */

import pool from '../config/database.js';

// ============================================================================
// GET ALL SECTORS
// ============================================================================

export const getAllSectors = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, sector_number, sector_name, city, is_active
       FROM sectors
       WHERE is_active = true
       ORDER BY sector_number`
    );
    
    res.json({
      success: true,
      data: result.rows
    });
    
  } catch (err) {
    console.error('Get sectors error:', err);
    res.status(500).json({
      success: false,
      message: 'Eroare la obținerea sectoarelor'
    });
  }
};

// ============================================================================
// GET SECTOR BY ID
// ============================================================================

export const getSectorById = async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query(
      'SELECT * FROM sectors WHERE id = $1',
      [id]
    );
    
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
    
  } catch (err) {
    console.error('Get sector error:', err);
    res.status(500).json({
      success: false,
      message: 'Eroare la obținerea sectorului'
    });
  }
};