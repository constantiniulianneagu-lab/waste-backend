/**
 * ============================================================================
 * AI ASSISTANT CONTROLLER
 * Asistent inteligent SAMD - powered by Claude API
 * Acces complet la toate datele de deșeuri (fără date sensibile)
 * ============================================================================
 */

import pool from '../config/database.js';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL = 'claude-sonnet-4-20250514';

// Helper: execută query și returnează rows (sau [] la eroare)
const q = (sql, params) => pool.query(sql, params).then(r => r.rows).catch(() => []);

// Helper: adaugă filtru sector în WHERE
const sf = (col, sectorFilter) => sectorFilter ? `AND ${col} = ANY($1::uuid[])` : '';
const sp = (sectorParam) => sectorParam ? [sectorParam] : [];

// ============================================================================
// FETCH DATE COMPLETE DIN DB
// ============================================================================
const fetchContextData = async (userRole, visibleSectorIds, accessLevel) => {
  const sectorFilter = accessLevel === 'SECTOR' && visibleSectorIds?.length > 0;
  const sectorParam = sectorFilter ? visibleSectorIds : null;
  const P = sp(sectorParam);

  const [
    depozitare_per_sector,
    depozitare_lunar,
    depozitare_top_zile,
    tmb_per_sector,
    tmb_lunar,
    tmb_discrepante,
    tmb_per_operator,
    reciclare_per_sector,
    reciclare_lunar,
    reciclare_per_operator,
    recuperare_per_sector,
    recuperare_per_operator,
    eliminare_per_sector,
    eliminare_per_operator,
    respinse_per_sector,
    respinse_per_operator,
    sumar_general,
    contracte_active_per_tip,
    contracte_expira_60z,
    contracte_tmb_detalii,
    contracte_colectare_detalii,
    contracte_sortare_detalii,
    contracte_aerob_detalii,
    contracte_anaerob_detalii,
    contracte_depozitare_detalii,
    operatori_activi,
    sectoare_info,
  ] = await Promise.all([

    // DEPOZITARE per sector 90 zile
    q(`SELECT s.sector_number, s.sector_name,
         COUNT(wt.id) as tichete,
         ROUND(SUM(wt.net_weight_tons)::numeric, 2) as total_tone,
         ROUND(AVG(wt.net_weight_tons)::numeric, 3) as medie_tone_per_tiket
       FROM waste_tickets_landfill wt
       JOIN sectors s ON wt.sector_id = s.id
       WHERE wt.deleted_at IS NULL ${sf('wt.sector_id', sectorFilter)}
       GROUP BY s.sector_number, s.sector_name ORDER BY total_tone DESC`, P),

    // DEPOZITARE lunar 12 luni per sector
    q(`SELECT TO_CHAR(ticket_date, 'YYYY-MM') as luna,
         s.sector_number,
         ROUND(SUM(net_weight_tons)::numeric, 2) as tone
       FROM waste_tickets_landfill wt
       JOIN sectors s ON wt.sector_id = s.id
       WHERE wt.deleted_at IS NULL ${sf('wt.sector_id', sectorFilter)}
       GROUP BY luna, s.sector_number ORDER BY luna, s.sector_number`, P),

    // DEPOZITARE top 10 zile cantitate maxima
    q(`SELECT ticket_date, s.sector_number,
         ROUND(SUM(net_weight_tons)::numeric, 2) as tone
       FROM waste_tickets_landfill wt
       JOIN sectors s ON wt.sector_id = s.id
       WHERE wt.deleted_at IS NULL ${sf('wt.sector_id', sectorFilter)}
       GROUP BY ticket_date, s.sector_number
       ORDER BY tone DESC LIMIT 10`, P),

    // DEPOZITARE per operator (supplier) - toate datele
    q(`SELECT sup.short_name as operator, sup.name as operator_nume_complet,
         s.sector_number,
         COUNT(wt.id) as tichete,
         ROUND(SUM(wt.net_weight_tons)::numeric, 2) as total_tone
       FROM waste_tickets_landfill wt
       JOIN sectors s ON wt.sector_id = s.id
       LEFT JOIN institutions sup ON wt.supplier_id = sup.id
       WHERE wt.deleted_at IS NULL
       ${sf('wt.sector_id', sectorFilter)}
       GROUP BY sup.short_name, sup.name, s.sector_number
       ORDER BY total_tone DESC`, P),

    // TMB per sector 90 zile
    q(`SELECT s.sector_number, s.sector_name,
         COUNT(wt.id) as tichete,
         ROUND(SUM(wt.net_weight_tons)::numeric, 2) as total_tone_acceptate,
         ROUND(SUM(wt.gross_weight_tons)::numeric, 2) as total_tone_livrate
       FROM waste_tickets_tmb wt
       JOIN sectors s ON wt.sector_id = s.id
       WHERE wt.deleted_at IS NULL ${sf('wt.sector_id', sectorFilter)}
       GROUP BY s.sector_number, s.sector_name ORDER BY total_tone_acceptate DESC`, P),

    // TMB lunar 12 luni
    q(`SELECT TO_CHAR(ticket_date, 'YYYY-MM') as luna,
         ROUND(SUM(net_weight_tons)::numeric, 2) as tone_acceptate,
         ROUND(SUM(gross_weight_tons)::numeric, 2) as tone_livrate
       FROM waste_tickets_tmb wt
       WHERE wt.deleted_at IS NULL ${sf('wt.sector_id', sectorFilter)}
       GROUP BY luna ORDER BY luna`, P),

    // TMB discrepante per operator
    q(`SELECT i.short_name as operator, s.sector_number,
         COUNT(*) as tichete,
         ROUND(SUM(wt.gross_weight_tons - wt.net_weight_tons)::numeric, 2) as discrepanta_totala_tone,
         ROUND(AVG(wt.gross_weight_tons - wt.net_weight_tons)::numeric, 3) as discrepanta_medie,
         ROUND((SUM(wt.gross_weight_tons - wt.net_weight_tons) / NULLIF(SUM(wt.gross_weight_tons), 0) * 100)::numeric, 2) as procent_discrepanta
       FROM waste_tickets_tmb wt
       JOIN sectors s ON wt.sector_id = s.id
       LEFT JOIN institutions i ON wt.operator_id = i.id
       WHERE wt.deleted_at IS NULL
         AND wt.gross_weight_tons IS NOT NULL AND wt.net_weight_tons IS NOT NULL
         AND (wt.gross_weight_tons - wt.net_weight_tons) > 0.05
       ${sf('wt.sector_id', sectorFilter)}
       GROUP BY i.short_name, s.sector_number
       ORDER BY discrepanta_totala_tone DESC LIMIT 15`, P),

    // RECICLARE per sector 90 zile
    q(`SELECT s.sector_number,
         COUNT(wt.id) as tichete,
         ROUND(SUM(wt.net_weight_tons)::numeric, 2) as total_tone
       FROM waste_tickets_recycling wt
       JOIN sectors s ON wt.sector_id = s.id
       WHERE wt.deleted_at IS NULL ${sf('wt.sector_id', sectorFilter)}
       GROUP BY s.sector_number ORDER BY s.sector_number`, P),

    // RECICLARE lunar
    q(`SELECT TO_CHAR(ticket_date, 'YYYY-MM') as luna,
         ROUND(SUM(net_weight_tons)::numeric, 2) as tone
       FROM waste_tickets_recycling
       WHERE deleted_at IS NULL ${sf('sector_id', sectorFilter)}
       GROUP BY luna ORDER BY luna`, P),

    // RECUPERARE per sector 90 zile
    q(`SELECT s.sector_number,
         COUNT(wt.id) as tichete,
         ROUND(SUM(wt.net_weight_tons)::numeric, 2) as total_tone
       FROM waste_tickets_recovery wt
       JOIN sectors s ON wt.sector_id = s.id
       WHERE wt.deleted_at IS NULL ${sf('wt.sector_id', sectorFilter)}
       GROUP BY s.sector_number ORDER BY s.sector_number`, P),

    // ELIMINARE per sector 90 zile
    q(`SELECT s.sector_number,
         COUNT(wt.id) as tichete,
         ROUND(SUM(wt.net_weight_tons)::numeric, 2) as total_tone
       FROM waste_tickets_disposal wt
       JOIN sectors s ON wt.sector_id = s.id
       WHERE wt.deleted_at IS NULL ${sf('wt.sector_id', sectorFilter)}
       GROUP BY s.sector_number ORDER BY s.sector_number`, P),

    // RESPINSE per sector 90 zile
    q(`SELECT s.sector_number,
         COUNT(wt.id) as tichete,
         ROUND(SUM(wt.net_weight_tons)::numeric, 2) as total_tone
       FROM waste_tickets_rejected wt
       JOIN sectors s ON wt.sector_id = s.id
       WHERE wt.deleted_at IS NULL ${sf('wt.sector_id', sectorFilter)}
       GROUP BY s.sector_number ORDER BY s.sector_number`, P),


    // TMB per operator (supplier + operator) - toate datele
    q(`SELECT sup.short_name as furnizor, op.short_name as operator,
         s.sector_number,
         COUNT(wt.id) as tichete,
         ROUND(SUM(wt.net_weight_tons)::numeric, 2) as tone_acceptate,
         ROUND(SUM(wt.gross_weight_tons)::numeric, 2) as tone_livrate
       FROM waste_tickets_tmb wt
       JOIN sectors s ON wt.sector_id = s.id
       LEFT JOIN institutions sup ON wt.supplier_id = sup.id
       LEFT JOIN institutions op ON wt.operator_id = op.id
       WHERE wt.deleted_at IS NULL
       ${sf('wt.sector_id', sectorFilter)}
       GROUP BY sup.short_name, op.short_name, s.sector_number
       ORDER BY tone_acceptate DESC`, P),

    // RECICLARE per operator - toate datele
    q(`SELECT sup.short_name as furnizor, s.sector_number,
         COUNT(wt.id) as tichete,
         ROUND(SUM(wt.net_weight_tons)::numeric, 2) as tone
       FROM waste_tickets_recycling wt
       JOIN sectors s ON wt.sector_id = s.id
       LEFT JOIN institutions sup ON wt.supplier_id = sup.id
       WHERE wt.deleted_at IS NULL
       ${sf('wt.sector_id', sectorFilter)}
       GROUP BY sup.short_name, s.sector_number
       ORDER BY tone DESC`, P),

    // RECUPERARE per operator - toate datele
    q(`SELECT sup.short_name as furnizor, s.sector_number,
         COUNT(wt.id) as tichete,
         ROUND(SUM(wt.net_weight_tons)::numeric, 2) as tone
       FROM waste_tickets_recovery wt
       JOIN sectors s ON wt.sector_id = s.id
       LEFT JOIN institutions sup ON wt.supplier_id = sup.id
       WHERE wt.deleted_at IS NULL
       ${sf('wt.sector_id', sectorFilter)}
       GROUP BY sup.short_name, s.sector_number
       ORDER BY tone DESC`, P),

    // ELIMINARE per operator - toate datele
    q(`SELECT sup.short_name as furnizor, s.sector_number,
         COUNT(wt.id) as tichete,
         ROUND(SUM(wt.net_weight_tons)::numeric, 2) as tone
       FROM waste_tickets_disposal wt
       JOIN sectors s ON wt.sector_id = s.id
       LEFT JOIN institutions sup ON wt.supplier_id = sup.id
       WHERE wt.deleted_at IS NULL
       ${sf('wt.sector_id', sectorFilter)}
       GROUP BY sup.short_name, s.sector_number
       ORDER BY tone DESC`, P),

    // RESPINSE per operator - toate datele
    q(`SELECT sup.short_name as furnizor, op.short_name as operator,
         s.sector_number,
         COUNT(wt.id) as tichete,
         ROUND(SUM(wt.net_weight_tons)::numeric, 2) as tone
       FROM waste_tickets_rejected wt
       JOIN sectors s ON wt.sector_id = s.id
       LEFT JOIN institutions sup ON wt.supplier_id = sup.id
       LEFT JOIN institutions op ON wt.operator_id = op.id
       WHERE wt.deleted_at IS NULL
       ${sf('wt.sector_id', sectorFilter)}
       GROUP BY sup.short_name, op.short_name, s.sector_number
       ORDER BY tone DESC`, P),
    // SUMAR GENERAL toate tipurile ultimele 30 zile
    q(`SELECT 'Depozitare' as tip, COUNT(id) as tichete, ROUND(SUM(net_weight_tons)::numeric, 2) as tone
       FROM waste_tickets_landfill WHERE deleted_at IS NULL AND ticket_date >= NOW() - INTERVAL '30 days'
       UNION ALL
       SELECT 'TMB', COUNT(id), ROUND(SUM(net_weight_tons)::numeric, 2)
       FROM waste_tickets_tmb WHERE deleted_at IS NULL AND ticket_date >= NOW() - INTERVAL '30 days'
       UNION ALL
       SELECT 'Reciclare', COUNT(id), ROUND(SUM(net_weight_tons)::numeric, 2)
       FROM waste_tickets_recycling WHERE deleted_at IS NULL AND ticket_date >= NOW() - INTERVAL '30 days'
       UNION ALL
       SELECT 'Recuperare', COUNT(id), ROUND(SUM(net_weight_tons)::numeric, 2)
       FROM waste_tickets_recovery WHERE deleted_at IS NULL AND ticket_date >= NOW() - INTERVAL '30 days'
       UNION ALL
       SELECT 'Eliminare', COUNT(id), ROUND(SUM(net_weight_tons)::numeric, 2)
       FROM waste_tickets_disposal WHERE deleted_at IS NULL AND ticket_date >= NOW() - INTERVAL '30 days'
       UNION ALL
       SELECT 'Respinse', COUNT(id), ROUND(SUM(net_weight_tons)::numeric, 2)
       FROM waste_tickets_rejected WHERE deleted_at IS NULL AND ticket_date >= NOW() - INTERVAL '30 days'`, []),

    // CONTRACTE active per tip
    q(`SELECT 'TMB' as tip, COUNT(*) as numar FROM tmb_contracts WHERE deleted_at IS NULL AND is_active = true
       UNION ALL SELECT 'Colectare', COUNT(*) FROM waste_operator_contracts WHERE deleted_at IS NULL AND is_active = true
       UNION ALL SELECT 'Sortare', COUNT(*) FROM sorting_operator_contracts WHERE deleted_at IS NULL AND is_active = true
       UNION ALL SELECT 'Aerob', COUNT(*) FROM aerobic_contracts WHERE deleted_at IS NULL AND is_active = true
       UNION ALL SELECT 'Anaerob', COUNT(*) FROM anaerobic_contracts WHERE deleted_at IS NULL AND is_active = true
       UNION ALL SELECT 'Depozitare', COUNT(*) FROM disposal_contracts WHERE deleted_at IS NULL AND is_active = true`, []),

    // CONTRACTE care expira in 60 zile
    q(`SELECT 'TMB' as tip, tc.contract_number, tc.contract_date_end, s.sector_number, i.short_name as operator
       FROM tmb_contracts tc JOIN sectors s ON tc.sector_id = s.id LEFT JOIN institutions i ON tc.institution_id = i.id
       WHERE tc.deleted_at IS NULL AND tc.is_active = true AND tc.contract_date_end BETWEEN NOW() AND NOW() + INTERVAL '60 days'
       UNION ALL
       SELECT 'Colectare', wc.contract_number, wc.contract_date_end, s.sector_number, i.short_name
       FROM waste_operator_contracts wc JOIN sectors s ON wc.sector_id = s.id LEFT JOIN institutions i ON wc.institution_id = i.id
       WHERE wc.deleted_at IS NULL AND wc.is_active = true AND wc.contract_date_end BETWEEN NOW() AND NOW() + INTERVAL '60 days'
       UNION ALL
       SELECT 'Sortare', sc.contract_number, sc.contract_date_end, s.sector_number, i.short_name
       FROM sorting_operator_contracts sc JOIN sectors s ON sc.sector_id = s.id LEFT JOIN institutions i ON sc.institution_id = i.id
       WHERE sc.deleted_at IS NULL AND sc.is_active = true AND sc.contract_date_end BETWEEN NOW() AND NOW() + INTERVAL '60 days'
       UNION ALL
       SELECT 'Aerob', ac.contract_number, ac.contract_date_end, s.sector_number, i.short_name
       FROM aerobic_contracts ac JOIN sectors s ON ac.sector_id = s.id LEFT JOIN institutions i ON ac.institution_id = i.id
       WHERE ac.deleted_at IS NULL AND ac.is_active = true AND ac.contract_date_end BETWEEN NOW() AND NOW() + INTERVAL '60 days'
       UNION ALL
       SELECT 'Anaerob', anc.contract_number, anc.contract_date_end, s.sector_number, i.short_name
       FROM anaerobic_contracts anc JOIN sectors s ON anc.sector_id = s.id LEFT JOIN institutions i ON anc.institution_id = i.id
       WHERE anc.deleted_at IS NULL AND anc.is_active = true AND anc.contract_date_end BETWEEN NOW() AND NOW() + INTERVAL '60 days'
       ORDER BY contract_date_end ASC`, []),

    // TMB contracte detalii
    q(`SELECT tc.contract_number, tc.contract_date_start, tc.contract_date_end,
         tc.tariff_per_ton, tc.estimated_quantity_tons, tc.is_active,
         s.sector_number, i.short_name as operator
       FROM tmb_contracts tc
       JOIN sectors s ON tc.sector_id = s.id LEFT JOIN institutions i ON tc.institution_id = i.id
       WHERE tc.deleted_at IS NULL ${sf('tc.sector_id', sectorFilter)}
       ORDER BY tc.is_active DESC, s.sector_number`, P),

    // Colectare contracte
    q(`SELECT wc.contract_number, wc.contract_date_start, wc.contract_date_end, wc.is_active,
         s.sector_number, i.short_name as operator
       FROM waste_operator_contracts wc
       JOIN sectors s ON wc.sector_id = s.id LEFT JOIN institutions i ON wc.institution_id = i.id
       WHERE wc.deleted_at IS NULL ${sf('wc.sector_id', sectorFilter)}
       ORDER BY wc.is_active DESC, s.sector_number`, P),

    // Sortare contracte
    q(`SELECT sc.contract_number, sc.contract_date_start, sc.contract_date_end, sc.is_active,
         s.sector_number, i.short_name as operator
       FROM sorting_operator_contracts sc
       JOIN sectors s ON sc.sector_id = s.id LEFT JOIN institutions i ON sc.institution_id = i.id
       WHERE sc.deleted_at IS NULL ${sf('sc.sector_id', sectorFilter)}
       ORDER BY sc.is_active DESC, s.sector_number`, P),

    // Aerob contracte
    q(`SELECT ac.contract_number, ac.contract_date_start, ac.contract_date_end, ac.is_active,
         s.sector_number, i.short_name as operator
       FROM aerobic_contracts ac
       JOIN sectors s ON ac.sector_id = s.id LEFT JOIN institutions i ON ac.institution_id = i.id
       WHERE ac.deleted_at IS NULL ${sf('ac.sector_id', sectorFilter)}
       ORDER BY ac.is_active DESC, s.sector_number`, P),

    // Anaerob contracte
    q(`SELECT anc.contract_number, anc.contract_date_start, anc.contract_date_end, anc.is_active,
         s.sector_number, i.short_name as operator
       FROM anaerobic_contracts anc
       JOIN sectors s ON anc.sector_id = s.id LEFT JOIN institutions i ON anc.institution_id = i.id
       WHERE anc.deleted_at IS NULL ${sf('anc.sector_id', sectorFilter)}
       ORDER BY anc.is_active DESC, s.sector_number`, P),

    // Depozitare contracte
    q(`SELECT dc.contract_number, dc.contract_date_start, dc.contract_date_end, dc.is_active,
         i.short_name as operator
       FROM disposal_contracts dc LEFT JOIN institutions i ON dc.institution_id = i.id
       WHERE dc.deleted_at IS NULL ORDER BY dc.is_active DESC`, []),

    // OPERATORI activi
    q(`SELECT i.name, i.short_name, i.type
       FROM institutions i
       WHERE i.deleted_at IS NULL AND i.is_active = true
         AND i.type IN ('OPERATOR', 'WASTE_OPERATOR')
       ORDER BY i.name`, []),

    // SECTOARE info
    q(`SELECT s.sector_number, s.sector_name, s.is_active
       FROM sectors s WHERE s.deleted_at IS NULL ORDER BY s.sector_number`, []),
  ]);

  return {
    depozitare_per_sector, depozitare_lunar, depozitare_top_zile, depozitare_per_operator,
    tmb_per_sector, tmb_lunar, tmb_discrepante, tmb_per_operator,
    reciclare_per_sector, reciclare_lunar, reciclare_per_operator,
    recuperare_per_sector, recuperare_per_operator,
    eliminare_per_sector, eliminare_per_operator,
    respinse_per_sector, respinse_per_operator,
    sumar_general_30z: sumar_general,
    contracte_active_per_tip, contracte_expira_60z,
    contracte_tmb: contracte_tmb_detalii,
    contracte_colectare: contracte_colectare_detalii,
    contracte_sortare: contracte_sortare_detalii,
    contracte_aerob: contracte_aerob_detalii,
    contracte_anaerob: contracte_anaerob_detalii,
    contracte_depozitare: contracte_depozitare_detalii,
    operatori_activi, sectoare_info,
  };
};

