/**
 * ============================================================================
 * AI ASSISTANT CONTROLLER
 * Asistent inteligent SAMD - powered by Claude API
 * ============================================================================
 */

import pool from '../config/database.js';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL = 'claude-sonnet-4-20250514';

// ── Fetch date relevante din DB în funcție de întrebare ──────────────────────
const fetchContextData = async (userRole, visibleSectorIds, accessLevel) => {
  const sectorFilter = accessLevel === 'SECTOR' && visibleSectorIds?.length > 0;
  const sectorParam = sectorFilter ? visibleSectorIds : null;

  const results = {};

  try {
    // 1. Statistici tichete ultimele 90 zile per sector
    const ticketsQuery = sectorFilter
      ? `SELECT s.sector_number, s.sector_name,
           COUNT(wt.id) as total_tichete,
           ROUND(SUM(wt.net_weight_tons)::numeric, 2) as total_tone,
           ROUND(AVG(wt.net_weight_tons)::numeric, 2) as medie_tone
         FROM waste_tickets_landfill wt
         JOIN sectors s ON wt.sector_id = s.id
         WHERE wt.deleted_at IS NULL
           AND wt.ticket_date >= NOW() - INTERVAL '90 days'
           AND wt.sector_id = ANY($1::uuid[])
         GROUP BY s.sector_number, s.sector_name
         ORDER BY s.sector_number`
      : `SELECT s.sector_number, s.sector_name,
           COUNT(wt.id) as total_tichete,
           ROUND(SUM(wt.net_weight_tons)::numeric, 2) as total_tone,
           ROUND(AVG(wt.net_weight_tons)::numeric, 2) as medie_tone
         FROM waste_tickets_landfill wt
         JOIN sectors s ON wt.sector_id = s.id
         WHERE wt.deleted_at IS NULL
           AND wt.ticket_date >= NOW() - INTERVAL '90 days'
         GROUP BY s.sector_number, s.sector_name
         ORDER BY s.sector_number`;

    const ticketsResult = await pool.query(ticketsQuery, sectorParam ? [sectorParam] : []);
    results.statistici_depozitare_90z = ticketsResult.rows;
  } catch (e) {
    results.statistici_depozitare_90z = [];
  }

  try {
    // 2. Contracte care expiră în 60 zile
    const contractsExpQuery = `
      SELECT 'TMB' as tip, contract_number, contract_date_end,
             s.sector_number, i.short_name as operator
      FROM tmb_contracts tc
      JOIN sectors s ON tc.sector_id = s.id
      LEFT JOIN institutions i ON tc.institution_id = i.id
      WHERE tc.deleted_at IS NULL AND tc.is_active = true
        AND tc.contract_date_end BETWEEN NOW() AND NOW() + INTERVAL '60 days'
        ${sectorFilter ? 'AND tc.sector_id = ANY($1::uuid[])' : ''}
      UNION ALL
      SELECT 'Colectare' as tip, contract_number, contract_date_end,
             s.sector_number, i.short_name as operator
      FROM waste_operator_contracts wc
      JOIN sectors s ON wc.sector_id = s.id
      LEFT JOIN institutions i ON wc.institution_id = i.id
      WHERE wc.deleted_at IS NULL AND wc.is_active = true
        AND wc.contract_date_end BETWEEN NOW() AND NOW() + INTERVAL '60 days'
        ${sectorFilter ? 'AND wc.sector_id = ANY($1::uuid[])' : ''}
      ORDER BY contract_date_end ASC
      LIMIT 20
    `;
    const expResult = await pool.query(contractsExpQuery, sectorParam ? [sectorParam] : []);
    results.contracte_expira_60z = expResult.rows;
  } catch (e) {
    results.contracte_expira_60z = [];
  }

  try {
    // 3. Contracte active per tip
    const activeQuery = `
      SELECT 'TMB' as tip, COUNT(*) as numar
      FROM tmb_contracts WHERE deleted_at IS NULL AND is_active = true
      UNION ALL
      SELECT 'Colectare', COUNT(*) FROM waste_operator_contracts WHERE deleted_at IS NULL AND is_active = true
      UNION ALL
      SELECT 'Sortare', COUNT(*) FROM sorting_operator_contracts WHERE deleted_at IS NULL AND is_active = true
      UNION ALL
      SELECT 'Aerob', COUNT(*) FROM aerobic_contracts WHERE deleted_at IS NULL AND is_active = true
      UNION ALL
      SELECT 'Anaerob', COUNT(*) FROM anaerobic_contracts WHERE deleted_at IS NULL AND is_active = true
      UNION ALL
      SELECT 'Depozitare', COUNT(*) FROM disposal_contracts WHERE deleted_at IS NULL AND is_active = true
    `;
    const activeResult = await pool.query(activeQuery);
    results.contracte_active = activeResult.rows;
  } catch (e) {
    results.contracte_active = [];
  }

  try {
    // 4. Discrepanțe cantitate livrată vs acceptată (TMB, ultimele 90 zile)
    const discrepQuery = `
      SELECT i.short_name as operator, s.sector_number,
             COUNT(*) as tichete,
             ROUND(SUM(wt.gross_weight_tons - wt.net_weight_tons)::numeric, 2) as total_discrepanta_tone,
             ROUND(AVG(wt.gross_weight_tons - wt.net_weight_tons)::numeric, 3) as medie_discrepanta
      FROM waste_tickets_tmb wt
      JOIN sectors s ON wt.sector_id = s.id
      LEFT JOIN institutions i ON wt.operator_id = i.id
      WHERE wt.deleted_at IS NULL
        AND wt.ticket_date >= NOW() - INTERVAL '90 days'
        AND wt.gross_weight_tons IS NOT NULL
        AND wt.net_weight_tons IS NOT NULL
        AND (wt.gross_weight_tons - wt.net_weight_tons) > 0.1
        ${sectorFilter ? 'AND wt.sector_id = ANY($1::uuid[])' : ''}
      GROUP BY i.short_name, s.sector_number
      ORDER BY total_discrepanta_tone DESC
      LIMIT 10
    `;
    const discrepResult = await pool.query(discrepQuery, sectorParam ? [sectorParam] : []);
    results.discrepante_operatori = discrepResult.rows;
  } catch (e) {
    results.discrepante_operatori = [];
  }

  try {
    // 5. Total general ultimele 12 luni per luna
    const monthlyQuery = sectorFilter
      ? `SELECT TO_CHAR(ticket_date, 'YYYY-MM') as luna,
               ROUND(SUM(net_weight_tons)::numeric, 2) as tone
         FROM waste_tickets_landfill
         WHERE deleted_at IS NULL
           AND ticket_date >= NOW() - INTERVAL '12 months'
           AND sector_id = ANY($1::uuid[])
         GROUP BY luna ORDER BY luna`
      : `SELECT TO_CHAR(ticket_date, 'YYYY-MM') as luna,
               ROUND(SUM(net_weight_tons)::numeric, 2) as tone
         FROM waste_tickets_landfill
         WHERE deleted_at IS NULL
           AND ticket_date >= NOW() - INTERVAL '12 months'
         GROUP BY luna ORDER BY luna`;
    const monthlyResult = await pool.query(monthlyQuery, sectorParam ? [sectorParam] : []);
    results.evolutie_lunara = monthlyResult.rows;
  } catch (e) {
    results.evolutie_lunara = [];
  }

  return results;
};

