import pool from '../config/database.js';

/**
 * Verifică dacă string-ul este UUID valid.
 * IMPORTANT: UUID-urile pot începe cu cifre (ex: "1b7e..."),
 * deci NU folosim parseInt înainte de acest check.
 */
function isUuid(str) {
  if (!str) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(str).trim()
  );
}

/**
 * Rezolvă sector_id din request în UUID-ul real din DB.
 * Acceptă:
 *  - UUID (prioritar)
 *  - număr sector 1–6 (DOAR dacă este numeric pur)
 */
async function resolveSectorUuid(raw) {
  const rawStr = String(raw ?? '').trim();

  // 🔴 PASUL 1 – UUID FIRST (aici era bug-ul)
  if (isUuid(rawStr)) {
    return { ok: true, sectorUuid: rawStr };
  }

  // 🔴 PASUL 2 – acceptăm DOAR numere pure
  if (/^\d+$/.test(rawStr)) {
    const sectorNumber = parseInt(rawStr, 10);

    if (sectorNumber >= 1 && sectorNumber <= 6) {
      const result = await pool.query(
        `
        SELECT id
        FROM sectors
        WHERE sector_number = $1
          AND is_active = true
          AND deleted_at IS NULL
        LIMIT 1
        `,
        [sectorNumber]
      );

      const sectorUuid = result.rows?.[0]?.id;
      if (!sectorUuid) {
        return { ok: false, code: 404, message: 'Sector inexistent' };
      }

      return { ok: true, sectorUuid };
    }
  }

  return {
    ok: false,
    code: 400,
    message: `sector_id invalid: ${rawStr}`,
  };
}

/**
 * Middleware aplicat pe rutele de rapoarte (TMB / depozitare).
 */
export async function enforceSectorAccess(req, res, next) {
  try {
    const rawSector =
      req?.query?.sector_id ??
      req?.body?.sector_id ??
      null;

    if (rawSector) {
      const resolved = await resolveSectorUuid(rawSector);

      if (!resolved.ok) {
        return res
          .status(resolved.code || 400)
          .json({ success: false, error: resolved.message });
      }

      // 🔴 AICI se setează sectorul CORECT
      req.requestedSectorUuid = resolved.sectorUuid;
    }

    return next();
  } catch (err) {
    console.error('enforceSectorAccess error:', err);
    return res
      .status(500)
      .json({ success: false, error: 'Eroare internă server.' });
  }
}
