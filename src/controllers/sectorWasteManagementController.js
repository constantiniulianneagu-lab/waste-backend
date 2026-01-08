// src/controllers/sectorWasteManagementController.js
/**
 * ============================================================================
 * SECTOR WASTE MANAGEMENT STATISTICS CONTROLLER
 * ============================================================================
 * Statistici complete per sector pentru:
 * - Colectare
 * - Sortare
 * - TMB (Tratare Mecano-Biologică)
 * - Depozitare
 * - Costuri totale și indicatori
 * ============================================================================
 */

import pool from '../config/database.js';

// ============================================================================
// HELPER: Format numbers to Romanian format
// ============================================================================
const formatNumberRO = (num) => {
  if (!num && num !== 0) return '0,00';
  return Number(num).toLocaleString('ro-RO', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
};

// ============================================================================
// HELPER: Parse sector number to UUID
// ============================================================================
const getSectorUUID = async (sectorNumber) => {
  const result = await pool.query(
    `SELECT id FROM sectors WHERE sector_number = $1 AND deleted_at IS NULL LIMIT 1`,
    [sectorNumber]
  );
  
  if (result.rows.length === 0) {
    throw new Error(`Sector ${sectorNumber} not found`);
  }
  
  return result.rows[0].id;
};

// ============================================================================
// HELPER: Build date range
// ============================================================================
const buildDateRange = (year, month) => {
  let start_date, end_date;
  
  if (month) {
    // Specific month
    const m = month.toString().padStart(2, '0');
    start_date = `${year}-${m}-01`;
    
    // Last day of month
    const lastDay = new Date(year, month, 0).getDate();
    end_date = `${year}-${m}-${lastDay}`;
  } else {
    // Entire year
    start_date = `${year}-01-01`;
    end_date = `${year}-12-31`;
  }
  
  return { start_date, end_date };
};

// ============================================================================
// 1. GET SECTOR INFO
// ============================================================================
const getSectorInfo = async (sectorUUID) => {
  const result = await pool.query(
    `SELECT 
      id,
      sector_number,
      sector_name,
      area_km2,
      population,
      description
    FROM sectors
    WHERE id = $1 AND deleted_at IS NULL`,
    [sectorUUID]
  );
  
  if (result.rows.length === 0) {
    throw new Error('Sector not found');
  }
  
  return result.rows[0];
};

// ============================================================================
// 2. CALCULATE COLLECTION (COLECTARE)
// ============================================================================
const calculateCollection = async (sectorUUID, start_date, end_date) => {
  // A. Total collected tons
  const tonsResult = await pool.query(
    `SELECT 
      COALESCE(SUM(net_weight_tons), 0) as total_tons
    FROM waste_tickets_landfill
    WHERE sector_id = $1
      AND ticket_date BETWEEN $2 AND $3
      AND deleted_at IS NULL`,
    [sectorUUID, start_date, end_date]
  );
  
  const total_tons = Number(tonsResult.rows[0].total_tons);
  
  // B. Operators (collectors)
  const operatorsResult = await pool.query(
    `SELECT 
      i.id,
      i.name,
      COALESCE(SUM(wl.net_weight_tons), 0) as tons_collected,
      ROUND(
        (COALESCE(SUM(wl.net_weight_tons), 0) / NULLIF($4, 0) * 100), 2
      ) as percentage
    FROM waste_tickets_landfill wl
    JOIN institutions i ON wl.supplier_id = i.id
    WHERE wl.sector_id = $1
      AND wl.ticket_date BETWEEN $2 AND $3
      AND wl.deleted_at IS NULL
    GROUP BY i.id, i.name
    ORDER BY tons_collected DESC`,
    [sectorUUID, start_date, end_date, total_tons || 1]
  );
  
  // C. Waste types
  const wasteTypesResult = await pool.query(
    `SELECT 
      wc.code as waste_code,
      wc.description as waste_description,
      COALESCE(SUM(wl.net_weight_tons), 0) as tons
    FROM waste_tickets_landfill wl
    JOIN waste_codes wc ON wl.waste_code_id = wc.id
    WHERE wl.sector_id = $1
      AND wl.ticket_date BETWEEN $2 AND $3
      AND wl.deleted_at IS NULL
    GROUP BY wc.code, wc.description
    ORDER BY tons DESC`,
    [sectorUUID, start_date, end_date]
  );
  
  // D. Get contract and cost
  // NOTE: waste_collector_contracts NU are tariff direct - e în waste_collector_contract_codes
  const contractResult = await pool.query(
    `SELECT 
      wc.id as contract_id,
      wc.contract_number,
      i.name as operator_name,
      COALESCE(AVG(wccc.tariff), 0) as avg_tariff
    FROM waste_collector_contracts wc
    JOIN institutions i ON wc.institution_id = i.id
    LEFT JOIN waste_collector_contract_codes wccc ON wccc.contract_id = wc.id AND wccc.deleted_at IS NULL
    WHERE wc.sector_id = $1
      AND wc.contract_date_start <= $3
      AND (wc.contract_date_end IS NULL OR wc.contract_date_end >= $2)
      AND wc.is_active = true
      AND wc.deleted_at IS NULL
    GROUP BY wc.id, wc.contract_number, i.name
    ORDER BY wc.contract_date_start DESC
    LIMIT 1`,
    [sectorUUID, start_date, end_date]
  );
  
  let tariff_per_ton = 0;
  let contract_info = null;
  let has_contract = false;
  
  if (contractResult.rows.length > 0) {
    has_contract = true;
    tariff_per_ton = Number(contractResult.rows[0].avg_tariff || 0);
    contract_info = {
      contract_number: contractResult.rows[0].contract_number,
      operator_name: contractResult.rows[0].operator_name,
      tariff_per_ton: tariff_per_ton
    };
  }
  
  const total_cost = total_tons * tariff_per_ton;
  const cost_per_ton = tariff_per_ton;
  
  return {
    total_tons,
    total_tons_formatted: formatNumberRO(total_tons),
    operators: operatorsResult.rows.map(op => ({
      ...op,
      tons_collected_formatted: formatNumberRO(op.tons_collected)
    })),
    waste_types: wasteTypesResult.rows.map(wt => ({
      ...wt,
      tons_formatted: formatNumberRO(wt.tons)
    })),
    has_contract,
    contract_info,
    cost: {
      tariff_per_ton,
      tariff_per_ton_formatted: formatNumberRO(tariff_per_ton),
      total_cost,
      total_cost_formatted: formatNumberRO(total_cost),
      cost_per_ton,
      cost_per_ton_formatted: formatNumberRO(cost_per_ton)
    }
  };
};

// ============================================================================
// 3. CALCULATE SORTING (SORTARE)
// ============================================================================
const calculateSorting = async (sectorUUID, start_date, end_date) => {
  // A. Total sent to sorting
  const tonsResult = await pool.query(
    `SELECT 
      COALESCE(SUM(delivered_quantity_tons), 0) as total_sent,
      COALESCE(SUM(accepted_quantity_tons), 0) as total_accepted
    FROM waste_tickets_recycling
    WHERE sector_id = $1
      AND ticket_date BETWEEN $2 AND $3
      AND deleted_at IS NULL`,
    [sectorUUID, start_date, end_date]
  );
  
  const total_sent = Number(tonsResult.rows[0].total_sent);
  const total_accepted = Number(tonsResult.rows[0].total_accepted);
  const total_residues = total_sent - total_accepted;
  const acceptance_rate = total_sent > 0 ? (total_accepted / total_sent * 100) : 0;
  
  // B. Operators
  const operatorsResult = await pool.query(
    `SELECT 
      i.id,
      i.name,
      COALESCE(SUM(wr.delivered_quantity_tons), 0) as tons_received,
      COALESCE(SUM(wr.accepted_quantity_tons), 0) as tons_accepted
    FROM waste_tickets_recycling wr
    JOIN institutions i ON wr.recipient_id = i.id
    WHERE wr.sector_id = $1
      AND wr.ticket_date BETWEEN $2 AND $3
      AND wr.deleted_at IS NULL
    GROUP BY i.id, i.name
    ORDER BY tons_received DESC`,
    [sectorUUID, start_date, end_date]
  );
  
  // C. Get contract and cost
  // TEMPORAR: Dezactivat pentru debug
  let tariff_per_ton = 0;
  let contract_info = null;
  let has_contract = false;
  
  const total_cost = total_sent * tariff_per_ton;
  const cost_per_ton = tariff_per_ton;
  
  return {
    total_sent,
    total_sent_formatted: formatNumberRO(total_sent),
    total_accepted,
    total_accepted_formatted: formatNumberRO(total_accepted),
    total_residues,
    total_residues_formatted: formatNumberRO(total_residues),
    acceptance_rate: Number(acceptance_rate.toFixed(2)),
    operators: operatorsResult.rows.map(op => ({
      ...op,
      tons_received_formatted: formatNumberRO(op.tons_received),
      tons_accepted_formatted: formatNumberRO(op.tons_accepted)
    })),
    has_contract,
    contract_info,
    cost: {
      tariff_per_ton,
      tariff_per_ton_formatted: formatNumberRO(tariff_per_ton),
      total_cost,
      total_cost_formatted: formatNumberRO(total_cost),
      cost_per_ton,
      cost_per_ton_formatted: formatNumberRO(cost_per_ton)
    }
  };
};

// ============================================================================
// 4. CALCULATE TMB
// ============================================================================
const calculateTMB = async (sectorUUID, start_date, end_date) => {
  // A. Total TMB input
  const inputResult = await pool.query(
    `SELECT 
      COALESCE(SUM(net_weight_tons), 0) as total_input
    FROM waste_tickets_tmb
    WHERE sector_id = $1
      AND ticket_date BETWEEN $2 AND $3
      AND deleted_at IS NULL`,
    [sectorUUID, start_date, end_date]
  );
  
  const total_input = Number(inputResult.rows[0].total_input);
  
  // B. Get TMB operator IDs for this sector
  const tmbOperatorsResult = await pool.query(
    `SELECT DISTINCT operator_id
    FROM waste_tickets_tmb
    WHERE sector_id = $1
      AND ticket_date BETWEEN $2 AND $3
      AND deleted_at IS NULL`,
    [sectorUUID, start_date, end_date]
  );
  
  const tmbOperatorIds = tmbOperatorsResult.rows.map(r => r.operator_id);
  
  // C. Outputs from TMB
  let output_recycling = 0;
  let output_recovery = 0;
  let output_disposal = 0;
  
  if (tmbOperatorIds.length > 0) {
    // Recycling
    const recyclingResult = await pool.query(
      `SELECT COALESCE(SUM(delivered_quantity_tons), 0) as tons
      FROM waste_tickets_recycling
      WHERE sector_id = $1
        AND ticket_date BETWEEN $2 AND $3
        AND supplier_id = ANY($4)
        AND deleted_at IS NULL`,
      [sectorUUID, start_date, end_date, tmbOperatorIds]
    );
    output_recycling = Number(recyclingResult.rows[0].tons);
    
    // Recovery
    const recoveryResult = await pool.query(
      `SELECT COALESCE(SUM(delivered_quantity_tons), 0) as tons
      FROM waste_tickets_recovery
      WHERE sector_id = $1
        AND ticket_date BETWEEN $2 AND $3
        AND supplier_id = ANY($4)
        AND deleted_at IS NULL`,
      [sectorUUID, start_date, end_date, tmbOperatorIds]
    );
    output_recovery = Number(recoveryResult.rows[0].tons);
    
    // Disposal
    const disposalResult = await pool.query(
      `SELECT COALESCE(SUM(delivered_quantity_tons), 0) as tons
      FROM waste_tickets_disposal
      WHERE sector_id = $1
        AND ticket_date BETWEEN $2 AND $3
        AND supplier_id = ANY($4)
        AND deleted_at IS NULL`,
      [sectorUUID, start_date, end_date, tmbOperatorIds]
    );
    output_disposal = Number(disposalResult.rows[0].tons);
  }
  
  const output_stock = total_input - (output_recycling + output_recovery + output_disposal);
  
  // D. TMB stations (operators)
  const stationsResult = await pool.query(
    `SELECT 
      i.id,
      i.name,
      COALESCE(SUM(wt.net_weight_tons), 0) as tons_processed
    FROM waste_tickets_tmb wt
    JOIN institutions i ON wt.operator_id = i.id
    WHERE wt.sector_id = $1
      AND wt.ticket_date BETWEEN $2 AND $3
      AND wt.deleted_at IS NULL
    GROUP BY i.id, i.name
    ORDER BY tons_processed DESC`,
    [sectorUUID, start_date, end_date]
  );
  
  // E. Get contract and cost
  // TEMPORAR: Dezactivat pentru debug
  let tariff_per_ton = 0;
  let contract_info = null;
  let has_contract = false;
  
  const total_cost = total_input * tariff_per_ton;
  const cost_per_ton = tariff_per_ton;
  
  // Calculate percentages
  const recycling_pct = total_input > 0 ? (output_recycling / total_input * 100) : 0;
  const recovery_pct = total_input > 0 ? (output_recovery / total_input * 100) : 0;
  const disposal_pct = total_input > 0 ? (output_disposal / total_input * 100) : 0;
  const stock_pct = total_input > 0 ? (output_stock / total_input * 100) : 0;
  
  return {
    total_input,
    total_input_formatted: formatNumberRO(total_input),
    outputs: {
      recycling: {
        tons: output_recycling,
        tons_formatted: formatNumberRO(output_recycling),
        percentage: Number(recycling_pct.toFixed(1))
      },
      recovery: {
        tons: output_recovery,
        tons_formatted: formatNumberRO(output_recovery),
        percentage: Number(recovery_pct.toFixed(1))
      },
      disposal: {
        tons: output_disposal,
        tons_formatted: formatNumberRO(output_disposal),
        percentage: Number(disposal_pct.toFixed(1))
      },
      stock: {
        tons: output_stock,
        tons_formatted: formatNumberRO(output_stock),
        percentage: Number(stock_pct.toFixed(1))
      }
    },
    stations: stationsResult.rows.map(st => ({
      ...st,
      tons_processed_formatted: formatNumberRO(st.tons_processed)
    })),
    has_contract,
    contract_info,
    cost: {
      tariff_per_ton,
      tariff_per_ton_formatted: formatNumberRO(tariff_per_ton),
      total_cost,
      total_cost_formatted: formatNumberRO(total_cost),
      cost_per_ton,
      cost_per_ton_formatted: formatNumberRO(cost_per_ton)
    }
  };
};

// ============================================================================
// 5. CALCULATE DISPOSAL (DEPOZITARE)
// ============================================================================
const calculateDisposal = async (sectorUUID, start_date, end_date) => {
  // A. Direct to landfill
  const landfillDirectResult = await pool.query(
    `SELECT COALESCE(SUM(net_weight_tons), 0) as tons
    FROM waste_tickets_landfill
    WHERE sector_id = $1
      AND ticket_date BETWEEN $2 AND $3
      AND deleted_at IS NULL`,
    [sectorUUID, start_date, end_date]
  );
  
  const landfill_direct = Number(landfillDirectResult.rows[0].tons);
  
  // B. From TMB (via disposal tickets)
  const tmbOperatorsResult = await pool.query(
    `SELECT DISTINCT operator_id
    FROM waste_tickets_tmb
    WHERE sector_id = $1
      AND ticket_date BETWEEN $2 AND $3
      AND deleted_at IS NULL`,
    [sectorUUID, start_date, end_date]
  );
  
  const tmbOperatorIds = tmbOperatorsResult.rows.map(r => r.operator_id);
  
  let landfill_from_tmb = 0;
  
  if (tmbOperatorIds.length > 0) {
    const disposalFromTmbResult = await pool.query(
      `SELECT COALESCE(SUM(delivered_quantity_tons), 0) as tons
      FROM waste_tickets_disposal
      WHERE sector_id = $1
        AND ticket_date BETWEEN $2 AND $3
        AND supplier_id = ANY($4)
        AND deleted_at IS NULL`,
      [sectorUUID, start_date, end_date, tmbOperatorIds]
    );
    landfill_from_tmb = Number(disposalFromTmbResult.rows[0].tons);
  }
  
  const total_disposal = landfill_direct + landfill_from_tmb;
  const direct_pct = total_disposal > 0 ? (landfill_direct / total_disposal * 100) : 0;
  const from_tmb_pct = total_disposal > 0 ? (landfill_from_tmb / total_disposal * 100) : 0;
  
  // C. Disposal facilities
  const facilitiesResult = await pool.query(
    `SELECT 
      i.id,
      i.name,
      COALESCE(SUM(wd.delivered_quantity_tons), 0) as tons
    FROM waste_tickets_disposal wd
    JOIN institutions i ON wd.recipient_id = i.id
    WHERE wd.sector_id = $1
      AND wd.ticket_date BETWEEN $2 AND $3
      AND wd.deleted_at IS NULL
    GROUP BY i.id, i.name
    ORDER BY tons DESC`,
    [sectorUUID, start_date, end_date]
  );
  
  // D. Waste types
  const wasteTypesResult = await pool.query(
    `SELECT 
      wc.code as waste_code,
      wc.description as waste_description,
      COALESCE(SUM(wl.net_weight_tons), 0) as tons
    FROM waste_tickets_landfill wl
    JOIN waste_codes wc ON wl.waste_code_id = wc.id
    WHERE wl.sector_id = $1
      AND wl.ticket_date BETWEEN $2 AND $3
      AND wl.deleted_at IS NULL
    GROUP BY wc.code, wc.description
    
    UNION ALL
    
    SELECT 
      wc.code as waste_code,
      wc.description as waste_description,
      COALESCE(SUM(wd.delivered_quantity_tons), 0) as tons
    FROM waste_tickets_disposal wd
    JOIN waste_codes wc ON wd.waste_code_id = wc.id
    WHERE wd.sector_id = $1
      AND wd.ticket_date BETWEEN $2 AND $3
      AND wd.deleted_at IS NULL
    GROUP BY wc.code, wc.description
    
    ORDER BY tons DESC`,
    [sectorUUID, start_date, end_date]
  );
  
  // E. Get contract and cost
  // TEMPORAR: Dezactivat pentru debug - schema DB necunoscută
  let tariff_per_ton = 0;
  let cec_tax_per_ton = 0;
  let total_per_ton = 0;
  let contract_info = null;
  let has_contract = false;
  
  // TODO: Re-enable când știm schema exactă
  /*
  const contractResult = await pool.query(
    `SELECT 
      dc.id as contract_id,
      dc.contract_number,
      dcs.tariff,
      dcs.cec,
      (COALESCE(dcs.tariff, 0) + COALESCE(dcs.cec, 0)) as total_per_ton
    FROM disposal_contract_sectors dcs
    JOIN disposal_contracts dc ON dcs.contract_id = dc.id
    WHERE dcs.sector_id = $1
      AND dc.contract_date_start <= $3
      AND (dc.contract_date_end IS NULL OR dc.contract_date_end >= $2)
      AND dc.is_active = true
      AND dc.deleted_at IS NULL
      AND dcs.deleted_at IS NULL
    ORDER BY dc.contract_date_start DESC
    LIMIT 1`,
    [sectorUUID, start_date, end_date]
  );
  
  if (contractResult.rows.length > 0) {
    has_contract = true;
    tariff_per_ton = Number(contractResult.rows[0].tariff || 0);
    cec_tax_per_ton = Number(contractResult.rows[0].cec || 0);
    total_per_ton = Number(contractResult.rows[0].total_per_ton || 0);
    contract_info = {
      contract_number: contractResult.rows[0].contract_number,
      tariff_per_ton: tariff_per_ton,
      cec_tax_per_ton: cec_tax_per_ton,
      total_per_ton: total_per_ton
    };
  }
  */
  
  const total_cost = total_disposal * total_per_ton;
  const cost_per_ton = total_per_ton;
  
  return {
    total_disposal,
    total_disposal_formatted: formatNumberRO(total_disposal),
    landfill_direct,
    landfill_direct_formatted: formatNumberRO(landfill_direct),
    landfill_direct_pct: Number(direct_pct.toFixed(1)),
    landfill_from_tmb,
    landfill_from_tmb_formatted: formatNumberRO(landfill_from_tmb),
    landfill_from_tmb_pct: Number(from_tmb_pct.toFixed(1)),
    facilities: facilitiesResult.rows.map(f => ({
      ...f,
      tons_formatted: formatNumberRO(f.tons)
    })),
    waste_types: wasteTypesResult.rows.map(wt => ({
      ...wt,
      tons_formatted: formatNumberRO(wt.tons)
    })),
    has_contract,
    contract_info,
    cost: {
      tariff_per_ton,
      tariff_per_ton_formatted: formatNumberRO(tariff_per_ton),
      cec_tax_per_ton,
      cec_tax_per_ton_formatted: formatNumberRO(cec_tax_per_ton),
      total_per_ton,
      total_per_ton_formatted: formatNumberRO(total_per_ton),
      total_cost,
      total_cost_formatted: formatNumberRO(total_cost),
      cost_per_ton,
      cost_per_ton_formatted: formatNumberRO(cost_per_ton)
    }
  };
};

// ============================================================================
// 6. CALCULATE TOTALS AND INDICATORS
// ============================================================================
const calculateTotals = (collection, sorting, tmb, disposal, population) => {
  const cost_collection = collection.cost.total_cost;
  const cost_sorting = sorting.cost.total_cost;
  const cost_tmb = tmb.cost.total_cost;
  const cost_disposal = disposal.cost.total_cost;
  
  const total_chain_cost = cost_collection + cost_sorting + cost_tmb + cost_disposal;
  
  // Total tons processed (collected initially)
  const total_tons_processed = collection.total_tons;
  
  const cost_per_ton_chain = total_tons_processed > 0 
    ? total_chain_cost / total_tons_processed 
    : 0;
  
  const cost_per_capita_year = population > 0 
    ? total_chain_cost / population 
    : 0;
  
  // Calculate percentages per component
  const collection_pct = total_chain_cost > 0 ? (cost_collection / total_chain_cost * 100) : 0;
  const sorting_pct = total_chain_cost > 0 ? (cost_sorting / total_chain_cost * 100) : 0;
  const tmb_pct = total_chain_cost > 0 ? (cost_tmb / total_chain_cost * 100) : 0;
  const disposal_pct = total_chain_cost > 0 ? (cost_disposal / total_chain_cost * 100) : 0;
  
  // Calculate efficiency indicators
  const recycling_efficiency = total_tons_processed > 0 
    ? (tmb.outputs.recycling.tons / total_tons_processed * 100) 
    : 0;
  
  const recovery_efficiency = total_tons_processed > 0 
    ? (tmb.outputs.recovery.tons / total_tons_processed * 100) 
    : 0;
  
  const disposal_rate = total_tons_processed > 0 
    ? (disposal.total_disposal / total_tons_processed * 100) 
    : 0;
  
  return {
    total_chain_cost,
    total_chain_cost_formatted: formatNumberRO(total_chain_cost),
    
    costs_breakdown: {
      collection: {
        cost: cost_collection,
        cost_formatted: formatNumberRO(cost_collection),
        percentage: Number(collection_pct.toFixed(1))
      },
      sorting: {
        cost: cost_sorting,
        cost_formatted: formatNumberRO(cost_sorting),
        percentage: Number(sorting_pct.toFixed(1))
      },
      tmb: {
        cost: cost_tmb,
        cost_formatted: formatNumberRO(cost_tmb),
        percentage: Number(tmb_pct.toFixed(1))
      },
      disposal: {
        cost: cost_disposal,
        cost_formatted: formatNumberRO(cost_disposal),
        percentage: Number(disposal_pct.toFixed(1))
      }
    },
    
    indicators: {
      cost_per_ton_chain,
      cost_per_ton_chain_formatted: formatNumberRO(cost_per_ton_chain),
      cost_per_capita_year,
      cost_per_capita_year_formatted: formatNumberRO(cost_per_capita_year),
      total_tons_processed,
      total_tons_processed_formatted: formatNumberRO(total_tons_processed),
      recycling_efficiency: Number(recycling_efficiency.toFixed(1)),
      recovery_efficiency: Number(recovery_efficiency.toFixed(1)),
      disposal_rate: Number(disposal_rate.toFixed(1))
    }
  };
};

// ============================================================================
// MAIN ENDPOINT: GET SECTOR WASTE MANAGEMENT STATS
// ============================================================================
export const getSectorWasteManagementStats = async (req, res) => {
  try {
    // Check permissions
    const { scopes } = req.userAccess;
    if (scopes?.sectors === 'NONE') {
      return res.status(403).json({ 
        success: false, 
        message: 'Nu aveți permisiune să accesați statisticile sectorului' 
      });
    }

    const { sector_number } = req.params;
    const { year = new Date().getFullYear(), month } = req.query;
    
    console.log(`📊 Fetching waste management stats for Sector ${sector_number}, year=${year}, month=${month || 'all'}`);
    
    // 1. Get sector UUID
    const sectorUUID = await getSectorUUID(Number(sector_number));
    
    // 2. Build date range
    const { start_date, end_date } = buildDateRange(Number(year), month ? Number(month) : null);
    
    // 3. Get sector info
    const sector_info = await getSectorInfo(sectorUUID);
    
    // 4. Calculate each component
    const collection = await calculateCollection(sectorUUID, start_date, end_date);
    const sorting = await calculateSorting(sectorUUID, start_date, end_date);
    const tmb = await calculateTMB(sectorUUID, start_date, end_date);
    const disposal = await calculateDisposal(sectorUUID, start_date, end_date);
    
    // 5. Calculate totals
    const totals = calculateTotals(
      collection, 
      sorting, 
      tmb, 
      disposal, 
      sector_info.population || 0
    );
    
    // 6. Return response
    res.json({
      success: true,
      data: {
        sector_info,
        collection,
        sorting,
        tmb,
        disposal,
        totals,
        filters_applied: {
          year: Number(year),
          month: month ? Number(month) : null,
          start_date,
          end_date
        }
      }
    });
    
  } catch (error) {
    console.error('❌ Error fetching sector waste management stats:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la obținerea statisticilor sectorului',
      error: error.message
    });
  }
};

