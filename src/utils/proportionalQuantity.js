// src/utils/proportionalQuantity.js
/**
 * ============================================================================
 * PROPORTIONAL QUANTITY CALCULATION FOR CONTRACT AMENDMENTS
 * ============================================================================
 * PRELUNGIRE: returnează cantitatea DOAR pentru perioada nouă adăugată
 *   (originalEnd+1 → newEnd), bazată pe rata zilnică din cantitatea anuală
 * INCETARE: returnează cantitatea REDUSĂ pentru perioada scurtată
 *   (start → newEnd)
 * 
 * effective_quantity în SQL = cant_originala + SUM(cantități din amendamente)
 * ============================================================================
 */

/**
 * Calculate proportional quantity for PRELUNGIRE (cumulative) or INCETARE (shortened)
 *
 * @param {Object} params
 * @param {string} params.originalStartDate
 * @param {string} params.originalEndDate
 * @param {string} params.newEndDate
 * @param {number} params.originalQuantity
 * @param {string} params.amendmentType - PRELUNGIRE/EXTENSION or INCETARE/TERMINATION
 *
 * @returns {number|null}
 */
export const calculateProportionalQuantity = ({
  originalStartDate,
  originalEndDate,
  newEndDate,
  originalQuantity,
  amendmentType,
}) => {
  const isExtension = amendmentType === 'EXTENSION' || amendmentType === 'PRELUNGIRE';
  const isTermination = amendmentType === 'TERMINATION' || amendmentType === 'INCETARE';

  if (!isExtension && !isTermination) return null;

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

    // PRELUNGIRE: newEnd trebuie să fie DUPĂ originalEnd
    if (isExtension && newEnd <= endDate) {
      console.warn(`calculateProportionalQuantity: For PRELUNGIRE, new end (${newEndDate}) must be after original end (${originalEndDate})`);
      return null;
    }

    // INCETARE: newEnd trebuie să fie ÎNAINTE de originalEnd
    if (isTermination && newEnd >= endDate) {
      console.warn(`calculateProportionalQuantity: For INCETARE, new end (${newEndDate}) must be before original end (${originalEndDate})`);
      return null;
    }

    const MS_PER_DAY = 1000 * 60 * 60 * 24;

    // Rata zilnică bazată pe cantitatea originală și zilele perioadei originale
    const originalDays = Math.round((endDate - startDate) / MS_PER_DAY) + 1;

    if (originalDays <= 0) {
      console.error('calculateProportionalQuantity: Invalid days calculation');
      return null;
    }

    const dailyRate = qty / originalDays;

    let rounded;

    if (isExtension) {
      // PRELUNGIRE: cantitatea DOAR pentru perioada nouă (originalEnd+1 → newEnd)
      const newPeriodDays = Math.round((newEnd - endDate) / MS_PER_DAY);
      rounded = Math.round(dailyRate * newPeriodDays * 1000) / 1000;
      console.log(`📊 PRELUNGIRE Proportional:
        Original: ${originalStartDate} → ${originalEndDate} (${originalDays} zile, ${qty}t)
        Perioadă nouă: ${originalEndDate} → ${newEndDate} (${newPeriodDays} zile)
        Rate: ${dailyRate.toFixed(4)} t/zi → CANTITATE NOUĂ: ${rounded}t`);
    } else {
      // INCETARE: cantitatea REDUSĂ pentru perioada scurtată (start → newEnd)
      const shortenedDays = Math.round((newEnd - startDate) / MS_PER_DAY) + 1;
      rounded = Math.round(dailyRate * shortenedDays * 1000) / 1000;
      console.log(`📊 INCETARE Proportional:
        Original: ${originalStartDate} → ${originalEndDate} (${originalDays} zile, ${qty}t)
        Încetare la: ${newEndDate} (${shortenedDays} zile efectiv)
        Rate: ${dailyRate.toFixed(4)} t/zi → CANTITATE REDUSĂ: ${rounded}t`);
    }

    return rounded;
  } catch (error) {
    console.error('calculateProportionalQuantity error:', error);
    return null;
  }
};

/**
 * Helper function to get contract dates and quantity from database
 */
export const getContractDataForProportional = async (
  pool,
  tableName,
  contractId,
  quantityField = 'estimated_quantity_tons'
) => {
  try {
    // Derivăm amendment table name din contract table name
    // e.g. tmb_contracts → tmb_contract_amendments
    const amendmentTable = tableName.replace(/_contracts$/, '_contract_amendments');

    const query = `
      SELECT
        c.contract_date_start,
        c.contract_date_end,
        c.${quantityField} as quantity,
        -- Effective end date: ultima prelungire din amendamente
        COALESCE(
          (SELECT a.new_contract_date_end
           FROM ${amendmentTable} a
           WHERE a.contract_id = c.id
             AND a.deleted_at IS NULL
             AND a.new_contract_date_end IS NOT NULL
             AND a.amendment_type NOT IN ('AUTO_TERMINATION', 'INCETARE', 'TERMINATION')
           ORDER BY COALESCE(a.effective_date, a.amendment_date) DESC, a.id DESC
           LIMIT 1),
          c.contract_date_end
        ) as effective_date_end,
        -- Effective quantity: ultima cantitate modificată
        COALESCE(
          (SELECT a.new_${quantityField}
           FROM ${amendmentTable} a
           WHERE a.contract_id = c.id
             AND a.deleted_at IS NULL
             AND a.new_${quantityField} IS NOT NULL
             AND a.amendment_type NOT IN ('AUTO_TERMINATION', 'INCETARE', 'TERMINATION')
           ORDER BY COALESCE(a.effective_date, a.amendment_date) DESC, a.id DESC
           LIMIT 1),
          c.${quantityField}
        ) as effective_quantity
      FROM ${tableName} c
      WHERE c.id = $1 AND c.deleted_at IS NULL
    `;

    const result = await pool.query(query, [contractId]);

    if (result.rows.length === 0) {
      console.error(`Contract not found: ${contractId} in ${tableName}`);
      return null;
    }

    const row = result.rows[0];
    return {
      contract_date_start: row.contract_date_start,
      contract_date_end: row.effective_date_end, // folosim effective pentru calcul
      quantity: row.effective_quantity,           // folosim effective quantity
    };
  } catch (error) {
    console.error('getContractDataForProportional error:', error);
    return null;
  }
};

/**
 * Get the last extension end date from existing amendments
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