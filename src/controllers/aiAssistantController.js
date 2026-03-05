/**
 * ============================================================================
 * AI ASSISTANT CONTROLLER - SAMD
 * Schema corectă bazată pe structura reală a DB
 * ============================================================================
 */

import pool from '../config/database.js';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL = 'claude-sonnet-4-20250514';

const q = (sql, params) => pool.query(sql, params).then(r => r.rows).catch(e => {
  console.error('AI query error:', e.message, '|', sql.slice(0, 80));
  return [];
});
const sf = (col, f) => f ? `AND ${col} = ANY($1::uuid[])` : '';
const sp = (p) => p ? [p] : [];

// ============================================================================
// FETCH DATE COMPLETE
// ============================================================================
const fetchContextData = async (userRole, visibleSectorIds, accessLevel) => {
  const sectorFilter = accessLevel === 'SECTOR' && visibleSectorIds?.length > 0;
  const sectorParam = sectorFilter ? visibleSectorIds : null;
  const P = sp(sectorParam);

  const [
    dep_per_sector,
    dep_lunar_per_sector,
    dep_per_operator,
    dep_per_operator_lunar,
    dep_per_cod_deseu,
    dep_per_operator_cod,
    dep_generator_type,
    dep_operation_type,

    tmb_per_sector,
    tmb_lunar,
    tmb_per_operator,
    tmb_per_operator_lunar,
    tmb_per_cod_deseu,

    rec_per_sector,
    rec_lunar,
    rec_per_operator,
    rec_per_cod_deseu,

    recup_per_sector,
    recup_lunar,
    recup_per_operator,
    recup_per_cod_deseu,

    elim_per_sector,
    elim_lunar,
    elim_per_operator,
    elim_per_cod_deseu,

    resp_per_sector,
    resp_per_operator,
    resp_per_motiv,
    resp_per_cod_deseu,

    sumar_30z,

    contracte_active_per_tip,
    contracte_expira_60z,
    contracte_tmb,
    contracte_colectare,
    contracte_colectare_coduri,
    contracte_sortare,
    contracte_aerob,
    contracte_anaerob,
    contracte_depozitare,
    contracte_depozitare_sectoare,

    operatori,
    coduri_deseuri,
    sectoare,
    tmb_asociatii,
  ] = await Promise.all([

    // ── DEPOZITARE (waste_tickets_landfill) ───────────────────────────────────
    q(`SELECT s.sector_number, s.sector_name,
         COUNT(t.id) as tichete,
         ROUND(SUM(t.net_weight_tons)::numeric, 2) as total_tone,
         ROUND(AVG(t.net_weight_tons)::numeric, 3) as medie_tone
       FROM waste_tickets_landfill t
       JOIN sectors s ON t.sector_id = s.id
       WHERE t.deleted_at IS NULL ${sf('t.sector_id', sectorFilter)}
       GROUP BY s.sector_number, s.sector_name ORDER BY total_tone DESC`, P),

    q(`SELECT TO_CHAR(t.ticket_date, 'YYYY-MM') as luna, s.sector_number,
         COUNT(t.id) as tichete,
         ROUND(SUM(t.net_weight_tons)::numeric, 2) as tone
       FROM waste_tickets_landfill t
       JOIN sectors s ON t.sector_id = s.id
       WHERE t.deleted_at IS NULL ${sf('t.sector_id', sectorFilter)}
       GROUP BY luna, s.sector_number ORDER BY luna DESC, s.sector_number LIMIT 144`, P),

    q(`SELECT sup.short_name as operator, sup.name as operator_complet,
         s.sector_number,
         COUNT(t.id) as tichete,
         ROUND(SUM(t.net_weight_tons)::numeric, 2) as total_tone
       FROM waste_tickets_landfill t
       JOIN sectors s ON t.sector_id = s.id
       LEFT JOIN institutions sup ON t.supplier_id = sup.id
       WHERE t.deleted_at IS NULL ${sf('t.sector_id', sectorFilter)}
       GROUP BY sup.short_name, sup.name, s.sector_number ORDER BY total_tone DESC`, P),

    q(`SELECT sup.short_name as operator, s.sector_number,
         TO_CHAR(t.ticket_date, 'YYYY-MM') as luna,
         COUNT(t.id) as tichete,
         ROUND(SUM(t.net_weight_tons)::numeric, 2) as tone
       FROM waste_tickets_landfill t
       JOIN sectors s ON t.sector_id = s.id
       LEFT JOIN institutions sup ON t.supplier_id = sup.id
       WHERE t.deleted_at IS NULL AND t.ticket_date >= NOW() - INTERVAL '36 months'
       ${sf('t.sector_id', sectorFilter)}
       GROUP BY sup.short_name, s.sector_number, luna ORDER BY sup.short_name, luna`, P),

    q(`SELECT wc.code as cod_deseu, wc.description as descriere,
         s.sector_number,
         COUNT(t.id) as tichete,
         ROUND(SUM(t.net_weight_tons)::numeric, 2) as tone
       FROM waste_tickets_landfill t
       JOIN sectors s ON t.sector_id = s.id
       LEFT JOIN waste_codes wc ON t.waste_code_id = wc.id
       WHERE t.deleted_at IS NULL ${sf('t.sector_id', sectorFilter)}
       GROUP BY wc.code, wc.description, s.sector_number ORDER BY tone DESC`, P),

    q(`SELECT sup.short_name as operator, wc.code as cod_deseu, s.sector_number,
         ROUND(SUM(t.net_weight_tons)::numeric, 2) as tone
       FROM waste_tickets_landfill t
       JOIN sectors s ON t.sector_id = s.id
       LEFT JOIN institutions sup ON t.supplier_id = sup.id
       LEFT JOIN waste_codes wc ON t.waste_code_id = wc.id
       WHERE t.deleted_at IS NULL ${sf('t.sector_id', sectorFilter)}
       GROUP BY sup.short_name, wc.code, s.sector_number ORDER BY tone DESC LIMIT 100`, P),

    q(`SELECT t.generator_type, s.sector_number,
         COUNT(t.id) as tichete,
         ROUND(SUM(t.net_weight_tons)::numeric, 2) as tone
       FROM waste_tickets_landfill t
       JOIN sectors s ON t.sector_id = s.id
       WHERE t.deleted_at IS NULL ${sf('t.sector_id', sectorFilter)}
       GROUP BY t.generator_type, s.sector_number ORDER BY tone DESC`, P),

    q(`SELECT t.operation_type, t.contract_type, s.sector_number,
         COUNT(t.id) as tichete,
         ROUND(SUM(t.net_weight_tons)::numeric, 2) as tone
       FROM waste_tickets_landfill t
       JOIN sectors s ON t.sector_id = s.id
       WHERE t.deleted_at IS NULL ${sf('t.sector_id', sectorFilter)}
       GROUP BY t.operation_type, t.contract_type, s.sector_number ORDER BY tone DESC`, P),

    // ── TMB (waste_tickets_tmb) ───────────────────────────────────────────────
    q(`SELECT s.sector_number, s.sector_name,
         COUNT(t.id) as tichete,
         ROUND(SUM(t.net_weight_tons)::numeric, 2) as total_tone
       FROM waste_tickets_tmb t
       JOIN sectors s ON t.sector_id = s.id
       WHERE t.deleted_at IS NULL ${sf('t.sector_id', sectorFilter)}
       GROUP BY s.sector_number, s.sector_name ORDER BY total_tone DESC`, P),

    q(`SELECT TO_CHAR(t.ticket_date, 'YYYY-MM') as luna, s.sector_number,
         COUNT(t.id) as tichete,
         ROUND(SUM(t.net_weight_tons)::numeric, 2) as tone
       FROM waste_tickets_tmb t
       JOIN sectors s ON t.sector_id = s.id
       WHERE t.deleted_at IS NULL ${sf('t.sector_id', sectorFilter)}
       GROUP BY luna, s.sector_number ORDER BY luna, s.sector_number`, P),

    q(`SELECT sup.short_name as furnizor, op.short_name as operator,
         s.sector_number,
         COUNT(t.id) as tichete,
         ROUND(SUM(t.net_weight_tons)::numeric, 2) as tone
       FROM waste_tickets_tmb t
       JOIN sectors s ON t.sector_id = s.id
       LEFT JOIN institutions sup ON t.supplier_id = sup.id
       LEFT JOIN institutions op ON t.operator_id = op.id
       WHERE t.deleted_at IS NULL ${sf('t.sector_id', sectorFilter)}
       GROUP BY sup.short_name, op.short_name, s.sector_number ORDER BY tone DESC`, P),

    q(`SELECT sup.short_name as furnizor, op.short_name as operator,
         s.sector_number,
         TO_CHAR(t.ticket_date, 'YYYY-MM') as luna,
         ROUND(SUM(t.net_weight_tons)::numeric, 2) as tone
       FROM waste_tickets_tmb t
       JOIN sectors s ON t.sector_id = s.id
       LEFT JOIN institutions sup ON t.supplier_id = sup.id
       LEFT JOIN institutions op ON t.operator_id = op.id
       WHERE t.deleted_at IS NULL AND t.ticket_date >= NOW() - INTERVAL '36 months'
       ${sf('t.sector_id', sectorFilter)}
       GROUP BY sup.short_name, op.short_name, s.sector_number, luna ORDER BY sup.short_name, luna`, P),

    q(`SELECT wc.code as cod_deseu, wc.description as descriere,
         s.sector_number,
         COUNT(t.id) as tichete,
         ROUND(SUM(t.net_weight_tons)::numeric, 2) as tone
       FROM waste_tickets_tmb t
       JOIN sectors s ON t.sector_id = s.id
       LEFT JOIN waste_codes wc ON t.waste_code_id = wc.id
       WHERE t.deleted_at IS NULL ${sf('t.sector_id', sectorFilter)}
       GROUP BY wc.code, wc.description, s.sector_number ORDER BY tone DESC`, P),

    // ── RECICLARE (waste_tickets_recycling) ───────────────────────────────────
    q(`SELECT s.sector_number,
         COUNT(t.id) as tichete,
         ROUND(SUM(t.accepted_quantity_tons)::numeric, 2) as tone_acceptate,
         ROUND(SUM(t.delivered_quantity_tons)::numeric, 2) as tone_livrate
       FROM waste_tickets_recycling t
       JOIN sectors s ON t.sector_id = s.id
       WHERE t.deleted_at IS NULL ${sf('t.sector_id', sectorFilter)}
       GROUP BY s.sector_number ORDER BY s.sector_number`, P),

    q(`SELECT TO_CHAR(t.ticket_date, 'YYYY-MM') as luna, s.sector_number,
         ROUND(SUM(t.accepted_quantity_tons)::numeric, 2) as tone
       FROM waste_tickets_recycling t
       JOIN sectors s ON t.sector_id = s.id
       WHERE t.deleted_at IS NULL ${sf('t.sector_id', sectorFilter)}
       GROUP BY luna, s.sector_number ORDER BY luna, s.sector_number`, P),

    q(`SELECT sup.short_name as furnizor, rec.short_name as destinatar,
         s.sector_number,
         COUNT(t.id) as tichete,
         ROUND(SUM(t.accepted_quantity_tons)::numeric, 2) as tone_acceptate
       FROM waste_tickets_recycling t
       JOIN sectors s ON t.sector_id = s.id
       LEFT JOIN institutions sup ON t.supplier_id = sup.id
       LEFT JOIN institutions rec ON t.recipient_id = rec.id
       WHERE t.deleted_at IS NULL ${sf('t.sector_id', sectorFilter)}
       GROUP BY sup.short_name, rec.short_name, s.sector_number ORDER BY tone_acceptate DESC`, P),

    q(`SELECT wc.code as cod_deseu, wc.description as descriere,
         COUNT(t.id) as tichete,
         ROUND(SUM(t.accepted_quantity_tons)::numeric, 2) as tone
       FROM waste_tickets_recycling t
       LEFT JOIN waste_codes wc ON t.waste_code_id = wc.id
       WHERE t.deleted_at IS NULL ${sf('t.sector_id', sectorFilter)}
       GROUP BY wc.code, wc.description ORDER BY tone DESC`, P),

    // ── RECUPERARE (waste_tickets_recovery) ───────────────────────────────────
    q(`SELECT s.sector_number,
         COUNT(t.id) as tichete,
         ROUND(SUM(t.accepted_quantity_tons)::numeric, 2) as tone_acceptate,
         ROUND(SUM(t.delivered_quantity_tons)::numeric, 2) as tone_livrate
       FROM waste_tickets_recovery t
       JOIN sectors s ON t.sector_id = s.id
       WHERE t.deleted_at IS NULL ${sf('t.sector_id', sectorFilter)}
       GROUP BY s.sector_number ORDER BY s.sector_number`, P),

    q(`SELECT TO_CHAR(t.ticket_date, 'YYYY-MM') as luna, s.sector_number,
         ROUND(SUM(t.accepted_quantity_tons)::numeric, 2) as tone
       FROM waste_tickets_recovery t
       JOIN sectors s ON t.sector_id = s.id
       WHERE t.deleted_at IS NULL ${sf('t.sector_id', sectorFilter)}
       GROUP BY luna, s.sector_number ORDER BY luna, s.sector_number`, P),

    q(`SELECT sup.short_name as furnizor, rec.short_name as destinatar,
         s.sector_number,
         COUNT(t.id) as tichete,
         ROUND(SUM(t.accepted_quantity_tons)::numeric, 2) as tone
       FROM waste_tickets_recovery t
       JOIN sectors s ON t.sector_id = s.id
       LEFT JOIN institutions sup ON t.supplier_id = sup.id
       LEFT JOIN institutions rec ON t.recipient_id = rec.id
       WHERE t.deleted_at IS NULL ${sf('t.sector_id', sectorFilter)}
       GROUP BY sup.short_name, rec.short_name, s.sector_number ORDER BY tone DESC`, P),

    q(`SELECT wc.code as cod_deseu, wc.description as descriere,
         COUNT(t.id) as tichete,
         ROUND(SUM(t.accepted_quantity_tons)::numeric, 2) as tone
       FROM waste_tickets_recovery t
       LEFT JOIN waste_codes wc ON t.waste_code_id = wc.id
       WHERE t.deleted_at IS NULL ${sf('t.sector_id', sectorFilter)}
       GROUP BY wc.code, wc.description ORDER BY tone DESC`, P),

    // ── ELIMINARE (waste_tickets_disposal) ────────────────────────────────────
    q(`SELECT s.sector_number,
         COUNT(t.id) as tichete,
         ROUND(SUM(t.accepted_quantity_tons)::numeric, 2) as tone_acceptate,
         ROUND(SUM(t.delivered_quantity_tons)::numeric, 2) as tone_livrate
       FROM waste_tickets_disposal t
       JOIN sectors s ON t.sector_id = s.id
       WHERE t.deleted_at IS NULL ${sf('t.sector_id', sectorFilter)}
       GROUP BY s.sector_number ORDER BY s.sector_number`, P),

    q(`SELECT TO_CHAR(t.ticket_date, 'YYYY-MM') as luna, s.sector_number,
         ROUND(SUM(t.accepted_quantity_tons)::numeric, 2) as tone
       FROM waste_tickets_disposal t
       JOIN sectors s ON t.sector_id = s.id
       WHERE t.deleted_at IS NULL ${sf('t.sector_id', sectorFilter)}
       GROUP BY luna, s.sector_number ORDER BY luna, s.sector_number`, P),

    q(`SELECT sup.short_name as furnizor, rec.short_name as destinatar,
         s.sector_number,
         COUNT(t.id) as tichete,
         ROUND(SUM(t.accepted_quantity_tons)::numeric, 2) as tone
       FROM waste_tickets_disposal t
       JOIN sectors s ON t.sector_id = s.id
       LEFT JOIN institutions sup ON t.supplier_id = sup.id
       LEFT JOIN institutions rec ON t.recipient_id = rec.id
       WHERE t.deleted_at IS NULL ${sf('t.sector_id', sectorFilter)}
       GROUP BY sup.short_name, rec.short_name, s.sector_number ORDER BY tone DESC`, P),

    q(`SELECT wc.code as cod_deseu, wc.description as descriere,
         COUNT(t.id) as tichete,
         ROUND(SUM(t.accepted_quantity_tons)::numeric, 2) as tone
       FROM waste_tickets_disposal t
       LEFT JOIN waste_codes wc ON t.waste_code_id = wc.id
       WHERE t.deleted_at IS NULL ${sf('t.sector_id', sectorFilter)}
       GROUP BY wc.code, wc.description ORDER BY tone DESC`, P),

    // ── RESPINSE (waste_tickets_rejected) ─────────────────────────────────────
    q(`SELECT s.sector_number,
         COUNT(t.id) as tichete,
         ROUND(SUM(t.rejected_quantity_tons)::numeric, 2) as tone
       FROM waste_tickets_rejected t
       JOIN sectors s ON t.sector_id = s.id
       WHERE t.deleted_at IS NULL ${sf('t.sector_id', sectorFilter)}
       GROUP BY s.sector_number ORDER BY s.sector_number`, P),

    q(`SELECT sup.short_name as furnizor, op.short_name as operator,
         s.sector_number,
         COUNT(t.id) as tichete,
         ROUND(SUM(t.rejected_quantity_tons)::numeric, 2) as tone
       FROM waste_tickets_rejected t
       JOIN sectors s ON t.sector_id = s.id
       LEFT JOIN institutions sup ON t.supplier_id = sup.id
       LEFT JOIN institutions op ON t.operator_id = op.id
       WHERE t.deleted_at IS NULL ${sf('t.sector_id', sectorFilter)}
       GROUP BY sup.short_name, op.short_name, s.sector_number ORDER BY tone DESC`, P),

    q(`SELECT t.rejection_reason as motiv, s.sector_number,
         COUNT(t.id) as tichete,
         ROUND(SUM(t.rejected_quantity_tons)::numeric, 2) as tone
       FROM waste_tickets_rejected t
       JOIN sectors s ON t.sector_id = s.id
       WHERE t.deleted_at IS NULL ${sf('t.sector_id', sectorFilter)}
       GROUP BY t.rejection_reason, s.sector_number ORDER BY tichete DESC`, P),

    q(`SELECT wc.code as cod_deseu, wc.description as descriere,
         COUNT(t.id) as tichete,
         ROUND(SUM(t.rejected_quantity_tons)::numeric, 2) as tone
       FROM waste_tickets_rejected t
       LEFT JOIN waste_codes wc ON t.waste_code_id = wc.id
       WHERE t.deleted_at IS NULL ${sf('t.sector_id', sectorFilter)}
       GROUP BY wc.code, wc.description ORDER BY tichete DESC`, P),

    // ── SUMAR 30 ZILE ─────────────────────────────────────────────────────────
    q(`SELECT 'Depozitare' as tip, COUNT(id) as tichete, ROUND(SUM(net_weight_tons)::numeric,2) as tone
       FROM waste_tickets_landfill WHERE deleted_at IS NULL AND ticket_date >= NOW()-INTERVAL '30 days'
       UNION ALL
       SELECT 'TMB', COUNT(id), ROUND(SUM(net_weight_tons)::numeric,2)
       FROM waste_tickets_tmb WHERE deleted_at IS NULL AND ticket_date >= NOW()-INTERVAL '30 days'
       UNION ALL
       SELECT 'Reciclare', COUNT(id), ROUND(SUM(accepted_quantity_tons)::numeric,2)
       FROM waste_tickets_recycling WHERE deleted_at IS NULL AND ticket_date >= NOW()-INTERVAL '30 days'
       UNION ALL
       SELECT 'Recuperare', COUNT(id), ROUND(SUM(accepted_quantity_tons)::numeric,2)
       FROM waste_tickets_recovery WHERE deleted_at IS NULL AND ticket_date >= NOW()-INTERVAL '30 days'
       UNION ALL
       SELECT 'Eliminare', COUNT(id), ROUND(SUM(accepted_quantity_tons)::numeric,2)
       FROM waste_tickets_disposal WHERE deleted_at IS NULL AND ticket_date >= NOW()-INTERVAL '30 days'
       UNION ALL
       SELECT 'Respinse', COUNT(id), ROUND(SUM(rejected_quantity_tons)::numeric,2)
       FROM waste_tickets_rejected WHERE deleted_at IS NULL AND ticket_date >= NOW()-INTERVAL '30 days'`, []),

    // ── CONTRACTE ─────────────────────────────────────────────────────────────
    q(`SELECT 'TMB' as tip, COUNT(*) as numar FROM tmb_contracts WHERE deleted_at IS NULL AND is_active=true
       UNION ALL SELECT 'Colectare', COUNT(*) FROM waste_collector_contracts WHERE deleted_at IS NULL AND is_active=true
       UNION ALL SELECT 'Sortare', COUNT(*) FROM sorting_operator_contracts WHERE deleted_at IS NULL AND is_active=true
       UNION ALL SELECT 'Aerob', COUNT(*) FROM aerobic_contracts WHERE deleted_at IS NULL AND is_active=true
       UNION ALL SELECT 'Anaerob', COUNT(*) FROM anaerobic_contracts WHERE deleted_at IS NULL AND is_active=true
       UNION ALL SELECT 'Depozitare', COUNT(*) FROM disposal_contracts WHERE deleted_at IS NULL AND is_active=true`, []),

    q(`SELECT 'TMB' as tip, tc.contract_number, tc.contract_date_end, s.sector_number, i.short_name as operator
       FROM tmb_contracts tc JOIN sectors s ON tc.sector_id=s.id LEFT JOIN institutions i ON tc.institution_id=i.id
       WHERE tc.deleted_at IS NULL AND tc.is_active=true AND tc.contract_date_end BETWEEN NOW() AND NOW()+INTERVAL '60 days'
       UNION ALL
       SELECT 'Colectare', wc.contract_number, wc.contract_date_end, s.sector_number, i.short_name
       FROM waste_collector_contracts wc JOIN sectors s ON wc.sector_id=s.id LEFT JOIN institutions i ON wc.institution_id=i.id
       WHERE wc.deleted_at IS NULL AND wc.is_active=true AND wc.contract_date_end BETWEEN NOW() AND NOW()+INTERVAL '60 days'
       UNION ALL
       SELECT 'Sortare', sc.contract_number, sc.contract_date_end, s.sector_number, i.short_name
       FROM sorting_operator_contracts sc JOIN sectors s ON sc.sector_id=s.id LEFT JOIN institutions i ON sc.institution_id=i.id
       WHERE sc.deleted_at IS NULL AND sc.is_active=true AND sc.contract_date_end BETWEEN NOW() AND NOW()+INTERVAL '60 days'
       UNION ALL
       SELECT 'Aerob', ac.contract_number, ac.contract_date_end, s.sector_number, i.short_name
       FROM aerobic_contracts ac JOIN sectors s ON ac.sector_id=s.id LEFT JOIN institutions i ON ac.institution_id=i.id
       WHERE ac.deleted_at IS NULL AND ac.is_active=true AND ac.contract_date_end BETWEEN NOW() AND NOW()+INTERVAL '60 days'
       UNION ALL
       SELECT 'Anaerob', anc.contract_number, anc.contract_date_end, s.sector_number, i.short_name
       FROM anaerobic_contracts anc JOIN sectors s ON anc.sector_id=s.id LEFT JOIN institutions i ON anc.institution_id=i.id
       WHERE anc.deleted_at IS NULL AND anc.is_active=true AND anc.contract_date_end BETWEEN NOW() AND NOW()+INTERVAL '60 days'
       ORDER BY contract_date_end ASC`, []),

    q(`SELECT tc.contract_number, tc.contract_date_start, tc.contract_date_end,
         tc.tariff_per_ton, tc.estimated_quantity_tons, tc.contract_value, tc.currency,
         tc.indicator_recycling_percent, tc.indicator_energy_recovery_percent, tc.indicator_disposal_percent,
         tc.is_active, tc.attribution_type,
         s.sector_number, i.short_name as operator, ai.short_name as asociat
       FROM tmb_contracts tc
       JOIN sectors s ON tc.sector_id=s.id
       LEFT JOIN institutions i ON tc.institution_id=i.id
       LEFT JOIN institutions ai ON tc.associate_institution_id=ai.id
       WHERE tc.deleted_at IS NULL ${sf('tc.sector_id', sectorFilter)}
       ORDER BY tc.is_active DESC, s.sector_number`, P),

    q(`SELECT wc.contract_number, wc.contract_date_start, wc.contract_date_end,
         wc.is_active, wc.attribution_type,
         s.sector_number, i.short_name as operator, ai.short_name as asociat
       FROM waste_collector_contracts wc
       JOIN sectors s ON wc.sector_id=s.id
       LEFT JOIN institutions i ON wc.institution_id=i.id
       LEFT JOIN institutions ai ON wc.associate_institution_id=ai.id
       WHERE wc.deleted_at IS NULL ${sf('wc.sector_id', sectorFilter)}
       ORDER BY wc.is_active DESC, s.sector_number`, P),

    q(`SELECT wc.contract_number, wcc.id, wcd.code as cod_deseu, wcd.description as descriere,
         wcc.tariff, wcc.unit, wcc.estimated_quantity
       FROM waste_collector_contract_codes wcc
       JOIN waste_collector_contracts wc ON wcc.contract_id=wc.id
       LEFT JOIN waste_codes wcd ON wcc.waste_code_id=wcd.id
       WHERE wcc.deleted_at IS NULL AND wc.deleted_at IS NULL
       ORDER BY wc.contract_number, wcd.code`, []),

    q(`SELECT sc.contract_number, sc.contract_date_start, sc.contract_date_end,
         sc.tariff_per_ton, sc.estimated_quantity_tons, sc.contract_value,
         sc.is_active, sc.attribution_type,
         s.sector_number, i.short_name as operator, ai.short_name as asociat
       FROM sorting_operator_contracts sc
       JOIN sectors s ON sc.sector_id=s.id
       LEFT JOIN institutions i ON sc.institution_id=i.id
       LEFT JOIN institutions ai ON sc.associate_institution_id=ai.id
       WHERE sc.deleted_at IS NULL ${sf('sc.sector_id', sectorFilter)}
       ORDER BY sc.is_active DESC, s.sector_number`, P),

    q(`SELECT ac.contract_number, ac.contract_date_start, ac.contract_date_end,
         ac.tariff_per_ton, ac.estimated_quantity_tons, ac.contract_value,
         ac.indicator_disposal_percent, ac.is_active, ac.attribution_type,
         s.sector_number, i.short_name as operator, ai.short_name as asociat
       FROM aerobic_contracts ac
       JOIN sectors s ON ac.sector_id=s.id
       LEFT JOIN institutions i ON ac.institution_id=i.id
       LEFT JOIN institutions ai ON ac.associate_institution_id=ai.id
       WHERE ac.deleted_at IS NULL ${sf('ac.sector_id', sectorFilter)}
       ORDER BY ac.is_active DESC, s.sector_number`, P),

    q(`SELECT anc.contract_number, anc.contract_date_start, anc.contract_date_end,
         anc.tariff_per_ton, anc.estimated_quantity_tons, anc.contract_value,
         anc.indicator_disposal_percent, anc.is_active, anc.attribution_type,
         s.sector_number, i.short_name as operator, ai.short_name as asociat
       FROM anaerobic_contracts anc
       JOIN sectors s ON anc.sector_id=s.id
       LEFT JOIN institutions i ON anc.institution_id=i.id
       LEFT JOIN institutions ai ON anc.associate_institution_id=ai.id
       WHERE anc.deleted_at IS NULL ${sf('anc.sector_id', sectorFilter)}
       ORDER BY anc.is_active DESC, s.sector_number`, P),

    q(`SELECT dc.contract_number, dc.contract_date_start, dc.contract_date_end,
         dc.is_active, dc.attribution_type,
         i.short_name as operator, ai.short_name as asociat
       FROM disposal_contracts dc
       LEFT JOIN institutions i ON dc.institution_id=i.id
       LEFT JOIN institutions ai ON dc.associate_institution_id=ai.id
       WHERE dc.deleted_at IS NULL ORDER BY dc.is_active DESC`, []),

    q(`SELECT dc.contract_number, s.sector_number,
         dcs.tariff_per_ton, dcs.cec_tax_per_ton, dcs.total_per_ton,
         dcs.contracted_quantity_tons, dcs.sector_value, dcs.currency
       FROM disposal_contract_sectors dcs
       JOIN disposal_contracts dc ON dcs.contract_id=dc.id
       JOIN sectors s ON dcs.sector_id=s.id
       WHERE dcs.deleted_at IS NULL AND dc.deleted_at IS NULL
       ORDER BY dc.contract_number, s.sector_number`, []),

    // ── OPERATORI, CODURI, SECTOARE, ASOCIATII TMB ────────────────────────────
    q(`SELECT i.id, i.name, i.short_name, i.type, i.is_active,
         i.contact_email, i.contact_phone, i.fiscal_code
       FROM institutions i WHERE i.deleted_at IS NULL ORDER BY i.type, i.name`, []),

    q(`SELECT code, description, category, is_active FROM waste_codes ORDER BY code`, []),

    q(`SELECT sector_number, sector_name, is_active, area_km2, population FROM sectors WHERE deleted_at IS NULL ORDER BY sector_number`, []),

    q(`SELECT s.sector_number, po.short_name as operator_principal, so.short_name as operator_secundar,
         ta.association_name, ta.is_active, ta.valid_from, ta.valid_to
       FROM tmb_associations ta
       JOIN sectors s ON ta.sector_id=s.id
       LEFT JOIN institutions po ON ta.primary_operator_id=po.id
       LEFT JOIN institutions so ON ta.secondary_operator_id=so.id
       ORDER BY s.sector_number`, []),
  ]);

  return {
    depozitare: { per_sector: dep_per_sector, lunar_per_sector: dep_lunar_per_sector, per_operator: dep_per_operator, per_operator_lunar: dep_per_operator_lunar, per_cod_deseu: dep_per_cod_deseu, per_operator_cod: dep_per_operator_cod, generator_type: dep_generator_type, operation_type: dep_operation_type },
    tmb: { per_sector: tmb_per_sector, lunar: tmb_lunar, per_operator: tmb_per_operator, per_operator_lunar: tmb_per_operator_lunar, per_cod_deseu: tmb_per_cod_deseu },
    reciclare: { per_sector: rec_per_sector, lunar: rec_lunar, per_operator: rec_per_operator, per_cod_deseu: rec_per_cod_deseu },
    recuperare: { per_sector: recup_per_sector, lunar: recup_lunar, per_operator: recup_per_operator, per_cod_deseu: recup_per_cod_deseu },
    eliminare: { per_sector: elim_per_sector, lunar: elim_lunar, per_operator: elim_per_operator, per_cod_deseu: elim_per_cod_deseu },
    respinse: { per_sector: resp_per_sector, per_operator: resp_per_operator, per_motiv: resp_per_motiv, per_cod_deseu: resp_per_cod_deseu },
    sumar_30z,
    contracte: { active_per_tip: contracte_active_per_tip, expira_60z: contracte_expira_60z, tmb: contracte_tmb, colectare: contracte_colectare, colectare_coduri: contracte_colectare_coduri, sortare: contracte_sortare, aerob: contracte_aerob, anaerob: contracte_anaerob, depozitare: contracte_depozitare, depozitare_sectoare: contracte_depozitare_sectoare },
    operatori, coduri_deseuri, sectoare, tmb_asociatii,
  };
};