// ============================================================================
// ENDPOINT: GET ALL SECTORS OVERVIEW
// ============================================================================
export const getAllSectorsOverview = async (req, res) => {
  try {
    // Check permissions
    const { scopes } = req.userAccess;
    if (scopes?.sectors === 'NONE') {
      return res.status(403).json({ 
        success: false, 
        message: 'Nu aveți permisiune să accesați statisticile sectorului' 
      });
    }

    const { year = new Date().getFullYear() } = req.query;
    
    console.log(`📊 Fetching overview for all sectors, year=${year}`);
    
    const { start_date, end_date } = buildDateRange(Number(year), null);
    
    // Get all 6 sectors
    const sectorsResult = await pool.query(
      `SELECT id, sector_number, sector_name, area_km2, population
      FROM sectors
      WHERE deleted_at IS NULL
      ORDER BY sector_number`
    );
    
    const sectors = [];
    
    for (const sector of sectorsResult.rows) {
      // Quick stats for each sector
      const collection = await calculateCollection(sector.id, start_date, end_date);
      const sorting = await calculateSorting(sector.id, start_date, end_date);
      const tmb = await calculateTMB(sector.id, start_date, end_date);
      const disposal = await calculateDisposal(sector.id, start_date, end_date);
      
      const totals = calculateTotals(
        collection,
        sorting,
        tmb,
        disposal,
        sector.population || 0
      );
      
      sectors.push({
        sector_number: sector.sector_number,
        sector_name: sector.sector_name,
        area_km2: sector.area_km2,
        population: sector.population,
        total_cost: totals.total_chain_cost,
        total_cost_formatted: totals.total_chain_cost_formatted,
        cost_per_ton: totals.indicators.cost_per_ton_chain,
        cost_per_ton_formatted: totals.indicators.cost_per_ton_chain_formatted,
        cost_per_capita: totals.indicators.cost_per_capita_year,
        cost_per_capita_formatted: totals.indicators.cost_per_capita_year_formatted,
        total_tons: totals.indicators.total_tons_processed,
        total_tons_formatted: totals.indicators.total_tons_processed_formatted
      });
    }
    
    res.json({
      success: true,
      data: {
        sectors,
        filters_applied: {
          year: Number(year),
          start_date,
          end_date
        }
      }
    });
    
  } catch (error) {
    console.error('❌ Error fetching all sectors overview:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare la obținerea panoramei sectorului',
      error: error.message
    });
  }
};