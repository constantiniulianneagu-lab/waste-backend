// src/utils/proportionalQuantity.js
/**
 * ============================================================================
 * PROPORTIONAL QUANTITY CALCULATION FOR CONTRACT AMENDMENTS
 * ============================================================================
 * Când se prelungește un contract (EXTENSION / PRELUNGIRE), cantitatea se
 * calculează automat proporțional cu perioada de prelungire.
 *
 * Formula: new_quantity = (original_quantity / total_days_original) × extension_days
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
 * @param {string} params.amendmentType - Tipul actului adițional (EXTENSION/PRELUNGIRE)
 * @param {string} [params.lastExtensionEndDate] - Data ultimei prelungiri (opțional)
 *
 * @returns {number|null} - Cantitatea calculată proporțional sau null dacă nu e EXTENSION/PRELUNGIRE
 */
export const calculateProportionalQuantity = ({
  originalStartDate,
  originalEndDate,
  newEndDate,
  originalQuantity,
  amendmentType,
  lastExtensionEndDate = null,
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

    // Determină data de la care începe prelungirea
    let extensionStartDate = endDate;
    if (lastExtensionEndDate) {
      const lastExtension = new Date(lastExtensionEndDate);
      if (!Number.isNaN(lastExtension.getTime()) && lastExtension > endDate) {
        extensionStartDate = lastExtension;
      }
    }

    // newEnd trebuie să fie după începutul prelungirii
    if (newEnd <= extensionStartDate) {
      console.warn(
        `calculateProportionalQuantity: New end date (${newEndDate}) must be after extension start (${extensionStartDate
          .toISOString()
          .split('T')[0]})`
      );
      return null;
    }

    const MS_PER_DAY = 1000 * 60 * 60 * 24;

    // totalDays = perioada ORIGINALĂ (rate zilnic constant)
    const totalDays = Math.round((endDate - startDate) / MS_PER_DAY);

    // extensionDays = zile de la ultima prelungire (sau sfârșit original) până la noua dată
    const extensionDays = Math.round((newEnd - extensionStartDate) / MS_PER_DAY);

    if (totalDays <= 0 || extensionDays <= 0) {
      console.error('calculateProportionalQuantity: Invalid days calculation');
      return null;
    }

    const dailyRate = qty / totalDays;
    const proportionalQuantity = dailyRate * extensionDays;

    // Round la 3 zecimale
    const rounded = Math.round(proportionalQuantity * 1000) / 1000;

    console.log(`📊 Proportional Quantity Calculation:
      Original Period: ${originalStartDate} → ${originalEndDate} (${totalDays} days, ${qty}t)
      Daily Rate: ${dailyRate.toFixed(4)} t/day
      Extension Start: ${extensionStartDate.toISOString().split('T')[0]}
      Extension End: ${newEndDate}
      Extension Days: ${extensionDays} days
      Proportional Quantity: ${rounded}t
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
 * Used to calculate proportional quantity for multiple extensions
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