// ── Build system prompt cu datele din DB ─────────────────────────────────────
const buildSystemPrompt = (contextData, userRole) => {
  const today = new Date().toLocaleDateString('ro-RO', {
    year: 'numeric', month: 'long', day: 'numeric'
  });

  return `Ești SAMD Assistant, un asistent inteligent integrat în platforma SAMD (Sistema de Administrare și Monitorizare a Deșeurilor) pentru ADIGIDMB București.

Data de astăzi: ${today}
Rolul utilizatorului: ${userRole}

## DATE REALE DIN SISTEM (actualizate acum):

### Statistici depozitare - ultimele 90 zile (per sector):
${JSON.stringify(contextData.statistici_depozitare_90z, null, 2)}

### Contracte care expiră în următoarele 60 zile:
${JSON.stringify(contextData.contracte_expira_60z, null, 2)}

### Contracte active per tip:
${JSON.stringify(contextData.contracte_active, null, 2)}

### Discrepanțe cantitate (ultimele 90 zile):
${JSON.stringify(contextData.discrepante_operatori, null, 2)}

### Evoluție lunară depozitare (12 luni):
${JSON.stringify(contextData.evolutie_lunara, null, 2)}

## INSTRUCȚIUNI:
- Răspunde ÎNTOTDEAUNA în română, clar și concis
- Când dai cifre, formatează-le lizibil (ex: 12.847 tone)
- Când listezi mai multe elemente, folosește bullet points
- Pentru rapoarte narrative (cerute explicit), scrie text fluid profesional potrivit pentru prezentări board
- Dacă datele din sistem nu conțin informația cerută, spune că nu ai date suficiente pentru perioada/sectorul respectiv
- Nu inventa cifre — folosește EXCLUSIV datele de mai sus
- Fii direct și util, fără introduceri lungi`;
};

// ============================================================================
// POST /api/ai/chat
// ============================================================================
export const aiChat = async (req, res) => {
  try {
    const { messages } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'messages[] este obligatoriu'
      });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        success: false,
        message: 'ANTHROPIC_API_KEY nu este configurat pe server'
      });
    }

    // Fetch date din DB
    const { visibleSectorIds, accessLevel } = req.userAccess || {};
    const contextData = await fetchContextData(req.user.role, visibleSectorIds, accessLevel);
    const systemPrompt = buildSystemPrompt(contextData, req.user.role);

    // Apel Claude API
    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 1024,
        system: systemPrompt,
        messages: messages.map(m => ({
          role: m.role,
          content: m.content,
        })),
      }),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      console.error('Claude API error:', errData);
      return res.status(502).json({
        success: false,
        message: 'Eroare la comunicarea cu Claude API',
      });
    }

    const data = await response.json();
    const reply = data.content?.[0]?.text || 'Nu am putut genera un răspuns.';

    res.json({ success: true, reply });
  } catch (error) {
    console.error('AI chat error:', error);
    res.status(500).json({
      success: false,
      message: 'Eroare internă la procesarea cererii AI',
    });
  }
};