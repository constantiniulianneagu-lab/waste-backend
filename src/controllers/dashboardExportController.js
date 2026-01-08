// src/controllers/dashboardExportController.js
/**
 * ============================================================================
 * DASHBOARD EXPORT CONTROLLER - LANDFILL & TMB
 * ============================================================================
 * ✅ Landfill (Depozitare) - 1 PAGE A4 LANDSCAPE
 * ✅ TMB (Tratare Mecano-Biologică) - 1 PAGE A4 LANDSCAPE
 * ✅ UI-matched style (cards + area chart + light tables)
 * ✅ NO native deps (NO canvas / NO chart.js)
 * ✅ Romanian diacritics via Inter fonts (if present)
 * ✅ Filename: Raport_{type}_YYYYMMDD_HHMMSS.pdf (Europe/Bucharest)
 * ============================================================================
 */

import PDFDocument from "pdfkit";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import dashboardLandfillController from "./dashboardLandfillController.js";

// =====================
// THEME - match app vibe (emerald + clean neutrals)
// =====================
const COLORS = {
  green: "#10B981",
  greenDark: "#059669",
  greenSoftFill: "#D1FAE5",

  text: "#0F172A",
  text2: "#475569",
  text3: "#94A3B8",

  border: "#E2E8F0",
  bgAlt: "#F8FAFC",
  white: "#FFFFFF",
  shadow: "#000000",

  blue: "#3B82F6",
  amber: "#F59E0B",
  purple: "#7C3AED",
  purpleLight: "#A78BFA",
};

// =====================
// FORMATTERS
// =====================
const safeText = (v) => (v === null || v === undefined ? "" : String(v));

const isoToRO = (iso) => {
  if (!iso) return "-";
  const [y, m, d] = String(iso).split("-");
  if (!y || !m || !d) return String(iso);
  return `${d}.${m}.${y}`;
};

const roDateTime = (d) =>
  new Intl.DateTimeFormat("ro-RO", {
    timeZone: "Europe/Bucharest",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(d);

// YYYYMMDD_HHMMSS in Europe/Bucharest
const bucharestTimestamp = (d) => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Bucharest",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);

  const get = (t) => parts.find((p) => p.type === t)?.value || "00";
  return `${get("year")}${get("month")}${get("day")}_${get("hour")}${get("minute")}${get("second")}`;
};

const ellipsisOneLine = (doc, text, maxWidth, fontName, fontSize) => {
  const s = safeText(text).trim();
  if (!s) return "";
  doc.font(fontName).fontSize(fontSize);
  if (doc.widthOfString(s) <= maxWidth) return s;

  const ell = "…";
  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const cand = s.slice(0, mid) + ell;
    if (doc.widthOfString(cand) <= maxWidth) lo = mid + 1;
    else hi = mid;
  }
  const cut = Math.max(0, lo - 1);
  return s.slice(0, cut) + ell;
};

// nice Y labels (10k, 20k, 45.2k)
function formatAxisK(v) {
  const n = Number(v || 0);
  if (n >= 1000) {
    const k = n / 1000;
    // show integer k for clean grid
    if (Math.abs(k - Math.round(k)) < 0.0001) return `${Math.round(k)}k`;
    return `${k.toFixed(1)}k`;
  }
  return n.toLocaleString("ro-RO");
}

// choose nice tick step (1k, 2k, 5k, 10k, 20k...)
function niceStep(maxVal, ticksTarget = 4) {
  const raw = maxVal / ticksTarget;
  const pow10 = Math.pow(10, Math.floor(Math.log10(Math.max(1, raw))));
  const frac = raw / pow10;
  const niceFrac = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10;
  return niceFrac * pow10;
}

