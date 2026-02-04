// src/utils/proportionalQuantity.js
/**
 * ============================================================================
 * PROPORTIONAL QUANTITY CALCULATION FOR CONTRACT AMENDMENTS
 * ============================================================================
 * Când se prelungește un contract (EXTENSION), cantitatea se calculează automat
 * proporțional cu perioada de prelungire.
 * 
 * Formula: new_quantity = (original_quantity / total_days) × extension_days
 * ============================================================================
 */

/**
 * Calculate proportional quantity for contract extension
 * 
 * @param {Object} params
 * @param {string} params.originalStartDate - Data început contract (YYYY-MM-DD)
 * @param {string} params.originalEndDate - Data sfârșit contract original (YYYY-MM-DD)
 * @param {string} params.newEndDate - Data sfârșit contract după prelungire (YYYY-MM-DD)
 * @param {number} params.originalQuantity - Cantitatea originală estimată (tone)
 * @param {string} params.amendmentType - Tipul actului adițional
 * 
 * @returns {number|null} - Cantitatea calculată proporțional sau null dacă nu e EXTENSION
 */
export const calculateProportionalQuantity = ({
    originalStartDate,
    originalEndDate,
    newEndDate,
    originalQuantity,
    amendmentType
  }) => {
    // Calculul proporțional se face DOAR pentru EXTENSION
    if (amendmentType !== 'EXTENSION') {
      return null;
    }
  
    // Validare parametri
    if (!originalStartDate || !originalEndDate || !newEndDate || !originalQuantity) {
      console.warn('calculateProportionalQuantity: Missing required parameters');
      return null;
    }
  
    try {
      const startDate = new Date(originalStartDate);
      const endDate = new Date(originalEndDate);
      const newEnd = new Date(newEndDate);
  
      // Validare date
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime()) || isNaN(newEnd.getTime())) {
        console.error('calculateProportionalQuantity: Invalid dates');
        return null;
      }
  
      // Validare cantitate
      const qty = parseFloat(originalQuantity);
      if (isNaN(qty) || qty <= 0) {
        console.error('calculateProportionalQuantity: Invalid quantity');
        return null;
      }
  
      // Validare logică: newEndDate trebuie să fie după originalEndDate
      if (newEnd <= endDate) {
        console.warn('calculateProportionalQuantity: New end date must be after original end date');
        return null;
      }
  
      // Calcul zile
      const MS_PER_DAY = 1000 * 60 * 60 * 24;
      const totalDays = Math.round((endDate - startDate) / MS_PER_DAY);
      const extensionDays = Math.round((newEnd - endDate) / MS_PER_DAY);
  
      // Validare zile
      if (totalDays <= 0) {
        console.error('calculateProportionalQuantity: Invalid total days');
        return null;
      }
  
      // FORMULA: cantitate_nouă = (cantitate_originală / zile_totale) × zile_prelungire
      const proportionalQuantity = (qty / totalDays) * extensionDays;
  
      // Round la 3 decimale
      const rounded = Math.round(proportionalQuantity * 1000) / 1000;
  
      console.log(`📊 Proportional Quantity Calculation:
        Original: ${originalStartDate} → ${originalEndDate} (${totalDays} days)
        Extension: ${originalEndDate} → ${newEndDate} (${extensionDays} days)
        Original Quantity: ${qty} t
        Daily Rate: ${(qty / totalDays).toFixed(4)} t/day
        Proportional Quantity: ${rounded} t
      `);
  
      return rounded;
    } catch (error) {
      console.error('calculateProportionalQuantity error:', error);
      return null;
    }
  };
  
  /**
   * Helper function to get contract dates and quantity from database
   * Used by amendment creation endpoints
   * 
   * @param {Object} pool - Database pool
   * @param {string} tableName - Contract table name
   * @param {string} contractId - Contract UUID
   * @param {string} quantityField - Name of quantity field (estimated_quantity_tons or contracted_quantity_tons)
   * 
   * @returns {Object|null} - { contract_date_start, contract_date_end, quantity } or null
   */
  export const getContractDataForProportional = async (pool, tableName, contractId, quantityField = 'estimated_quantity_tons') => {
    try {
      const query = `
        SELECT 
          contract_date_start,
          contract_date_end,
          ${quantityField} as quantity
        FROM ${tableName}
        WHERE id = $1 AND deleted_at IS NULL
      `;
      
      const result = await pool.query(query, [contractId]);
      
      if (result.rows.length === 0) {
        console.error(`Contract not found: ${contractId} in ${tableName}`);
        return null;
      }
  
      return result.rows[0];
    } catch (error) {
      console.error('getContractDataForProportional error:', error);
      return null;
    }
  };
  
  /**
   * Example usage in amendment creation:
   * 
   * const contractData = await getContractDataForProportional(
   *   pool, 
   *   'tmb_contracts', 
   *   contractId, 
   *   'estimated_quantity_tons'
   * );
   * 
   * if (contractData && amendment_type === 'EXTENSION') {
   *   const calculatedQty = calculateProportionalQuantity({
   *     originalStartDate: contractData.contract_date_start,
   *     originalEndDate: contractData.contract_date_end,
   *     newEndDate: new_contract_date_end,
   *     originalQuantity: contractData.quantity,
   *     amendmentType: amendment_type
   *   });
   *   
   *   // Use calculatedQty as default if new_estimated_quantity_tons not provided
   *   const finalQty = new_estimated_quantity_tons || calculatedQty;
   * }
   */
  
  export default {
    calculateProportionalQuantity,
    getContractDataForProportional
  };