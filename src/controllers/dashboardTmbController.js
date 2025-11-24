// ============================================================================
// TMB DASHBOARD SERVICE
// ============================================================================
// Service for fetching TMB (Mechanical-Biological Treatment) dashboard data
// ============================================================================

import { apiGet } from '../api/apiClient';

/**
 * Get comprehensive TMB statistics
 * @param {Object} params - Query parameters
 * @param {string} params.start_date - Start date (YYYY-MM-DD)
 * @param {string} params.end_date - End date (YYYY-MM-DD)
 * @param {string} params.sector_id - Sector UUID
 * @param {number} params.tmb_association_id - TMB association ID
 * @returns {Promise} TMB statistics data
 */
export const getTmbStats = async (params = {}) => {
  try {
    const response = await apiGet('/api/dashboard/tmb/stats', params);
    return response;
  } catch (error) {
    console.error('Error fetching TMB stats:', error);
    throw error;
  }
};

/**
 * Get detailed breakdown of output streams (recycling, recovery, disposal)
 * @param {Object} params - Query parameters
 * @param {string} params.output_type - 'recycling', 'recovery', or 'disposal'
 * @param {string} params.start_date - Start date (YYYY-MM-DD)
 * @param {string} params.end_date - End date (YYYY-MM-DD)
 * @param {string} params.sector_id - Sector UUID
 * @returns {Promise} Output details data
 */
export const getOutputDetails = async (params = {}) => {
  try {
    if (!params.output_type) {
      throw new Error('output_type is required');
    }
    const response = await apiGet('/api/dashboard/tmb/output-details', params);
    return response;
  } catch (error) {
    console.error('Error fetching output details:', error);
    throw error;
  }
};

export default {
  getTmbStats,
  getOutputDetails
};