// =============================================================================
// =============================================================================
// LANDFILL EXPORT
// =============================================================================
// =============================================================================
export const exportLandfillDashboard = async (req, res) => {
  try {
    const payload = await captureGetStats(req);
    if (!payload?.success) {
      return res.status(400).json(payload || { success: false, message: "Nu pot genera raportul." });
    }

    const data = payload.data || {};
    const filters = payload.filters_applied || {};

    const summary = data.summary || {};
    const perSectorRaw = Array.isArray(data.per_sector) ? data.per_sector : [];
    const topOperators = Array.isArray(data.top_operators) ? data.top_operators : [];
    const monthlyEvolution = Array.isArray(data.monthly_evolution) ? data.monthly_evolution : [];
    const wasteCodes = Array.isArray(data.waste_categories) ? data.waste_categories : [];

    // FORCE 6 sectors always (Sectorul 1..6) — fill missing with zeros
    const perSector = normalizeAll6Sectors(perSectorRaw);

    const now = new Date();
    const generatedAt = roDateTime(now);

    const doc = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margin: 28,
      info: { Title: "Raport Depozitare Deșeuri", Author: "ADIGIDMB / SAMD" },
    });

    // Filename: Raport_depozitare_YYYYMMDD_HHMMSS.pdf
    const ts = bucharestTimestamp(now);
    const filename = `Raport_depozitare_${ts}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    doc.pipe(res);

    // Fonts (diacritics)
    const { fontRegular, fontBold } = getFonts();
    if (fs.existsSync(fontRegular) && fs.existsSync(fontBold)) {
      doc.registerFont("Inter", fontRegular);
      doc.registerFont("InterBold", fontBold);
    }
    const FONT_REG = fs.existsSync(fontRegular) ? "Inter" : "Helvetica";
    const FONT_BOLD = fs.existsSync(fontBold) ? "InterBold" : "Helvetica-Bold";

    const pageW = doc.page.width;
    const pageH = doc.page.height;
    const M = doc.page.margins.left;
    const contentW = pageW - M * 2;

    // =========================
    // HEADER (fix logo cut)
    // =========================
    const headerY = M;
    const headerH = 54;

    const locationText =
      filters.sector_id && filters.sector_id !== "all" ? `Sector ${filters.sector_id}` : "București";

    // Logo box on right
    const logoPath = getLogoPath();
    const logoBoxW = 190;
    const logoBoxX = pageW - M - logoBoxW;
    const logoBoxY = headerY;

    if (logoPath && fs.existsSync(logoPath)) {
      try {
        // fit logo INSIDE header (so divider never cuts it)
        doc.image(logoPath, logoBoxX + 8, logoBoxY + 6, {
          fit: [logoBoxW - 16, headerH - 12],
          align: "center",
          valign: "center",
        });
      } catch {}
    }

    // Title
    doc
      .fillColor(COLORS.greenDark)
      .font(FONT_BOLD)
      .fontSize(16)
      .text("RAPORT DEPOZITARE DEȘEURI", M, headerY + 6, { width: contentW - logoBoxW - 10 });

    // Meta line (Location + Period on same line) with bold labels
    const metaY = headerY + 28;
    const leftMetaW = contentW - logoBoxW - 10;

    doc.fillColor(COLORS.text).font(FONT_BOLD).fontSize(10).text("Locație:", M, metaY, {
      width: leftMetaW,
      continued: true,
    });
    doc.fillColor(COLORS.text2).font(FONT_REG).text(` ${locationText}  `, { continued: true });
    doc.fillColor(COLORS.text2).font(FONT_REG).text("•", { continued: true });
    doc.fillColor(COLORS.text).font(FONT_BOLD).text("  Perioada:", { continued: true });
    doc.fillColor(COLORS.text2).font(FONT_REG).text(` ${isoToRO(filters.from)} – ${isoToRO(filters.to)}`, {
      continued: false,
    });

    // divider line BELOW header (below logo)
    doc.save();
    doc
      .moveTo(M, headerY + headerH + 6)
      .lineTo(pageW - M, headerY + headerH + 6)
      .lineWidth(2)
      .strokeColor(COLORS.green)
      .stroke();
    doc.restore();

    // =========================
    // KPI CARDS
    // =========================
    const cardsY = headerY + headerH + 18;
    const cardH = 72;
    const cardGap = 12;
    const cardW = (contentW - cardGap * 3) / 4;

    const kpis = [
      { title: "TOTAL DEȘEURI", value: summary.total_tons_formatted || "0,00", sub: "tone depozitate", accent: COLORS.green },
      { title: "TOTAL TICHETE", value: (summary.total_tickets || 0).toLocaleString("ro-RO"), sub: "înregistrări", accent: COLORS.blue },
      { title: "MEDIE PER TICHET", value: Number(summary.avg_weight_per_ticket || 0).toFixed(2), sub: "tone / tichet", accent: COLORS.amber },
      { title: "PERIOADA", value: String(summary.date_range?.days || 0), sub: "zile analizate", accent: COLORS.purple },
    ];

    kpis.forEach((k, i) => {
      const x = M + i * (cardW + cardGap);
      drawKpiCard(doc, x, cardsY, cardW, cardH, k, FONT_REG, FONT_BOLD);
    });

    // =========================
    // ROW 2: chart left + waste codes right
    // =========================
    const row2Y = cardsY + cardH + 12;
    const row2H = 190;
    const leftW2 = Math.floor(contentW * 0.62);
    const rightW2 = contentW - leftW2 - 12;

    // Chart panel
    drawPanel(doc, M, row2Y, leftW2, row2H);
    drawAreaChart(doc, M, row2Y, leftW2, row2H, monthlyEvolution, FONT_REG, FONT_BOLD);

    // Waste codes table panel (no separate title)
    drawPanel(doc, M + leftW2 + 12, row2Y, rightW2, row2H);
    drawWasteCodesTable(doc, M + leftW2 + 12, row2Y, rightW2, row2H, wasteCodes.slice(0, 8), FONT_REG, FONT_BOLD);

    // =========================
    // ROW 3: sectors left + operators right
    // =========================
    const row3Y = row2Y + row2H + 10;
    const row3H = 140;
    const leftW3 = Math.floor(contentW * 0.52);
    const rightW3 = contentW - leftW3 - 12;

    drawPanel(doc, M, row3Y, leftW3, row3H);
    drawSectorsTable(doc, M, row3Y, leftW3, row3H, perSector, FONT_REG, FONT_BOLD);

    drawPanel(doc, M + leftW3 + 12, row3Y, rightW3, row3H);
    drawOperatorsTable(doc, M + leftW3 + 12, row3Y, rightW3, row3H, topOperators.slice(0, 5), FONT_REG, FONT_BOLD);

    // =========================
    // FOOTER
    // =========================
    const footerY = pageH - M - 16;

    doc.save();
    doc
      .moveTo(M, footerY - 6)
      .lineTo(pageW - M, footerY - 6)
      .lineWidth(1)
      .strokeColor(COLORS.border)
      .stroke();
    doc.restore();

    doc.fillColor(COLORS.text3).font(FONT_REG).fontSize(8.5).text(
      "Raport generat automat din SAMD · Reflectă filtrele aplicate la momentul exportului.",
      M,
      footerY,
      { width: contentW * 0.7, align: "left" }
    );

    doc.fillColor(COLORS.text3).font(FONT_REG).fontSize(8.5).text(
      `Generat la data: ${generatedAt}`,
      M,
      footerY,
      { width: contentW, align: "right" }
    );

    doc.end();
  } catch (error) {
    console.error("💥 Landfill Export PDF error:", error);
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: "Eroare la generarea raportului PDF", error: error.message });
    }
  }
};

// =============================================================================
// =============================================================================
// TMB EXPORT
// =============================================================================
// =============================================================================
export const exportTmbDashboard = async (req, res) => {
  try {
    const payload = await captureGetStatsTmb(req);
    if (!payload?.success) {
      return res.status(400).json(payload || { success: false, message: "Nu pot genera raportul TMB." });
    }

    const data = payload.data || {};
    const filters = payload.filters_applied || {};

    const summary = data.summary || {};
    const perSectorRaw = Array.isArray(data.per_sector) ? data.per_sector : [];
    const topOperators = Array.isArray(data.top_operators) ? data.top_operators : [];
    const monthlyEvolution = Array.isArray(data.monthly_evolution) ? data.monthly_evolution : [];
    const wasteCodes = Array.isArray(data.waste_categories) ? data.waste_categories : [];

    // FORCE 6 sectors always
    const perSector = normalizeAll6Sectors(perSectorRaw);

    const now = new Date();
    const generatedAt = roDateTime(now);

    const doc = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margin: 28,
      info: { Title: "Raport TMB", Author: "ADIGIDMB / SAMD" },
    });

    const ts = bucharestTimestamp(now);
    const filename = `Raport_TMB_${ts}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    doc.pipe(res);

    // Fonts
    const { fontRegular, fontBold } = getFonts();
    if (fs.existsSync(fontRegular) && fs.existsSync(fontBold)) {
      doc.registerFont("Inter", fontRegular);
      doc.registerFont("InterBold", fontBold);
    }
    const FONT_REG = fs.existsSync(fontRegular) ? "Inter" : "Helvetica";
    const FONT_BOLD = fs.existsSync(fontBold) ? "InterBold" : "Helvetica-Bold";

    const pageW = doc.page.width;
    const pageH = doc.page.height;
    const M = doc.page.margins.left;
    const contentW = pageW - M * 2;

    // =========================
    // HEADER
    // =========================
    const headerY = M;
    const headerH = 54;

    const locationText =
      filters.sector_id && filters.sector_id !== "all" ? `Sector ${filters.sector_id}` : "București";

    const logoPath = getLogoPath();
    const logoBoxW = 190;
    const logoBoxX = pageW - M - logoBoxW;
    const logoBoxY = headerY;

    if (logoPath && fs.existsSync(logoPath)) {
      try {
        doc.image(logoPath, logoBoxX + 8, logoBoxY + 6, {
          fit: [logoBoxW - 16, headerH - 12],
          align: "center",
          valign: "center",
        });
      } catch {}
    }

    // Title with TMB color (purple)
    doc
      .fillColor(COLORS.purple)
      .font(FONT_BOLD)
      .fontSize(16)
      .text("RAPORT TMB", M, headerY + 6, { width: contentW - logoBoxW - 10 });

    // Meta line
    const metaY = headerY + 28;
    const leftMetaW = contentW - logoBoxW - 10;

    doc.fillColor(COLORS.text).font(FONT_BOLD).fontSize(10).text("Locație:", M, metaY, {
      width: leftMetaW,
      continued: true,
    });
    doc.fillColor(COLORS.text2).font(FONT_REG).text(` ${locationText}  `, { continued: true });
    doc.fillColor(COLORS.text2).font(FONT_REG).text("•", { continued: true });
    doc.fillColor(COLORS.text).font(FONT_BOLD).text("  Perioada:", { continued: true });
    doc.fillColor(COLORS.text2).font(FONT_REG).text(` ${isoToRO(filters.start_date)} – ${isoToRO(filters.end_date)}`, {
      continued: false,
    });

    // divider
    doc.save();
    doc
      .moveTo(M, headerY + headerH + 6)
      .lineTo(pageW - M, headerY + headerH + 6)
      .lineWidth(2)
      .strokeColor(COLORS.purple)
      .stroke();
    doc.restore();

    // =========================
    // KPI CARDS - TMB SPECIFIC
    // =========================
    const cardsY = headerY + headerH + 18;
    const cardH = 72;
    const cardGap = 12;
    const cardW = (contentW - cardGap * 3) / 4;

    const kpis = [
      { 
        title: "TOTAL PRELUCRAT", 
        value: summary.tmb_total_tons_formatted || "0,00", 
        sub: "tone prelucrate TMB", 
        accent: COLORS.purple
      },
      { 
        title: "LA DEPOZIT", 
        value: summary.landfill_total_tons_formatted || "0,00", 
        sub: "tone la depozit", 
        accent: COLORS.green 
      },
      { 
        title: "TICHETE TMB", 
        value: (summary.tmb_total_tickets || 0).toLocaleString("ro-RO"), 
        sub: "înregistrări TMB", 
        accent: COLORS.blue 
      },
      { 
        title: "TICHETE DEPOZIT", 
        value: (summary.landfill_tickets_count || 0).toLocaleString("ro-RO"), 
        sub: "înregistrări depozit", 
        accent: COLORS.amber 
      },
    ];

    kpis.forEach((kpi, i) => {
      const x = M + i * (cardW + cardGap);
      drawKpiCard(doc, x, cardsY, cardW, cardH, kpi, FONT_REG, FONT_BOLD);
    });

    // =========================
    // CONTENT GRID: 2 cols
    // =========================
    const row2Y = cardsY + cardH + 12;
    const row2H = 190;
    const leftW2 = Math.floor(contentW * 0.62);
    const rightW2 = contentW - leftW2 - 12;

    // ROW 1: Chart + Waste Codes
    drawPanel(doc, M, row2Y, leftW2, row2H);
    drawTmbAreaChart(doc, M, row2Y, leftW2, row2H, monthlyEvolution, FONT_REG, FONT_BOLD);

    drawPanel(doc, M + leftW2 + 12, row2Y, rightW2, row2H);
    drawWasteCodesTable(doc, M + leftW2 + 12, row2Y, rightW2, row2H, wasteCodes.slice(0, 8), FONT_REG, FONT_BOLD);

    // ROW 2: Sectors + Operators
    const row3Y = row2Y + row2H + 10;
    const row3H = 140;
    const leftW3 = Math.floor(contentW * 0.52);
    const rightW3 = contentW - leftW3 - 12;

    drawPanel(doc, M, row3Y, leftW3, row3H);
    drawSectorsTable(doc, M, row3Y, leftW3, row3H, perSector, FONT_REG, FONT_BOLD);

    drawPanel(doc, M + leftW3 + 12, row3Y, rightW3, row3H);
    drawTmbOperatorsTable(doc, M + leftW3 + 12, row3Y, rightW3, row3H, topOperators.slice(0, 5), FONT_REG, FONT_BOLD);

    // FOOTER
    const footerY = pageH - M - 16;

    doc.save();
    doc
      .moveTo(M, footerY - 6)
      .lineTo(pageW - M, footerY - 6)
      .lineWidth(1)
      .strokeColor(COLORS.border)
      .stroke();
    doc.restore();

    doc.fillColor(COLORS.text3).font(FONT_REG).fontSize(8.5).text(
      "Raport generat automat din SAMD · Reflectă filtrele aplicate la momentul exportului.",
      M,
      footerY,
      { width: contentW * 0.7, align: "left" }
    );

    doc.fillColor(COLORS.text3).font(FONT_REG).fontSize(8.5).text(
      `Generat la data: ${generatedAt}`,
      M,
      footerY,
      { width: contentW, align: "right" }
    );

    doc.end();
  } catch (err) {
    console.error("❌ TMB Export error:", err);
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: "Eroare la generarea raportului TMB" });
    }
  }
};