// ============================================================================
// SYSTEM PROMPT
// ============================================================================
const buildSystemPrompt = (ctx, userRole) => {
  const today = new Date().toLocaleDateString('ro-RO', { year: 'numeric', month: 'long', day: 'numeric' });

  return `Ești SAMD Assistant, asistent inteligent al platformei SAMD pentru ADIGIDMB București.
Data de astăzi: ${today} | Rol: ${userRole}

## DATE COMPLETE DIN SISTEM (tot istoricul disponibil):

### SECTOARE:
${JSON.stringify(ctx.sectoare)}

### CODURI DEȘEURI:
${JSON.stringify(ctx.coduri_deseuri)}

### OPERATORI (toate instituțiile):
${JSON.stringify(ctx.operatori)}

### ASOCIAȚII TMB per sector:
${JSON.stringify(ctx.tmb_asociatii)}

### SUMAR ultimele 30 zile:
${JSON.stringify(ctx.sumar_30z)}

---
## DEPOZITARE (waste_tickets_landfill):

### Per sector (total):
${JSON.stringify(ctx.depozitare.per_sector)}

### Evoluție lunară per sector:
${JSON.stringify(ctx.depozitare.lunar_per_sector)}

### Per operator (total):
${JSON.stringify(ctx.depozitare.per_operator)}

### Per operator per lună:
${JSON.stringify(ctx.depozitare.per_operator_lunar)}

### Per cod deșeu:
${JSON.stringify(ctx.depozitare.per_cod_deseu)}

### Per operator + cod deșeu:
${JSON.stringify(ctx.depozitare.per_operator_cod)}

### Per tip generator:
${JSON.stringify(ctx.depozitare.generator_type)}

### Per tip operațiune + tip contract:
${JSON.stringify(ctx.depozitare.operation_type)}

---
## TMB (waste_tickets_tmb):

### Per sector:
${JSON.stringify(ctx.tmb.per_sector)}

### Evoluție lunară per sector:
${JSON.stringify(ctx.tmb.lunar)}

### Per furnizor + operator:
${JSON.stringify(ctx.tmb.per_operator)}

### Per furnizor + operator per lună:
${JSON.stringify(ctx.tmb.per_operator_lunar)}

### Per cod deșeu:
${JSON.stringify(ctx.tmb.per_cod_deseu)}

---
## RECICLARE (waste_tickets_recycling):

### Per sector:
${JSON.stringify(ctx.reciclare.per_sector)}

### Evoluție lunară per sector:
${JSON.stringify(ctx.reciclare.lunar)}

### Per furnizor + destinatar:
${JSON.stringify(ctx.reciclare.per_operator)}

### Per cod deșeu:
${JSON.stringify(ctx.reciclare.per_cod_deseu)}

---
## RECUPERARE (waste_tickets_recovery):

### Per sector:
${JSON.stringify(ctx.recuperare.per_sector)}

### Evoluție lunară per sector:
${JSON.stringify(ctx.recuperare.lunar)}

### Per furnizor + destinatar:
${JSON.stringify(ctx.recuperare.per_operator)}

### Per cod deșeu:
${JSON.stringify(ctx.recuperare.per_cod_deseu)}

---
## ELIMINARE (waste_tickets_disposal):

### Per sector:
${JSON.stringify(ctx.eliminare.per_sector)}

### Evoluție lunară per sector:
${JSON.stringify(ctx.eliminare.lunar)}

### Per furnizor + destinatar:
${JSON.stringify(ctx.eliminare.per_operator)}

### Per cod deșeu:
${JSON.stringify(ctx.eliminare.per_cod_deseu)}

---
## TICHETE RESPINSE (waste_tickets_rejected):

### Per sector:
${JSON.stringify(ctx.respinse.per_sector)}

### Per furnizor + operator:
${JSON.stringify(ctx.respinse.per_operator)}

### Per motiv respingere:
${JSON.stringify(ctx.respinse.per_motiv)}

### Per cod deșeu:
${JSON.stringify(ctx.respinse.per_cod_deseu)}

---
## CONTRACTE:

### Active per tip:
${JSON.stringify(ctx.contracte.active_per_tip)}

### Expiră în 60 zile:
${JSON.stringify(ctx.contracte.expira_60z)}

### TMB (cu indicatori reciclare/recuperare/depozitare):
${JSON.stringify(ctx.contracte.tmb)}

### Colectare:
${JSON.stringify(ctx.contracte.colectare)}

### Colectare - coduri deșeuri contractate cu tarife:
${JSON.stringify(ctx.contracte.colectare_coduri)}

### Sortare:
${JSON.stringify(ctx.contracte.sortare)}

### Aerob (tratare aerobă):
${JSON.stringify(ctx.contracte.aerob)}

### Anaerob (tratare anaerobă):
${JSON.stringify(ctx.contracte.anaerob)}

### Depozitare:
${JSON.stringify(ctx.contracte.depozitare)}

### Depozitare - tarife per sector:
${JSON.stringify(ctx.contracte.depozitare_sectoare)}

---
## INSTRUCȚIUNI:
- Răspunde ÎNTOTDEAUNA în română
- Formatează cifrele: 12.847 tone, 1.234.567 RON
- Folosește bullet points pentru liste
- Nu inventa cifre — EXCLUSIV datele de mai sus
- Poți calcula: procente, sume, medii, comparații între perioade/sectoare/operatori
- Pentru rapoarte narrative, scrie text profesional pentru board ADIGIDMB
- Dacă o informație nu există în date, spune direct că nu există în sistem`;
};

// ============================================================================
// POST /api/ai/chat
// ============================================================================
export const aiChat = async (req, res) => {
  try {
    const { messages } = req.body;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ success: false, message: 'messages[] este obligatoriu' });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ success: false, message: 'ANTHROPIC_API_KEY nu este configurat' });
    }

    const { visibleSectorIds, accessLevel } = req.userAccess || {};
    const contextData = await fetchContextData(req.user.role, visibleSectorIds, accessLevel);
    const systemPrompt = buildSystemPrompt(contextData, req.user.role);

    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 2048,
        system: systemPrompt,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
      }),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      console.error('Claude API error:', errData);
      return res.status(502).json({ success: false, message: 'Eroare la comunicarea cu Claude API' });
    }

    const data = await response.json();
    const reply = data.content?.[0]?.text || 'Nu am putut genera un răspuns.';
    res.json({ success: true, reply });
  } catch (error) {
    console.error('AI chat error:', error);
    res.status(500).json({ success: false, message: 'Eroare internă la procesarea cererii AI' });
  }
};