// ============================================================================
// BUILD SYSTEM PROMPT
// ============================================================================
const buildSystemPrompt = (contextData, userRole) => {
  const today = new Date().toLocaleDateString('ro-RO', {
    year: 'numeric', month: 'long', day: 'numeric'
  });

  return `Ești SAMD Assistant, asistent inteligent integrat în platforma SAMD (Sistema de Administrare și Monitorizare a Deșeurilor) pentru ADIGIDMB București.

Data de astăzi: ${today}
Rolul utilizatorului: ${userRole}

## DATE REALE DIN SISTEM:

### Sumar general - ultimele 30 zile:
${JSON.stringify(contextData.sumar_general_30z, null, 2)}

### Depozitare per sector (toate datele):
${JSON.stringify(contextData.depozitare_per_sector, null, 2)}

### Depozitare evoluție lunară (toate datele):
${JSON.stringify(contextData.depozitare_lunar, null, 2)}

### Depozitare top zile cantitate maximă:
${JSON.stringify(contextData.depozitare_top_zile, null, 2)}

### Depozitare per operator/furnizor (toate datele):
${JSON.stringify(contextData.depozitare_per_operator, null, 2)}

### TMB per sector (toate datele):
${JSON.stringify(contextData.tmb_per_sector, null, 2)}

### TMB evoluție lunară (toate datele):
${JSON.stringify(contextData.tmb_lunar, null, 2)}

### TMB discrepanțe operatori:
${JSON.stringify(contextData.tmb_discrepante, null, 2)}
### TMB per operator/furnizor (toate datele):
${JSON.stringify(contextData.tmb_per_operator, null, 2)}

### Reciclare per operator (toate datele):
${JSON.stringify(contextData.reciclare_per_operator, null, 2)}

### Recuperare per operator (toate datele):
${JSON.stringify(contextData.recuperare_per_operator, null, 2)}

### Eliminare per operator (toate datele):
${JSON.stringify(contextData.eliminare_per_operator, null, 2)}

### Tichete respinse per operator (toate datele):
${JSON.stringify(contextData.respinse_per_operator, null, 2)}

### Reciclare per sector (toate datele):
${JSON.stringify(contextData.reciclare_per_sector, null, 2)}

### Reciclare evoluție lunară (toate datele):
${JSON.stringify(contextData.reciclare_lunar, null, 2)}

### Recuperare per sector (toate datele):
${JSON.stringify(contextData.recuperare_per_sector, null, 2)}

### Eliminare per sector (toate datele):
${JSON.stringify(contextData.eliminare_per_sector, null, 2)}

### Tichete respinse (toate datele):
${JSON.stringify(contextData.respinse_per_sector, null, 2)}

### Contracte active per tip:
${JSON.stringify(contextData.contracte_active_per_tip, null, 2)}

### Contracte care expiră în 60 zile:
${JSON.stringify(contextData.contracte_expira_60z, null, 2)}

### Contracte TMB:
${JSON.stringify(contextData.contracte_tmb, null, 2)}

### Contracte Colectare:
${JSON.stringify(contextData.contracte_colectare, null, 2)}

### Contracte Sortare:
${JSON.stringify(contextData.contracte_sortare, null, 2)}

### Contracte Aerob:
${JSON.stringify(contextData.contracte_aerob, null, 2)}

### Contracte Anaerob:
${JSON.stringify(contextData.contracte_anaerob, null, 2)}

### Contracte Depozitare:
${JSON.stringify(contextData.contracte_depozitare, null, 2)}

### Operatori activi:
${JSON.stringify(contextData.operatori_activi, null, 2)}

### Sectoare:
${JSON.stringify(contextData.sectoare_info, null, 2)}

## INSTRUCȚIUNI:
- Răspunde ÎNTOTDEAUNA în română, clar și concis
- Formatează cifrele lizibil (ex: 12.847 tone)
- Folosește bullet points pentru liste
- Pentru rapoarte narrative, scrie text fluid profesional pentru board ADIGIDMB
- Nu inventa cifre — folosește EXCLUSIV datele de mai sus
- Poți face calcule și comparații pe baza datelor disponibile
- Fii direct și util, fără introduceri lungi`;
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
      return res.status(500).json({ success: false, message: 'ANTHROPIC_API_KEY nu este configurat pe server' });
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