// =============================================================================
// Capture getStats response (no SQL duplication)
// =============================================================================
async function captureGetStats(req) {
  return new Promise((resolve, reject) => {
    const fakeRes = {
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        resolve(payload);
      },
    };
    dashboardLandfillController.getStats(req, fakeRes).catch(reject);
  });
}

// =============================================================================
// Capture TMB stats response (no SQL duplication)
// =============================================================================
async function captureGetStatsTmb(req) {
  return new Promise(async (resolve, reject) => {
    try {
      // Import TMB controller dynamically
      const dashboardTmbController = await import('./dashboardTmbController.js');
      
      const fakeRes = {
        status(code) {
          this.statusCode = code;
          return this;
        },
        json(payload) {
          resolve(payload);
        },
      };
      
      dashboardTmbController.getTmbStats(req, fakeRes).catch(reject);
    } catch (err) {
      reject(err);
    }
  });
}

// =============================================================================
// Paths
// =============================================================================
function getFonts() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const base = path.resolve(__dirname, "../assets/fonts");
  return {
    fontRegular: path.join(base, "Inter-Regular.ttf"),
    fontBold: path.join(base, "Inter-Bold.ttf"),
  };
}

function getLogoPath() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  return path.resolve(__dirname, "../assets/branding/adigidmb.png");
}

