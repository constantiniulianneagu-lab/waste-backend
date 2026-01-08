// src/controllers/dashboardExportController.js
/**
 * ============================================================================
 * DASHBOARD EXPORT CONTROLLER - LANDFILL (DEPOZITARE) - 1 PAGE A4 LANDSCAPE
 * ============================================================================
 * ✅ UI-matched style (cards + area chart + light tables, like your app)
 * ✅ NO native deps (NO canvas / NO chart.js)
 * ✅ Romanian diacritics via Inter fonts (if present)
 * ✅ Filename: Raport_depozitare_YYYYMMDD_HHMMSS.pdf (Europe/Bucharest)
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
  green: "#10B981",        // emerald
  greenDark: "#059669",
  greenSoftFill: "#D1FAE5", // area fill base
  text: "#0F172A",         // slate-900
  text2: "#475569",        // slate-600
  text3: "#94A3B8",        // slate-400
  border: "#E2E8F0",       // slate-200
  bgAlt: "#F8FAFC",        // slate-50
  white: "#FFFFFF",
  shadow: "#000000",
  blue: "#3B82F6",
  amber: "#F59E0B",
  purple: "#7C3AED",
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
  const YYYY = get("year");
  const MM = get("month");
  const DD = get("day");
  const HH = get("hour");
  const mm = get("minute");
  const ss = get("second");
  return `${YYYY}${MM}${DD}_${HH}${mm}${ss}`;
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

// =====================
// MAIN EXPORT
// =====================
export const exportLandfillDashboard = async (req, res) => {
  try {
    const payload = await captureGetStats(req);
    if (!payload?.success) {
      return res.status(400).json(payload || { success: false, message: "Nu pot genera raportul." });
    }

    const data = payload.data || {};
    const filters = payload.filters_applied || {};

    const summary = data.summary || {};
    const perSector = Array.isArray(data.per_sector) ? data.per_sector : [];
    const topOperators = Array.isArray(data.top_operators) ? data.top_operators : [];
    const monthlyEvolution = Array.isArray(data.monthly_evolution) ? data.monthly_evolution : [];
    const wasteCodes = Array.isArray(data.waste_categories) ? data.waste_categories : [];

    const now = new Date();
    const generatedAt = roDateTime(now);

    // PDF
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

    // Page metrics
    const pageW = doc.page.width;
    const pageH = doc.page.height;
    const M = doc.page.margins.left;
    const contentW = pageW - M * 2;

    // =========================
    // HEADER (match your screenshot)
    // =========================
    const headerY = M;
    const headerH = 46;

    const locationText =
      filters.sector_id && filters.sector_id !== "all" ? `Sector ${filters.sector_id}` : "București";

    // Logo right (inside its own invisible box)
    const logoPath = getLogoPath();
    const logoW = 150;
    const logoBoxW = 170;
    const logoBoxH = headerH;
    const logoBoxX = pageW - M - logoBoxW;
    const logoBoxY = headerY;

    if (logoPath && fs.existsSync(logoPath)) {
      try {
        // center logo within logo box
        const imgW = logoW;
        const imgX = logoBoxX + (logoBoxW - imgW) / 2;
        const imgY = logoBoxY + 9; // visually centered
        doc.image(logoPath, imgX, imgY, { width: imgW });
      } catch {}
    }

    // Title
    doc
      .fillColor(COLORS.greenDark)
      .font(FONT_BOLD)
      .fontSize(16)
      .text("RAPORT DEPOZITARE DEȘEURI", M, headerY + 4, { width: contentW - logoBoxW - 10 });

    // Meta line (same row: location + period)
    const metaY = headerY + 24;
    doc.fillColor(COLORS.text2).font(FONT_REG).fontSize(10);

    const leftMetaW = contentW - logoBoxW - 10;
    const meta = `Locație: ${locationText}   •   `;
    doc.text(meta, M, metaY, { width: leftMetaW, continued: true });

    doc.fillColor(COLORS.text).font(FONT_BOLD).text("Perioada:", { continued: true });
    doc.fillColor(COLORS.text2).font(FONT_REG).text(` ${isoToRO(filters.from)} – ${isoToRO(filters.to)}`, {
      continued: false,
    });

    // green divider line
    doc.save();
    doc
      .moveTo(M, headerY + headerH)
      .lineTo(pageW - M, headerY + headerH)
      .lineWidth(2)
      .strokeColor(COLORS.green)
      .stroke();
    doc.restore();

    // =========================
    // KPI CARDS - match app cards style
    // =========================
    const cardsY = headerY + headerH + 12;
    const cardH = 72;
    const cardGap = 12;
    const cardW = (contentW - cardGap * 3) / 4;

    const kpis = [
      { title: "TOTAL DEȘEURI", value: summary.total_tons_formatted || "0,00", sub: "tone depozitate", accent: COLORS.green, icon: "♻︎" },
      { title: "TOTAL TICHETE", value: (summary.total_tickets || 0).toLocaleString("ro-RO"), sub: "înregistrări", accent: COLORS.blue, icon: "🗂︎" },
      { title: "MEDIE PER TICHET", value: Number(summary.avg_weight_per_ticket || 0).toFixed(2), sub: "tone / tichet", accent: COLORS.amber, icon: "⚖︎" },
      { title: "PERIOADA", value: String(summary.date_range?.days || 0), sub: "zile analizate", accent: COLORS.purple, icon: "📅" },
    ];

    kpis.forEach((k, i) => {
      const x = M + i * (cardW + cardGap);
      drawKpiCard(doc, x, cardsY, cardW, cardH, k, FONT_REG, FONT_BOLD);
    });

    // =========================
    // ROW 2: area chart (left) + waste codes table (right)
    // =========================
    const row2Y = cardsY + cardH + 12;
    const row2H = 190;
    const leftW2 = Math.floor(contentW * 0.62);
    const rightW2 = contentW - leftW2 - 12;

    // Left: area chart panel
    drawPanel(doc, M, row2Y, leftW2, row2H, FONT_REG, FONT_BOLD);
    drawAreaChart(doc, M, row2Y, leftW2, row2H, monthlyEvolution, FONT_REG, FONT_BOLD);

    // Right: waste codes table panel (Top 8) — no big title, just label
    drawPanel(doc, M + leftW2 + 12, row2Y, rightW2, row2H, FONT_REG, FONT_BOLD);
    drawCornerLabel(doc, M + leftW2 + 12, row2Y, "CODURI DEȘEU (TOP 8)", FONT_REG);
    drawWasteCodesTable(doc, M + leftW2 + 12, row2Y, rightW2, row2H, wasteCodes.slice(0, 8), FONT_REG, FONT_BOLD);

    // =========================
    // ROW 3: sectors (left) + top operators (right)
    // =========================
    const row3Y = row2Y + row2H + 10;
    const row3H = 140;
    const leftW3 = Math.floor(contentW * 0.52);
    const rightW3 = contentW - leftW3 - 12;

    drawPanel(doc, M, row3Y, leftW3, row3H, FONT_REG, FONT_BOLD);
    drawCornerLabel(doc, M, row3Y, "SECTOARE", FONT_REG);
    drawSectorsTable(doc, M, row3Y, leftW3, row3H, perSector, FONT_REG, FONT_BOLD);

    drawPanel(doc, M + leftW3 + 12, row3Y, rightW3, row3H, FONT_REG, FONT_BOLD);
    drawCornerLabel(doc, M + leftW3 + 12, row3Y, "TOP 5 OPERATORI", FONT_REG);
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
      "ℹ︎ Raport generat automat din SAMD · Reflectă filtrele aplicate la momentul exportului.",
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
    console.error("💥 Export PDF error:", error);
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: "Eroare la generarea raportului PDF", error: error.message });
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
// UI drawing primitives (rounded cards + soft shadow)
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
  // inner clip so tables never overflow rounded corners
  beginClip(doc, x, y, w, h, 18);
  // release will be handled by table/chart functions (they call endClip)
}

function drawCornerLabel(doc, x, y, label, FONT_REG) {
  doc.fillColor(COLORS.text3).font(FONT_REG).fontSize(9);
  doc.text(label, x + 14, y + 10, { width: 260 });
  // thin divider line under label
  doc.save();
  doc
    .moveTo(x + 14, y + 26)
    .lineTo(x + 14 + 260, y + 26)
    .lineWidth(1)
    .strokeColor(COLORS.border)
    .stroke();
  doc.restore();
}

// =============================================================================
// KPI card (like UI)
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

  // icon badge (right)
  const badge = 34;
  const bx = x + w - badge - 14;
  const by = y + 18;

  doc.save();
  doc.roundedRect(bx, by, badge, badge, 12).fillOpacity(0.12).fill(kpi.accent);
  doc.fillOpacity(1);
  doc.fillColor(kpi.accent).font(FONT_BOLD).fontSize(16).text(kpi.icon, bx, by + 8, { width: badge, align: "center" });
  doc.restore();
}

// =============================================================================
// Area chart (line + soft fill) - months Ian..Dec
// =============================================================================
function drawAreaChart(doc, x, y, w, h, monthlyEvolution, FONT_REG, FONT_BOLD) {
  // label (like chart title in UI)
  doc.fillColor(COLORS.text).font(FONT_BOLD).fontSize(10.5).text("Evoluție lunară a cantităților depozitate", x + 14, y + 10);
  doc.fillColor(COLORS.text3).font(FONT_REG).fontSize(8.5).text("Cantități nete (tone) pe luni", x + 14, y + 26);

  const padL = 48;
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

  // Grid (light dotted feel)
  doc.save();
  doc.lineWidth(0.6).strokeColor(COLORS.border);
  const gridLines = 4;
  for (let i = 0; i <= gridLines; i++) {
    const gy = chartY + (chartH * i) / gridLines;
    doc.moveTo(chartX, gy).lineTo(chartX + chartW, gy).stroke();
  }
  doc.restore();

  // Y labels (0, max)
  doc.fillColor(COLORS.text3).font(FONT_REG).fontSize(7.5);
  doc.text("0", x + 10, chartY + chartH - 3, { width: padL - 16, align: "right" });
  doc.text(max.toLocaleString("ro-RO"), x + 10, chartY - 4, { width: padL - 16, align: "right" });

  // X labels all months
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
    y: chartY + chartH - (v / max) * chartH,
  }));

  // area fill
  doc.save();
  doc.moveTo(pts[0].x, chartY + chartH);
  pts.forEach((p) => doc.lineTo(p.x, p.y));
  doc.lineTo(pts[pts.length - 1].x, chartY + chartH);
  doc.closePath();
  doc.fillOpacity(0.20).fill(COLORS.greenSoftFill);
  doc.fillOpacity(1);
  doc.restore();

  // line
  doc.save();
  doc.lineWidth(2);
  doc.strokeColor(COLORS.green);
  for (let i = 0; i < pts.length; i++) {
    if (i === 0) doc.moveTo(pts[i].x, pts[i].y);
    else doc.lineTo(pts[i].x, pts[i].y);
  }
  doc.stroke();

  // dots
  doc.fillColor(COLORS.white);
  doc.strokeColor(COLORS.green);
  pts.forEach((p) => doc.circle(p.x, p.y, 2.4).fillAndStroke());
  doc.restore();

  endClip(doc); // closes panel clip
}

// =============================================================================
// Tables (modern light, aligned columns, no overlaps)
// =============================================================================
function drawWasteCodesTable(doc, x, y, w, h, rows, FONT_REG, FONT_BOLD) {
  const innerX = x + 14;
  const startY = y + 34;
  const innerW = w - 28;

  // columns: Code | Tickets | Tons
  const tonsW = 78;
  const ticketsW = 76;
  const codeW = innerW - ticketsW - tonsW - 10;

  // header row (light)
  doc.fillColor(COLORS.text3).font(FONT_BOLD).fontSize(8.5);
  doc.text("Cod", innerX, startY, { width: codeW });
  doc.text("Tichete", innerX + codeW + 5, startY, { width: ticketsW, align: "right" });
  doc.text("Tone", innerX + codeW + 5 + ticketsW + 5, startY, { width: tonsW, align: "right" });

  doc.save();
  doc
    .moveTo(innerX, startY + 14)
    .lineTo(innerX + innerW, startY + 14)
    .lineWidth(1)
    .strokeColor(COLORS.border)
    .stroke();
  doc.restore();

  let cy = startY + 18;
  const rowH = 18;

  rows.forEach((r, idx) => {
    const bg = idx % 2 === 0 ? COLORS.white : COLORS.bgAlt;
    doc.rect(innerX - 6, cy - 1, innerW + 12, rowH).fill(bg);

    const code = r.waste_code || "—";
    const desc = r.waste_description || "";
    const tickets = Number(r.ticket_count || 0).toLocaleString("ro-RO");
    const tons = r.total_tons_formatted || "0,00";

    // small dot icon
    doc.circle(innerX - 2, cy + 6, 2.2).fill(COLORS.green);

    doc.fillColor(COLORS.text).font(FONT_BOLD).fontSize(9).text(code, innerX + 6, cy + 2, { width: codeW - 6 });

    if (desc) {
      const clipped = ellipsisOneLine(doc, desc, codeW - 6, FONT_REG, 7);
      doc.fillColor(COLORS.text3).font(FONT_REG).fontSize(7).text(clipped, innerX + 6, cy + 11, { width: codeW - 6 });
    }

    doc.fillColor(COLORS.text).font(FONT_REG).fontSize(9).text(tickets, innerX + codeW + 5, cy + 2, { width: ticketsW, align: "right" });
    doc.fillColor(COLORS.text).font(FONT_REG).fontSize(9).text(tons, innerX + codeW + 5 + ticketsW + 5, cy + 2, { width: tonsW, align: "right" });

    cy += rowH;
  });

  endClip(doc);
}

function drawSectorsTable(doc, x, y, w, h, sectors, FONT_REG, FONT_BOLD) {
  const rows = [...sectors].sort((a, b) => (b.total_tons || 0) - (a.total_tons || 0)).slice(0, 6);

  const innerX = x + 14;
  const startY = y + 34;
  const innerW = w - 28;

  const tonsW = 88;
  const ticketsW = 78;
  const sectorW = innerW - ticketsW - tonsW - 10;

  doc.fillColor(COLORS.text3).font(FONT_BOLD).fontSize(8.5);
  doc.text("Sector", innerX, startY, { width: sectorW });
  doc.text("Tichete", innerX + sectorW + 5, startY, { width: ticketsW, align: "right" });
  doc.text("Tone", innerX + sectorW + 5 + ticketsW + 5, startY, { width: tonsW, align: "right" });

  doc.save();
  doc
    .moveTo(innerX, startY + 14)
    .lineTo(innerX + innerW, startY + 14)
    .lineWidth(1)
    .strokeColor(COLORS.border)
    .stroke();
  doc.restore();

  let cy = startY + 18;
  const rowH = 18;

  rows.forEach((r, idx) => {
    const bg = idx % 2 === 0 ? COLORS.white : COLORS.bgAlt;
    doc.rect(innerX - 6, cy - 1, innerW + 12, rowH).fill(bg);

    doc.fillColor(COLORS.text).font(FONT_BOLD).fontSize(9).text(`S${r.sector_number}`, innerX, cy + 2, { width: sectorW });

    doc.fillColor(COLORS.text).font(FONT_REG).fontSize(9).text(
      Number(r.total_tickets || 0).toLocaleString("ro-RO"),
      innerX + sectorW + 5,
      cy + 2,
      { width: ticketsW, align: "right" }
    );

    doc.fillColor(COLORS.text).font(FONT_REG).fontSize(9).text(
      r.total_tons_formatted || "0,00",
      innerX + sectorW + 5 + ticketsW + 5,
      cy + 2,
      { width: tonsW, align: "right" }
    );

    cy += rowH;
  });

  endClip(doc);
}

function drawOperatorsTable(doc, x, y, w, h, ops, FONT_REG, FONT_BOLD) {
  const innerX = x + 14;
  const startY = y + 34;
  const innerW = w - 28;

  const tonsW = 88;
  const sectorsW = 70;
  const nameW = innerW - sectorsW - tonsW - 10;

  doc.fillColor(COLORS.text3).font(FONT_BOLD).fontSize(8.5);
  doc.text("Operator", innerX, startY, { width: nameW });
  doc.text("Sectoare", innerX + nameW + 5, startY, { width: sectorsW, align: "right" });
  doc.text("Tone", innerX + nameW + 5 + sectorsW + 5, startY, { width: tonsW, align: "right" });

  doc.save();
  doc
    .moveTo(innerX, startY + 14)
    .lineTo(innerX + innerW, startY + 14)
    .lineWidth(1)
    .strokeColor(COLORS.border)
    .stroke();
  doc.restore();

  let cy = startY + 18;
  const rowH = 18;

  ops.forEach((r, idx) => {
    const bg = idx % 2 === 0 ? COLORS.white : COLORS.bgAlt;
    doc.rect(innerX - 6, cy - 1, innerW + 12, rowH).fill(bg);

    const name = ellipsisOneLine(doc, r.institution_name || "—", nameW, FONT_BOLD, 9);
    const sectors = safeText(r.sector_numbers_display || (Array.isArray(r.sector_numbers) ? r.sector_numbers.join(", ") : "—"));
    const tons = safeText(r.total_tons_formatted || "0,00");

    doc.fillColor(COLORS.text).font(FONT_BOLD).fontSize(9).text(name, innerX, cy + 2, { width: nameW });
    doc.fillColor(COLORS.text).font(FONT_REG).fontSize(9).text(sectors, innerX + nameW + 5, cy + 2, { width: sectorsW, align: "right" });
    doc.fillColor(COLORS.text).font(FONT_REG).fontSize(9).text(tons, innerX + nameW + 5 + sectorsW + 5, cy + 2, { width: tonsW, align: "right" });

    cy += rowH;
  });

  endClip(doc);
}
