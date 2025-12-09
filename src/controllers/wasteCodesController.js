// src/controllers/wasteCodesController.js
/**
 * ============================================================================
 * WASTE CODES CONTROLLER
 * ============================================================================
 * Get waste codes pentru dropdown-uri în contracte
 * ============================================================================
 */

import pool from '../config/database.js';

// ============================================================================
// GET ALL WASTE CODES
// ============================================================================

export const getAllWasteCodes = async (req, res) => {
  try {
    const { search, category } = req.query;
    
    let query = `
      SELECT id, code, description, category, is_active
      FROM waste_codes
      WHERE is_active = true
    `;
    
    const params = [];
    let paramCount = 1;
    
    if (search) {
      query += ` AND (code ILIKE $${paramCount} OR description ILIKE $${paramCount})`;
      params.push(`%${search}%`);
      paramCount++;
    }
    
    if (category) {
      query += ` AND category = $${paramCount}`;
      params.push(category);
      paramCount++;
    }
    
    query += ` ORDER BY code`;
    
    const result = await pool.query(query, params);
    
    res.json({
      success: true,
      data: result.rows
    });
    
  } catch (err) {
    console.error('Get waste codes error:', err);
    res.status(500).json({
      success: false,
      message: 'Eroare la obținerea codurilor de deșeuri'
    });
  }
};

// ============================================================================
// GET WASTE CODE BY ID
// ============================================================================

export const getWasteCodeById = async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query(
      'SELECT * FROM waste_codes WHERE id = $1',
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Cod deșeu negăsit'
      });
    }
    
    res.json({
      success: true,
      data: result.rows[0]
    });
    
  } catch (err) {
    console.error('Get waste code error:', err);
    res.status(500).json({
      success: false,
      message: 'Eroare la obținerea codului de deșeu'
    });
  }
};