// =============================================================================
// Card / Panel primitives
// =============================================================================
function drawCard(doc, x, y, w, h, r = 16) {
  doc.save();
  doc.roundedRect(x + 1.5, y + 2.5, w, h, r).fillOpacity(0.06).fill(COLORS.shadow);
  doc.fillOpacity(1);
  doc.roundedRect(x, y, w, h, r).fill(COLORS.white);
  doc.roundedRect(x, y, w, h, r).lineWidth(1).stroke(COLORS.border);
  doc.restore();
}

function beginClip(doc, x, y, w, h, r) {
  doc.save();
  doc.roundedRect(x, y, w, h, r).clip();
}
function endClip(doc) {
  doc.restore();
}

function drawPanel(doc, x, y, w, h) {
  drawCard(doc, x, y, w, h, 18);
  beginClip(doc, x, y, w, h, 18);
}

// =============================================================================
// KPI card (removed glyph icons; keep color only)
// =============================================================================
function drawKpiCard(doc, x, y, w, h, kpi, FONT_REG, FONT_BOLD) {
  drawCard(doc, x, y, w, h, 16);

  // left accent bar
  doc.save();
  doc.roundedRect(x, y, 5, h, 16).fill(kpi.accent);
  doc.restore();

  // title
  doc.fillColor(COLORS.text3).font(FONT_REG).fontSize(9).text(kpi.title, x + 14, y + 10, { width: w - 28 });

  // value
  doc.fillColor(kpi.accent).font(FONT_BOLD).fontSize(20).text(safeText(kpi.value), x + 14, y + 28, { width: w - 70 });

  // subtitle
  doc.fillColor(COLORS.text3).font(FONT_REG).fontSize(9).text(kpi.sub, x + 14, y + 52, { width: w - 28 });

  // right badge (NO text to avoid "No glyph")
  const badge = 34;
  const bx = x + w - badge - 14;
  const by = y + 18;

  doc.save();
  doc.roundedRect(bx, by, badge, badge, 12).fillOpacity(0.12).fill(kpi.accent);
  doc.fillOpacity(1);
  doc.restore();
}

