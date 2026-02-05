// src/utils/proportionalQuantity.js
/**
 * ============================================================================
 * PROPORTIONAL QUANTITY CALCULATION FOR CONTRACT AMENDMENTS
 * ============================================================================
 * Când se prelungește un contract (EXTENSION / PRELUNGIRE), cantitatea se
 * calculează automat proporțional cu TOATĂ perioada contractului.
 *
 * LOGICA CORECTĂ:
 * - Contract inițial: 02/07/2024 - 02/06/2025 (1 an) = 84,979 tone
 * - Prelungire 1 până la 02/06/2026 (+1 an): Total 2 ani = 84,979 × 2 = 169,958 tone
 * - Prelungire 2 până la 02/06/2027 (+1 an): Total 3 ani = 84,979 × 3 = 254,937 tone
 *
 * Formula: new_total_quantity = original_quantity × (total_new_duration / original_duration)
 * ============================================================================
 */

/**
 * Calculate CUMULATIVE proportional quantity for contract extension
 * Returns the TOTAL quantity for the entire extended contract period
 *
 * @param {Object} params
 * @param {string} params.originalStartDate - Data început contract (YYYY-MM-DD)
 * @param {string} params.originalEndDate - Data sfârșit contract original (YYYY-MM-DD)
 * @param {string} params.newEndDate - Data sfârșit contract după prelungire (YYYY-MM-DD)
 * @param {number} params.originalQuantity - Cantitatea originală estimată (tone)
 * @param {string} params.amendmentType - Tipul actului adițional (EXTENSION/PRELUNGIRE)
 *
 * @returns {number|null} - Cantitatea TOTALĂ cumulativă sau null dacă nu e EXTENSION/PRELUNGIRE
 */
export const calculateProportionalQuantity = ({
  originalStartDate,
  originalEndDate,
  newEndDate,
  originalQuantity,
  amendmentType,
}) => {
  // Calculul proporțional se face DOAR pentru prelungiri
  const isExtension = amendmentType === 'EXTENSION' || amendmentType === 'PRELUNGIRE';
  if (!isExtension) return null;

  // Validare parametri
  if (!originalStartDate || !originalEndDate || !newEndDate || originalQuantity === null || originalQuantity === undefined) {
    console.warn('calculateProportionalQuantity: Missing required parameters');
    return null;
  }

  try {
    const startDate = new Date(originalStartDate);
    const endDate = new Date(originalEndDate);
    const newEnd = new Date(newEndDate);

    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || Number.isNaN(newEnd.getTime())) {
      console.error('calculateProportionalQuantity: Invalid dates');
      return null;
    }

    const qty = parseFloat(originalQuantity);
    if (Number.isNaN(qty) || qty <= 0) {
      console.error('calculateProportionalQuantity: Invalid quantity');
      return null;
    }

    // newEnd trebuie să fie după sfârșitul original
    if (newEnd <= endDate) {
      console.warn(
        `calculateProportionalQuantity: New end date (${newEndDate}) must be after original end (${originalEndDate})`
      );
      return null;
    }

    const MS_PER_DAY = 1000 * 60 * 60 * 24;

    // Perioada ORIGINALĂ (contract inițial)
    const originalDays = Math.round((endDate - startDate) / MS_PER_DAY);

    // Perioada TOTALĂ NOUĂ (de la început până la noua dată)
    const totalNewDays = Math.round((newEnd - startDate) / MS_PER_DAY);

    if (originalDays <= 0 || totalNewDays <= 0) {
      console.error('calculateProportionalQuantity: Invalid days calculation');
      return null;
    }

    // Calculăm rata zilnică pe baza perioadei originale
    const dailyRate = qty / originalDays;

    // CANTITATEA TOTALĂ CUMULATIVĂ = rata zilnică × zile totale noi
    const cumulativeQuantity = dailyRate * totalNewDays;

    // Round la 3 zecimale
    const rounded = Math.round(cumulativeQuantity * 1000) / 1000;

    console.log(`📊 CUMULATIVE Proportional Quantity Calculation:
      Original Contract: ${originalStartDate} → ${originalEndDate} (${originalDays} days, ${qty}t)
      Daily Rate: ${dailyRate.toFixed(4)} t/day
      New Extended Period: ${originalStartDate} → ${newEndDate} (${totalNewDays} days)
      Extension Factor: ${(totalNewDays / originalDays).toFixed(2)}x
      TOTAL CUMULATIVE Quantity: ${rounded}t (was ${qty}t originally)
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
 * @param {string|number} contractId - Contract ID
 * @param {string} quantityField - Name of quantity field
 *
 * @returns {Object|null} - { contract_date_start, contract_date_end, quantity } or null
 */
export const getContractDataForProportional = async (
  pool,
  tableName,
  contractId,
  quantityField = 'estimated_quantity_tons'
) => {
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
 * Get the last extension end date from existing amendments
 * Used for reference but NOT for calculation (we always calculate from original dates)
 *
 * @param {Object} pool - Database pool
 * @param {string} amendmentsTableName - Amendments table name
 * @param {string|number} contractId - Contract ID
 *
 * @returns {string|null} - Last extension end date (YYYY-MM-DD) or null
 */
export const getLastExtensionEndDate = async (pool, amendmentsTableName, contractId) => {
  try {
    const query = `
      SELECT new_contract_date_end
      FROM ${amendmentsTableName}
      WHERE contract_id = $1
        AND deleted_at IS NULL
        AND (amendment_type = 'EXTENSION' OR amendment_type = 'PRELUNGIRE')
        AND new_contract_date_end IS NOT NULL
      ORDER BY new_contract_date_end DESC
      LIMIT 1
    `;

    const result = await pool.query(query, [contractId]);

    if (result.rows.length === 0) {
      return null;
    }

    return result.rows[0].new_contract_date_end;
  } catch (error) {
    console.error('getLastExtensionEndDate error:', error);
    return null;
  }
};

export default {
  calculateProportionalQuantity,
  getContractDataForProportional,
  getLastExtensionEndDate,
};
