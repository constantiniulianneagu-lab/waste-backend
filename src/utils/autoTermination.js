// src/utils/autoTermination.js
/**
 * ============================================================================
 * AUTO-TERMINATION
 * ============================================================================
 * Cerință:
 *  - Contractul (tabela *_contracts) rămâne „bază / inițial”.
 *  - Orice modificare (inclusiv încetare automată) se face prin *_amendments.
 *  - Când un contract nou începe prestarea (service_start_date) pe același sector
 *    și același tip de contract, se creează automat un act adițional
 *    AUTO_TERMINATION pe contractul vechi, cu:
 *      - new_contract_date_end = (service_start_date - 1 zi)
 *      - new_estimated_quantity_tons (unde are sens) recalculat proporțional
 *      - quantity_adjustment_auto = delta (new - old)
 *    IMPORTANT: nu actualizăm direct contractul vechi în tabela de contracte.
 */

import pool from '../config/database.js';

// ---------------------------------------------------------------------------
// Date helpers (date-only, fără timezone/off-by-one)
// ---------------------------------------------------------------------------

const isDateOnly = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

const toUtcDate = (dateLike) => {
  if (!dateLike) return null;
  if (isDateOnly(dateLike)) {
    const [y, m, d] = dateLike.split('-').map((x) => parseInt(x, 10));
    return new Date(Date.UTC(y, m - 1, d));
  }
  const d = new Date(dateLike);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
};

const toDateOnlyStr = (dateLike) => {
  const d = toUtcDate(dateLike);
  if (!d) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
};

const addDays = (dateLike, days) => {
  const d = toUtcDate(dateLike);
  if (!d) return null;
  d.setUTCDate(d.getUTCDate() + days);
  return d;
};

const daysBetweenInclusive = (startDateLike, endDateLike) => {
  const s = toUtcDate(startDateLike);
  const e = toUtcDate(endDateLike);
  if (!s || !e) return null;
  const diffMs = e.getTime() - s.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return diffDays + 1; // inclusiv capetele
};

// ---------------------------------------------------------------------------
// Quantity helpers
// ---------------------------------------------------------------------------

const round2 = (n) => {
  if (n === null || n === undefined) return null;
  return Math.round(Number(n) * 100) / 100;
};

const calculateProportionalQuantity = ({
  originalQuantity,
  originalStartDate,
  originalEndDate,
  newEndDate,
}) => {
  if (originalQuantity === null || originalQuantity === undefined) return null;
  if (!originalStartDate || !originalEndDate || !newEndDate) return null;

  const totalDays = daysBetweenInclusive(originalStartDate, originalEndDate);
  const actualDays = daysBetweenInclusive(originalStartDate, newEndDate);
  if (!totalDays || !actualDays || totalDays <= 0) return round2(originalQuantity);

  const tonsPerDay = Number(originalQuantity) / Number(totalDays);
  return round2(tonsPerDay * Number(actualDays));
};

// ---------------------------------------------------------------------------
// Amendment numbering (AUTO-1, AUTO-2 ...)
// ---------------------------------------------------------------------------

const generateAmendmentNumber = async (client, contractId, amendmentTable) => {
  const q = `SELECT COUNT(*)::int AS count FROM ${amendmentTable} WHERE contract_id = $1 AND deleted_at IS NULL`;
  const r = await client.query(q, [contractId]);
  const count = (r.rows?.[0]?.count ?? 0) + 1;
  return `AUTO-${count}`;
};

// ---------------------------------------------------------------------------
// Core: simple contracts (sector_id direct)
// ---------------------------------------------------------------------------

const SIMPLE_CONFIG = {
  AEROBIC: {
    contractTable: 'aerobic_contracts',
    amendmentTable: 'aerobic_contract_amendments',
    qtyCol: 'estimated_quantity_tons',
    typeLabel: 'aerob',
  },
  ANAEROBIC: {
    contractTable: 'anaerobic_contracts',
    amendmentTable: 'anaerobic_contract_amendments',
    qtyCol: 'estimated_quantity_tons',
    typeLabel: 'anaerob',
  },
  TMB: {
    contractTable: 'tmb_contracts',
    amendmentTable: 'tmb_contract_amendments',
    qtyCol: 'estimated_quantity_tons',
    typeLabel: 'TMB',
  },
  SORTING: {
    contractTable: 'sorting_operator_contracts',
    amendmentTable: 'sorting_operator_contract_amendments',
    qtyCol: 'estimated_quantity_tons',
    typeLabel: 'sortare',
  },
  WASTE_COLLECTOR: {
    contractTable: 'waste_collector_contracts',
    amendmentTable: 'waste_collector_contract_amendments',
    qtyCol: null, // cantitățile sunt în waste_collector_contract_codes
    typeLabel: 'colectare',
  },
};

/**
 * Auto-termination pentru contracte cu sector_id direct.
 */