// =============================================================================
// Area chart (line + soft fill) - LANDFILL (GREEN)
// =============================================================================
function drawAreaChart(doc, x, y, w, h, monthlyEvolution, FONT_REG, FONT_BOLD) {
  doc.fillColor(COLORS.text).font(FONT_BOLD).fontSize(10.5).text("Evoluție lunară a cantităților depozitate", x + 14, y + 10);
  doc.fillColor(COLORS.text3).font(FONT_REG).fontSize(8.5).text("Cantități nete (tone) pe luni", x + 14, y + 26);

  const padL = 54;
  const padR = 14;
  const padT = 46;
  const padB = 26;

  const chartX = x + padL;
  const chartY = y + padT;
  const chartW = w - padL - padR;
  const chartH = h - padT - padB;

  const monthsRO = ["Ian","Feb","Mar","Apr","Mai","Iun","Iul","Aug","Sep","Oct","Nov","Dec"];

  const byMonth = new Map();
  monthlyEvolution.forEach((m) => {
    const mm = Number(m.month);
    if (mm >= 1 && mm <= 12) byMonth.set(mm, Number(m.total_tons || 0));
  });
  const values = monthsRO.map((_, i) => byMonth.get(i + 1) ?? 0);
  const max = Math.max(1, ...values);

  const step = niceStep(max, 4);
  const top = Math.ceil(max / step) * step;
  const ticks = Math.max(4, Math.round(top / step));
  const lines = ticks;

  doc.save();
  doc.lineWidth(0.6).strokeColor(COLORS.border);
  doc.fillColor(COLORS.text3).font(FONT_REG).fontSize(7.5);

  for (let i = 0; i <= lines; i++) {
    const val = top - i * step;
    const gy = chartY + (chartH * i) / lines;
    doc.moveTo(chartX, gy).lineTo(chartX + chartW, gy).stroke();
    doc.text(formatAxisK(val), x + 10, gy - 4, { width: padL - 18, align: "right" });
  }
  doc.restore();

  const n = 12;
  const stepX = chartW / (n - 1);
  doc.fillColor(COLORS.text3).font(FONT_REG).fontSize(7.5);
  for (let i = 0; i < n; i++) {
    const lx = chartX + stepX * i;
    doc.text(monthsRO[i], lx - 10, chartY + chartH + 8, { width: 20, align: "center" });
  }

  const pts = values.map((v, i) => ({
    x: chartX + stepX * i,
    y: chartY + chartH - (v / top) * chartH,
  }));

  doc.save();
  doc.moveTo(pts[0].x, chartY + chartH);
  pts.forEach((p) => doc.lineTo(p.x, p.y));
  doc.lineTo(pts[pts.length - 1].x, chartY + chartH);
  doc.closePath();
  doc.fillOpacity(0.20).fill(COLORS.greenSoftFill);
  doc.fillOpacity(1);
  doc.restore();

  doc.save();
  doc.lineWidth(2);
  doc.strokeColor(COLORS.green);
  for (let i = 0; i < pts.length; i++) {
    if (i === 0) doc.moveTo(pts[i].x, pts[i].y);
    else doc.lineTo(pts[i].x, pts[i].y);
  }
  doc.stroke();
  doc.fillColor(COLORS.white);
  doc.strokeColor(COLORS.green);
  pts.forEach((p) => doc.circle(p.x, p.y, 2.4).fillAndStroke());
  doc.restore();

  endClip(doc);
}

