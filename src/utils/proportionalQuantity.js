// src/utils/proportionalQuantity.js
/**
 * ============================================================================
 * PROPORTIONAL QUANTITY CALCULATION FOR CONTRACT AMENDMENTS
 * ============================================================================
 * PRELUNGIRE (extensie): newEnd > originalEnd → cantitate CUMULATIVĂ totală
 * INCETARE (încetare): newEnd < originalEnd → cantitate PROPORȚIONALĂ scurtată
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

    // Perioada ORIGINALĂ (contract inițial) - baza de calcul pentru rata zilnică
    const originalDays = Math.round((endDate - startDate) / MS_PER_DAY);

    // Noua perioadă totală (de la start la newEnd)
    const totalNewDays = Math.round((newEnd - startDate) / MS_PER_DAY);

    if (originalDays <= 0 || totalNewDays <= 0) {
      console.error('calculateProportionalQuantity: Invalid days calculation');
      return null;
    }

    // Rata zilnică bazată pe contractul ORIGINAL
    const dailyRate = qty / originalDays;

    // Cantitatea TOTALĂ pentru noua perioadă
    const newQuantity = dailyRate * totalNewDays;

    const rounded = Math.round(newQuantity * 1000) / 1000;

    if (isExtension) {
      console.log(`📊 PRELUNGIRE Proportional:
        Original: ${originalStartDate} → ${originalEndDate} (${originalDays} zile, ${qty}t)
        Extins până: ${newEndDate} (${totalNewDays} zile total)
        Rate: ${dailyRate.toFixed(4)} t/zi → TOTAL CUMULATIV: ${rounded}t`);
    } else {
      console.log(`📊 INCETARE Proportional:
        Original: ${originalStartDate} → ${originalEndDate} (${originalDays} zile, ${qty}t)
        Încetare la: ${newEndDate} (${totalNewDays} zile efectiv)
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