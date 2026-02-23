// src/controllers/notificationController.js
import pool from '../config/database.js';
import { ROLES } from '../constants/roles.js';

// ============================================================================
// GET NOTIFICATIONS
// Returneaza notificari relevante pentru utilizatorul autentificat
// Tipuri:
//   urgent   - contracte care expira in < 30 zile (rosu)
//   warning  - contracte care expira in 30-60 zile, diferente tichete > 10% (galben)
//   info     - contracte inactive cu tichete recente (albastru)
// ============================================================================

export const getNotifications = async (req, res) => {
  try {
    const userRole = req.user.role;
    const notifications = [];

    // Doar PLATFORM_ADMIN si ADMIN_INSTITUTION vad notificarile de contracte
    // EDITOR_INSTITUTION si REGULATOR_VIEWER nu gestioneaza contracte
    const canSeeContracts =
      userRole === ROLES.PLATFORM_ADMIN ||
      userRole === ROLES.ADMIN_INSTITUTION;

    if (canSeeContracts) {

      // ------------------------------------------------------------------
      // 1. CONTRACTE CARE EXPIRA (toate cele 7 tabele)
      //    urgent  = < 30 zile
      //    warning = 30-60 zile
      // ------------------------------------------------------------------
      const contractTables = [
        { table: 'disposal_contracts',           label: 'Depozitare' },
        { table: 'tmb_contracts',                label: 'TMB' },
        { table: 'waste_collector_contracts',    label: 'Colectare' },
        { table: 'sorting_operator_contracts',   label: 'Sortare' },
        { table: 'aerobic_contracts',            label: 'Compostare aeroba' },
        { table: 'anaerobic_contracts',          label: 'Digestie anaeroba' },
      ];

      for (const ct of contractTables) {
        const result = await pool.query(`
          SELECT
            c.id,
            c.contract_number,
            c.contract_date_end,
            i.name AS institution_name,
            CASE
              WHEN c.contract_date_end <= CURRENT_DATE + INTERVAL '30 days' THEN 'urgent'
              ELSE 'warning'
            END AS severity,
            (c.contract_date_end - CURRENT_DATE) AS days_left
          FROM ${ct.table} c
          LEFT JOIN institutions i ON i.id = c.institution_id
          WHERE c.deleted_at IS NULL
            AND c.is_active = true
            AND c.contract_date_end IS NOT NULL
            AND c.contract_date_end >= CURRENT_DATE
            AND c.contract_date_end <= CURRENT_DATE + INTERVAL '60 days'
          ORDER BY c.contract_date_end ASC
          LIMIT 20
        `);

        result.rows.forEach(row => {
          const daysLeft = parseInt(row.days_left);
          notifications.push({
            id: `contract-expiry-${ct.table}-${row.id}`,
            type: 'contract_expiry',
            severity: row.severity,
            title: `Contract ${ct.label} expira in ${daysLeft} ${daysLeft === 1 ? 'zi' : 'zile'}`,
            message: `${row.institution_name || 'Necunoscut'} - Nr. ${row.contract_number}`,
            date_end: row.contract_date_end,
            days_left: daysLeft,
            contract_type: ct.label,
            link: '/contracts',
            created_at: new Date().toISOString(),
          });
        });
      }

      // ------------------------------------------------------------------
      // 2. CONTRACTE INACTIVE CU TICHETE IN ULTIMELE 30 ZILE
      //    info - operator trimite tichete desi contractul e inactiv
      // ------------------------------------------------------------------
      const inactiveWithTickets = await pool.query(`
        SELECT
          c.id,
          c.contract_number,
          i.name AS institution_name,
          COUNT(t.id) AS ticket_count
        FROM waste_collector_contracts c
        LEFT JOIN institutions i ON i.id = c.institution_id
        INNER JOIN waste_tickets_tmb t
          ON t.supplier_id = c.institution_id
          AND t.ticket_date >= CURRENT_DATE - INTERVAL '30 days'
        WHERE c.deleted_at IS NULL
          AND c.is_active = false
        GROUP BY c.id, c.contract_number, i.name
        HAVING COUNT(t.id) > 0
        LIMIT 10
      `);

      inactiveWithTickets.rows.forEach(row => {
        notifications.push({
          id: `inactive-contract-${row.id}`,
          type: 'inactive_contract',
          severity: 'info',
          title: 'Contract inactiv cu tichete recente',
          message: `${row.institution_name || 'Necunoscut'} - Nr. ${row.contract_number} (${row.ticket_count} tichete in ultimele 30 zile)`,
          link: '/contracts',
          created_at: new Date().toISOString(),
        });
      });

      // ------------------------------------------------------------------
      // 3. TICHETE CU DIFERENTE MARI > 10%
      //    warning - diferenta intre cantitate livrata si acceptata
      // ------------------------------------------------------------------
      const bigDiffs = await pool.query(`
        SELECT
          t.id,
          t.ticket_number,
          t.ticket_date,
          i.name AS supplier_name,
          t.delivered_quantity_tons,
          t.accepted_quantity_tons,
          ROUND(
            ((t.delivered_quantity_tons - t.accepted_quantity_tons) / NULLIF(t.delivered_quantity_tons, 0)) * 100,
            1
          ) AS diff_pct,
          'disposal' AS ticket_type
        FROM waste_tickets_disposal t
        LEFT JOIN institutions i ON i.id = t.supplier_id
        WHERE t.deleted_at IS NULL
          AND t.ticket_date >= CURRENT_DATE - INTERVAL '30 days'
          AND t.delivered_quantity_tons > 0
          AND ((t.delivered_quantity_tons - t.accepted_quantity_tons) / t.delivered_quantity_tons) > 0.10
        UNION ALL
        SELECT
          t.id,
          t.ticket_number,
          t.ticket_date,
          i.name AS supplier_name,
          t.delivered_quantity_tons,
          t.accepted_quantity_tons,
          ROUND(
            ((t.delivered_quantity_tons - t.accepted_quantity_tons) / NULLIF(t.delivered_quantity_tons, 0)) * 100,
            1
          ) AS diff_pct,
          'recycling' AS ticket_type
        FROM waste_tickets_recycling t
        LEFT JOIN institutions i ON i.id = t.supplier_id
        WHERE t.deleted_at IS NULL
          AND t.ticket_date >= CURRENT_DATE - INTERVAL '30 days'
          AND t.delivered_quantity_tons > 0
          AND ((t.delivered_quantity_tons - t.accepted_quantity_tons) / t.delivered_quantity_tons) > 0.10
        ORDER BY diff_pct DESC
        LIMIT 5
      `);

      bigDiffs.rows.forEach(row => {
        notifications.push({
          id: `diff-ticket-${row.ticket_type}-${row.id}`,
          type: 'ticket_difference',
          severity: 'warning',
          title: `Diferenta mare la tichet ${row.ticket_type === 'disposal' ? 'depozitare' : 'reciclare'}`,
          message: `${row.supplier_name || 'Necunoscut'} - Tichet ${row.ticket_number}: diferenta ${row.diff_pct}%`,
          link: '/reports',
          created_at: row.ticket_date,
        });
      });
    }

    // ------------------------------------------------------------------
    // Sorteaza: urgent > warning > info, apoi dupa data
    // ------------------------------------------------------------------
    const severityOrder = { urgent: 0, warning: 1, info: 2 };
    notifications.sort((a, b) => {
      const sA = severityOrder[a.severity] ?? 3;
      const sB = severityOrder[b.severity] ?? 3;
      if (sA !== sB) return sA - sB;
      return new Date(a.created_at) - new Date(b.created_at);
    });

    // Limiteaza la 50 de notificari
    const limited = notifications.slice(0, 50);

    const counts = {
      total: limited.length,
      urgent:  limited.filter(n => n.severity === 'urgent').length,
      warning: limited.filter(n => n.severity === 'warning').length,
      info:    limited.filter(n => n.severity === 'info').length,
    };

    return res.json({
      success: true,
      data: {
        notifications: limited,
        counts,
      },
    });

  } catch (error) {
    console.error('getNotifications error:', error);
    return res.status(500).json({
      success: false,
      message: 'Eroare la incarcarea notificarilor',
      error: error.message,
    });
  }
};