// =============================================================================
// TMB AREA CHART (PURPLE)
// =============================================================================
function drawTmbAreaChart(doc, x, y, w, h, monthly, FONT_REG, FONT_BOLD) {
  doc.fillColor(COLORS.text).font(FONT_BOLD).fontSize(10.5).text("Evoluție lunară TMB", x + 14, y + 10);
  doc.fillColor(COLORS.text3).font(FONT_REG).fontSize(8.5).text("Cantități prelucrate (tone) pe luni", x + 14, y + 26);

  const padL = 54;
  const padR = 14;
  const padT = 46;
  const padB = 26;

  const chartX = x + padL;
  const chartY = y + padT;
  const chartW = w - padL - padR;
  const chartH = h - padT - padB;

  const monthsRO = ["Ian", "Feb", "Mar", "Apr", "Mai", "Iun", "Iul", "Aug", "Sep", "Oct", "Noi", "Dec"];
  
  const byMonth = new Map();
  monthly.forEach((m) => {
    const mm = Number(m.month);
    if (mm >= 1 && mm <= 12) byMonth.set(mm, Number(m.tmb_tons || 0));
  });
  const values = monthsRO.map((_, i) => byMonth.get(i + 1) ?? 0);
  const maxVal = Math.max(...values, 1);
  const step = niceStep(maxVal, 4);
  const top = Math.ceil(maxVal / step) * step;

  // grid + Y labels
  const ticks = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);

  doc.save();
  doc.lineWidth(0.5).strokeColor(COLORS.border);
  ticks.forEach((t) => {
    const ly = chartY + chartH - (t / top) * chartH;
    doc.moveTo(chartX, ly).lineTo(chartX + chartW, ly).stroke();
  });
  doc.restore();

  doc.fillColor(COLORS.text3).font(FONT_REG).fontSize(8);
  ticks.forEach((t) => {
    const ly = chartY + chartH - (t / top) * chartH;
    doc.text(formatAxisK(t), x + 14, ly - 4, { width: 30, align: "right" });
  });

  // X labels
  const n = 12;
  const stepX = chartW / (n - 1);
  doc.fillColor(COLORS.text3).font(FONT_REG).fontSize(7.5);
  for (let i = 0; i < n; i++) {
    const lx = chartX + stepX * i;
    doc.text(monthsRO[i], lx - 10, chartY + chartH + 8, { width: 20, align: "center" });
  }

  // points
  const pts = values.map((v, i) => ({
    x: chartX + stepX * i,
    y: chartY + chartH - (v / top) * chartH,
  }));

  // area fill (purple light)
  doc.save();
  doc.moveTo(pts[0].x, chartY + chartH);
  pts.forEach((p) => doc.lineTo(p.x, p.y));
  doc.lineTo(pts[pts.length - 1].x, chartY + chartH);
  doc.closePath();
  doc.fillOpacity(0.15).fill(COLORS.purpleLight);
  doc.fillOpacity(1);
  doc.restore();

  // line + dots (purple)
  doc.save();
  doc.lineWidth(2).strokeColor(COLORS.purple);
  for (let i = 0; i < pts.length; i++) {
    if (i === 0) doc.moveTo(pts[i].x, pts[i].y);
    else doc.lineTo(pts[i].x, pts[i].y);
  }
  doc.stroke();

  doc.fillColor(COLORS.white).strokeColor(COLORS.purple);
  pts.forEach((p) => doc.circle(p.x, p.y, 2.4).fillAndStroke());
  doc.restore();

  endClip(doc);
}