export const autoTerminateSimpleContracts = async ({
  contractType,
  sectorId,
  serviceStartDate,
  newContractId,
  newContractNumber,
  userId,
}) => {
  const config = SIMPLE_CONFIG[contractType];
  if (!config) throw new Error(`Tip contract invalid: ${contractType}`);
  if (!sectorId || !serviceStartDate || !newContractId) {
    return { success: true, terminated_contracts: [], count: 0 };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const serviceStartStr = toDateOnlyStr(serviceStartDate);
    const terminationStr = toDateOnlyStr(addDays(serviceStartDate, -1));

    // 1) contracte suprapuse pe același sector (indiferent de operator)
    const findQ = `
      SELECT
        id,
        contract_number,
        contract_date_start,
        contract_date_end,
        ${config.qtyCol ? config.qtyCol : 'NULL::numeric'} AS old_qty
      FROM ${config.contractTable}
      WHERE sector_id = $1
        AND id <> $2
        AND is_active = true
        AND deleted_at IS NULL
        AND contract_date_start <= $3
        AND (contract_date_end IS NULL OR contract_date_end >= $4)
    `;

    const overlapping = await client.query(findQ, [
      sectorId,
      newContractId,
      terminationStr,
      serviceStartStr,
    ]);

    const terminated = [];

    for (const oldContract of overlapping.rows) {
      // 2) dedup: dacă există deja auto-termination pentru aceeași pereche, skip
      const dedupQ = `
        SELECT 1
        FROM ${config.amendmentTable}
        WHERE contract_id = $1
          AND amendment_type = 'AUTO_TERMINATION'
          AND reference_contract_id = $2
          AND deleted_at IS NULL
        LIMIT 1
      `;
      const dedup = await client.query(dedupQ, [oldContract.id, newContractId]);
      if (dedup.rowCount > 0) continue;

      // 3) cantitate proporțională (doar unde avem qtyCol și contract_date_end existent)
      let newQty = null;
      if (config.qtyCol && oldContract.old_qty !== null && oldContract.contract_date_end) {
        newQty = calculateProportionalQuantity({
          originalQuantity: oldContract.old_qty,
          originalStartDate: oldContract.contract_date_start,
          originalEndDate: oldContract.contract_date_end,
          newEndDate: terminationStr,
        });
      }

      const qtyDelta =
        newQty !== null && oldContract.old_qty !== null
          ? round2(Number(newQty) - Number(oldContract.old_qty))
          : null;

      const amendmentNumber = await generateAmendmentNumber(
        client,
        oldContract.id,
        config.amendmentTable
      );

      // 4) creează amendment AUTO_TERMINATION
      const insertQ = `
        INSERT INTO ${config.amendmentTable} (
          contract_id,
          amendment_number,
          amendment_date,
          amendment_type,
          new_contract_date_end,
          new_estimated_quantity_tons,
          quantity_adjustment_auto,
          reference_contract_id,
          changes_description,
          notes,
          created_by
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11
        )
        RETURNING id
      `;

      await client.query(insertQ, [
        oldContract.id,
        amendmentNumber,
        terminationStr,
        'AUTO_TERMINATION',
        terminationStr,
        newQty,
        qtyDelta,
        newContractId,
        `Închidere automată la ${terminationStr}`,
        `Contract ${config.typeLabel} încheiat automat - preluat de contract ${newContractNumber}`,
        userId,
      ]);

      terminated.push({
        id: oldContract.id,
        contract_number: oldContract.contract_number,
        termination_date: terminationStr,
        new_estimated_quantity_tons: newQty,
        quantity_adjustment_auto: qtyDelta,
      });
    }

    await client.query('COMMIT');
    return { success: true, terminated_contracts: terminated, count: terminated.length };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ---------------------------------------------------------------------------
// Disposal: sector list prin disposal_contract_sectors
// ---------------------------------------------------------------------------

export const autoTerminateDisposalContracts = async ({
  sectorIds,
  serviceStartDate,
  newContractId,
  newContractNumber,
  userId,
}) => {
  if (!Array.isArray(sectorIds) || sectorIds.length === 0) {
    return { success: true, terminated_contracts: [], count: 0 };
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const serviceStartStr = toDateOnlyStr(serviceStartDate);
    const terminationStr = toDateOnlyStr(addDays(serviceStartDate, -1));

    const findQ = `
      SELECT DISTINCT
        dc.id,
        dc.contract_number,
        dc.contract_date_start,
        dc.contract_date_end
      FROM disposal_contracts dc
      JOIN disposal_contract_sectors dcs ON dc.id = dcs.contract_id
      WHERE dcs.sector_id = ANY($1::uuid[])
        AND dc.id <> $2
        AND dc.is_active = true
        AND dc.deleted_at IS NULL
        AND dcs.deleted_at IS NULL
        AND dc.contract_date_start <= $3
        AND (dc.contract_date_end IS NULL OR dc.contract_date_end >= $4)
    `;

    const overlapping = await client.query(findQ, [
      sectorIds,
      newContractId,
      terminationStr,
      serviceStartStr,
    ]);

    const terminated = [];

    for (const oldContract of overlapping.rows) {
      const dedupQ = `
        SELECT 1
        FROM disposal_contract_amendments
        WHERE contract_id = $1
          AND amendment_type = 'AUTO_TERMINATION'
          AND reference_contract_id = $2
          AND deleted_at IS NULL
        LIMIT 1
      `;
      const dedup = await client.query(dedupQ, [oldContract.id, newContractId]);
      if (dedup.rowCount > 0) continue;

      const amendmentNumber = await generateAmendmentNumber(
        client,
        oldContract.id,
        'disposal_contract_amendments'
      );

      const insertQ = `
        INSERT INTO disposal_contract_amendments (
          contract_id,
          amendment_number,
          amendment_date,
          amendment_type,
          new_contract_date_end,
          reference_contract_id,
          changes_description,
          notes,
          created_by
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        RETURNING id
      `;

      await client.query(insertQ, [
        oldContract.id,
        amendmentNumber,
        terminationStr,
        'AUTO_TERMINATION',
        terminationStr,
        newContractId,
        `Închidere automată la ${terminationStr}`,
        `Contract depozitare încheiat automat - preluat de contract ${newContractNumber}`,
        userId,
      ]);

      terminated.push({
        id: oldContract.id,
        contract_number: oldContract.contract_number,
        termination_date: terminationStr,
      });
    }

    await client.query('COMMIT');
    return { success: true, terminated_contracts: terminated, count: terminated.length };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};