// =============================================================================
// Waste codes table (no external title)
// Header: Cod deșeu | Tichete | Cantitate (t)
// Show description under code (1 line)
// =============================================================================
function drawWasteCodesTable(doc, x, y, w, h, rows, FONT_REG, FONT_BOLD) {
  const innerX = x + 14;
  const startY = y + 16;
  const innerW = w - 28;

  const tonsW = 96;
  const ticketsW = 84;
  const codeW = innerW - ticketsW - tonsW - 10;

  // header row
  doc.fillColor(COLORS.text3).font(FONT_BOLD).fontSize(9);
  doc.text("Cod deșeu", innerX, startY, { width: codeW });
  doc.text("Tichete", innerX + codeW + 5, startY, { width: ticketsW, align: "right" });
  doc.text("Cantitate (t)", innerX + codeW + 5 + ticketsW + 5, startY, { width: tonsW, align: "right" });

  doc.save();
  doc
    .moveTo(innerX, startY + 16)
    .lineTo(innerX + innerW, startY + 16)
    .lineWidth(1)
    .strokeColor(COLORS.border)
    .stroke();
  doc.restore();

  let cy = startY + 22;
  const rowH = 26;

  rows.forEach((r, idx) => {
    const bg = idx % 2 === 0 ? COLORS.white : COLORS.bgAlt;
    doc.rect(innerX - 6, cy - 2, innerW + 12, rowH).fill(bg);

    const code = r.waste_code || "—";
    const desc = r.waste_description || "";
    const tickets = Number(r.ticket_count || 0).toLocaleString("ro-RO");
    const tons = r.total_tons_formatted || "0,00";

    // dot
    doc.circle(innerX - 2, cy + 8, 2.2).fill(COLORS.green);

    // code bigger
    doc.fillColor(COLORS.text).font(FONT_BOLD).fontSize(10).text(code, innerX + 6, cy + 2, { width: codeW - 6 });

    // description one line
    if (desc) {
      const clipped = ellipsisOneLine(doc, desc, codeW - 6, FONT_REG, 8);
      doc.fillColor(COLORS.text3).font(FONT_REG).fontSize(8).text(clipped, innerX + 6, cy + 14, { width: codeW - 6 });
    }

    doc.fillColor(COLORS.text).font(FONT_REG).fontSize(10).text(tickets, innerX + codeW + 5, cy + 4, {
      width: ticketsW,
      align: "right",
    });

    doc.fillColor(COLORS.text).font(FONT_REG).fontSize(10).text(tons, innerX + codeW + 5 + ticketsW + 5, cy + 4, {
      width: tonsW,
      align: "right",
    });

    cy += rowH;
  });

  endClip(doc);
}

// =============================================================================
// Sectors table - ALWAYS 6 rows (Sectorul 1..6)
// =============================================================================
function drawSectorsTable(doc, x, y, w, h, sectors, FONT_REG, FONT_BOLD) {
  const innerX = x + 14;
  const startY = y + 16;
  const innerW = w - 28;

  const tonsW = 110;
  const ticketsW = 90;
  const sectorW = innerW - ticketsW - tonsW - 10;

  doc.fillColor(COLORS.text3).font(FONT_BOLD).fontSize(9);
  doc.text("Sector", innerX, startY, { width: sectorW });
  doc.text("Tichete", innerX + sectorW + 5, startY, { width: ticketsW, align: "right" });
  doc.text("Cantitate (t)", innerX + sectorW + 5 + ticketsW + 5, startY, { width: tonsW, align: "right" });

  doc.save();
  doc
    .moveTo(innerX, startY + 16)
    .lineTo(innerX + innerW, startY + 16)
    .lineWidth(1)
    .strokeColor(COLORS.border)
    .stroke();
  doc.restore();

  let cy = startY + 22;
  const rowH = 18;

  sectors.forEach((r, idx) => {
    const bg = idx % 2 === 0 ? COLORS.white : COLORS.bgAlt;
    doc.rect(innerX - 6, cy - 2, innerW + 12, rowH).fill(bg);

    doc.fillColor(COLORS.text).font(FONT_BOLD).fontSize(10).text(`Sectorul ${r.sector_number}`, innerX, cy + 2, { width: sectorW });

    doc.fillColor(COLORS.text).font(FONT_REG).fontSize(10).text(
      Number(r.total_tickets || 0).toLocaleString("ro-RO"),
      innerX + sectorW + 5,
      cy + 2,
      { width: ticketsW, align: "right" }
    );

    doc.fillColor(COLORS.text).font(FONT_REG).fontSize(10).text(
      r.total_tons_formatted || "0,00",
      innerX + sectorW + 5 + ticketsW + 5,
      cy + 2,
      { width: tonsW, align: "right" }
    );

    cy += rowH;
  });

  endClip(doc);
}

// =============================================================================
// Operators table - LANDFILL
// =============================================================================
function drawOperatorsTable(doc, x, y, w, h, ops, FONT_REG, FONT_BOLD) {
  const innerX = x + 14;
  const startY = y + 16;
  const innerW = w - 28;

  const tonsW = 110;
  const sectorW = 70;
  const nameW = innerW - sectorW - tonsW - 10;

  doc.fillColor(COLORS.text3).font(FONT_BOLD).fontSize(9);
  doc.text("Operator salubrizare", innerX, startY, { width: nameW });
  doc.text("Sector", innerX + nameW + 5, startY, { width: sectorW, align: "right" });
  doc.text("Cantitate (t)", innerX + nameW + 5 + sectorW + 5, startY, { width: tonsW, align: "right" });

  doc.save();
  doc
    .moveTo(innerX, startY + 16)
    .lineTo(innerX + innerW, startY + 16)
    .lineWidth(1)
    .strokeColor(COLORS.border)
    .stroke();
  doc.restore();

  let cy = startY + 22;
  const rowH = 18;

  ops.forEach((r, idx) => {
    const bg = idx % 2 === 0 ? COLORS.white : COLORS.bgAlt;
    doc.rect(innerX - 6, cy - 2, innerW + 12, rowH).fill(bg);

    const name = ellipsisOneLine(doc, r.institution_name || "—", nameW, FONT_BOLD, 10);
    const sectors = safeText(
      r.sector_numbers_display ||
        (Array.isArray(r.sector_numbers) ? r.sector_numbers.join(", ") : "—")
    );
    const tons = safeText(r.total_tons_formatted || "0,00");

    doc.fillColor(COLORS.text).font(FONT_BOLD).fontSize(10).text(name, innerX, cy + 2, { width: nameW });
    doc.fillColor(COLORS.text).font(FONT_REG).fontSize(10).text(sectors, innerX + nameW + 5, cy + 2, { width: sectorW, align: "right" });
    doc.fillColor(COLORS.text).font(FONT_REG).fontSize(10).text(tons, innerX + nameW + 5 + sectorW + 5, cy + 2, { width: tonsW, align: "right" });

    cy += rowH;
  });

  endClip(doc);
}

// =============================================================================
// TMB OPERATORS TABLE
// =============================================================================
function drawTmbOperatorsTable(doc, x, y, w, h, ops, FONT_REG, FONT_BOLD) {
  const innerX = x + 14;
  const startY = y + 16;
  const innerW = w - 28;

  const tonsW = 110;
  const sectorW = 70;
  const nameW = innerW - sectorW - tonsW - 10;

  doc.fillColor(COLORS.text3).font(FONT_BOLD).fontSize(9);
  doc.text("Operator TMB", innerX, startY, { width: nameW });
  doc.text("Sector", innerX + nameW + 5, startY, { width: sectorW, align: "right" });
  doc.text("Cantitate (t)", innerX + nameW + 5 + sectorW + 5, startY, { width: tonsW, align: "right" });

  doc.save();
  doc
    .moveTo(innerX, startY + 16)
    .lineTo(innerX + innerW, startY + 16)
    .lineWidth(1)
    .strokeColor(COLORS.border)
    .stroke();
  doc.restore();

  let cy = startY + 22;
  const rowH = 18;

  ops.forEach((r, idx) => {
    const bg = idx % 2 === 0 ? COLORS.white : COLORS.bgAlt;
    doc.rect(innerX - 6, cy - 2, innerW + 12, rowH).fill(bg);

    const name = ellipsisOneLine(doc, r.institution_name || "—", nameW, FONT_BOLD, 10);
    const sectors = safeText(
      r.sector_numbers_display ||
        (Array.isArray(r.sector_numbers) ? r.sector_numbers.join(", ") : "—")
    );
    const tons = safeText(r.total_tons_formatted || "0,00");

    doc.fillColor(COLORS.text).font(FONT_BOLD).fontSize(10).text(name, innerX, cy + 2, { width: nameW });
    doc.fillColor(COLORS.text).font(FONT_REG).fontSize(10).text(sectors, innerX + nameW + 5, cy + 2, { width: sectorW, align: "right" });
    doc.fillColor(COLORS.text).font(FONT_REG).fontSize(10).text(tons, innerX + nameW + 5 + sectorW + 5, cy + 2, { width: tonsW, align: "right" });

    cy += rowH;
  });

  endClip(doc);
}

// =============================================================================
// Helpers: force all 6 sectors
// =============================================================================
function normalizeAll6Sectors(perSectorRaw) {
  const map = new Map();
  for (const r of perSectorRaw) {
    const sn = Number(r.sector_number);
    if (sn >= 1 && sn <= 6) map.set(sn, r);
  }

  const out = [];
  for (let sn = 1; sn <= 6; sn++) {
    const r = map.get(sn);
    out.push({
      sector_number: sn,
      total_tickets: Number(r?.total_tickets || 0),
      total_tons: Number(r?.total_tons || 0),
      total_tons_formatted: r?.total_tons_formatted || Number(r?.total_tons || 0).toLocaleString("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    });
  }
  return out;
}