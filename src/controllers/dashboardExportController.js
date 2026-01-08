// src/controllers/dashboardExportController.js
/**
 * ============================================================================
 * DASHBOARD EXPORT CONTROLLER - LANDFILL (DEPOZITARE) - 1 PAGE A4 LANDSCAPE
 * ============================================================================
 * ✅ NO native deps (NO canvas / NO chart.js)
 *
 * Changes requested:
 * - Tables are clipped inside rounded container (no overflow outside rounded corners)
 * - Line chart (not bar chart)
 * - All months displayed (Jan..Dec) with small labels
 * - Waste code description: SINGLE LINE with ellipsis
 * - Header: Location line under title, before Period line
 * - Table headers: remove blue; use eco-neutral palette
 * - Icons: replace emoji with simple outline vector icons drawn with PDFKit
 * ============================================================================
 */

import PDFDocument from "pdfkit";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import dashboardLandfillController from "./dashboardLandfillController.js";

// =====================
// ECO / WASTE PALETTE (no blue headers)
// =====================
const COLORS = {
  // eco / waste domain
  forest: "#1F4D3A",      // titles, strong accents (deep green)
  emerald: "#2E7D32",     // positive accent
  olive: "#6B7B2C",       // secondary accent
  anthracite: "#2A2A2A",  // main text
  slate: "#475569",       // secondary text
  grid: "#DADADA",        // borders
  soft: "#F6F7F8",        // zebra rows
  white: "#FFFFFF",
  panel: "#FFFFFF",
  headerLine: "#2E7D32",
};

// =====================
// FORMATTERS
// =====================
const formatDateRO = (iso) => {
  if (!iso) return "-";
  const [y, m, d] = String(iso).split("-");
  if (!y || !m || !d) return String(iso);
  return `${d}.${m}.${y}`;
};

const formatDateTimeROWithSeconds = (d) =>
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

const safeText = (v) => (v === null || v === undefined ? "" : String(v));

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

    const generatedAt = formatDateTimeROWithSeconds(new Date());

    // PDF
    const doc = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margin: 28,
      info: { Title: "Raport Depozitare Deșeuri", Author: "ADIGIDMB / SAMD" },
    });

    const filename = `raport-depozitare-${filters.from || "start"}-${filters.to || "end"}.pdf`;
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
    const headerH = 64;

    const locationText =
      filters.sector_id && filters.sector_id !== "all" ? `Sector ${filters.sector_id}` : "București";

    const title = "RAPORT DEPOZITARE DEȘEURI";

    // Logo right only (proportional)
    const logoPath = getLogoPath();
    if (logoPath && fs.existsSync(logoPath)) {
      try {
        const logoW = 140;
        doc.image(logoPath, pageW - M - logoW, headerY + 6, { width: logoW });
      } catch {}
    }

    // Title
    doc.fillColor(COLORS.forest).font(FONT_BOLD).fontSize(18).text(title, M, headerY, {
      width: contentW - 160,
    });

    // Location line under title (before period)
    doc.fillColor(COLORS.slate).font(FONT_REG).fontSize(10.5).text(`Locație: ${locationText}`, M, headerY + 22, {
      width: contentW - 160,
    });

    // Period line (bold label + :)
    const periodLabel = "Perioada:";
    const periodValue = `${formatDateRO(filters.from)} – ${formatDateRO(filters.to)}`;
    doc.fillColor(COLORS.anthracite).font(FONT_BOLD).fontSize(10.5).text(periodLabel, M, headerY + 40, {
      continued: true,
    });
    doc.fillColor(COLORS.anthracite).font(FONT_REG).fontSize(10.5).text(` ${periodValue}`, {
      continued: false,
    });

    // Separator line (emerald)
    doc.save();
    doc
      .moveTo(M, headerY + headerH)
      .lineTo(pageW - M, headerY + headerH)
      .lineWidth(1.5)
      .strokeColor(COLORS.headerLine)
      .stroke();
    doc.restore();

    // =========================
    // ROW 1: KPI CARDS (4) with vector icons
    // =========================
    const cardsY = headerY + headerH + 12;
    const cardH = 72;
    const cardGap = 12;
    const cardW = (contentW - cardGap * 3) / 4;

    const kpis = [
      {
        title: "TOTAL DEȘEURI",
        value: summary.total_tons_formatted || "0.00",
        sub: "tone depozitate",
        icon: "recycle",
        accent: COLORS.emerald,
      },
      {
        title: "TICHETE",
        value: (summary.total_tickets || 0).toLocaleString("ro-RO"),
        sub: "înregistrări",
        icon: "tickets",
        accent: COLORS.olive,
      },
      {
        title: "MEDIE TICHET",
        value: Number(summary.avg_weight_per_ticket || 0).toFixed(2),
        sub: "tone / tichet",
        icon: "chart",
        accent: COLORS.emerald,
      },
      {
        title: "ZILE ANALIZATE",
        value: String(summary.date_range?.days || 0),
        sub: "zile",
        icon: "calendar",
        accent: COLORS.slate,
      },
    ];

    kpis.forEach((k, i) => {
      const x = M + i * (cardW + cardGap);
      drawKpiCard(doc, x, cardsY, cardW, cardH, k, FONT_REG, FONT_BOLD);
    });

    // =========================
    // ROW 2: LEFT line chart | RIGHT waste codes table
    // =========================
    const row2Y = cardsY + cardH + 12;
    const boxH2 = 188;
    const leftW2 = Math.floor(contentW * 0.62);
    const rightW2 = contentW - leftW2 - 12;

    // Left chart (LINE)
    drawPanel(doc, M, row2Y, leftW2, boxH2, "Cantități depozitate lunar (tone)", FONT_REG, FONT_BOLD, {
      titleIcon: "chart",
    });
    drawMonthlyLineChart(
      doc,
      M + 10,
      row2Y + 30,
      leftW2 - 20,
      boxH2 - 42,
      monthlyEvolution,
      FONT_REG,
      FONT_BOLD
    );

    // Right: codes (Top 8) — description 1 line ellipsis
    drawWasteCodesTable(doc, M + leftW2 + 12, row2Y, rightW2, boxH2, wasteCodes.slice(0, 8), FONT_REG, FONT_BOLD);

    // =========================
    // ROW 3: LEFT sectors | RIGHT operators
    // =========================
    const row3Y = row2Y + boxH2 + 10;
    const boxH3 = 138;
    const leftW3 = Math.floor(contentW * 0.52);
    const rightW3 = contentW - leftW3 - 12;

    drawSectorsTable(doc, M, row3Y, leftW3, boxH3, perSector, FONT_REG, FONT_BOLD);
    drawTopOperatorsTable(doc, M + leftW3 + 12, row3Y, rightW3, boxH3, topOperators.slice(0, 5), FONT_REG, FONT_BOLD);

    // =========================
    // FOOTER (date only)
    // =========================
    const footerY = pageH - M - 18;

    doc.save();
    doc
      .moveTo(M, footerY - 6)
      .lineTo(pageW - M, footerY - 6)
      .lineWidth(1)
      .strokeColor(COLORS.grid)
      .stroke();
    doc.restore();

    // left info
    doc.fillColor(COLORS.slate).font(FONT_REG).fontSize(8.5).text("ℹ︎", M, footerY, { continued: true });
    doc
      .fillColor(COLORS.slate)
      .font(FONT_REG)
      .fontSize(8.5)
      .text(" Raport generat automat din SAMD · Reflectă filtrele aplicate la momentul exportului.", {
        continued: false,
      });

    // right date only
    doc
      .fillColor(COLORS.slate)
      .font(FONT_REG)
      .fontSize(8.5)
      .text(`Generat la data: ${generatedAt}`, M, footerY, { width: contentW, align: "right" });

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
// VECTOR ICONS (outline-ish) drawn with PDFKit
// =============================================================================
function drawIcon(doc, name, x, y, size, color) {
  doc.save();
  doc.lineWidth(1.2);
  doc.strokeColor(color);
  doc.fillColor(color);

  const s = size;
  const cx = x + s / 2;
  const cy = y + s / 2;

  if (name === "recycle") {
    // simple circular arrows (minimal)
    doc.circle(cx, cy, s * 0.33).stroke();
    doc
      .moveTo(cx + s * 0.33, cy)
      .lineTo(cx + s * 0.18, cy - s * 0.08)
      .stroke();
    doc
      .moveTo(cx + s * 0.33, cy)
      .lineTo(cx + s * 0.18, cy + s * 0.08)
      .stroke();
  } else if (name === "tickets") {
    // ticket outline
    const w = s * 0.78;
    const h = s * 0.46;
    const tx = cx - w / 2;
    const ty = cy - h / 2;
    doc.roundedRect(tx, ty, w, h, 4).stroke();
    // notch
    doc.circle(tx, cy, 3).fill(COLORS.white).stroke();
    doc.circle(tx + w, cy, 3).fill(COLORS.white).stroke();
    // divider
    doc.moveTo(tx + w * 0.6, ty + 4).lineTo(tx + w * 0.6, ty + h - 4).stroke();
  } else if (name === "chart") {
    // mini line chart
    const px = x + s * 0.12;
    const py = y + s * 0.75;
    doc.moveTo(px, py).lineTo(px, y + s * 0.18).stroke();
    doc.moveTo(px, py).lineTo(x + s * 0.86, py).stroke();
    doc
      .moveTo(px + s * 0.1, py - s * 0.1)
      .lineTo(px + s * 0.28, py - s * 0.28)
      .lineTo(px + s * 0.48, py - s * 0.18)
      .lineTo(px + s * 0.72, py - s * 0.42)
      .stroke();
  } else if (name === "calendar") {
    // calendar outline
    const w = s * 0.76;
    const h = s * 0.62;
    const tx = cx - w / 2;
    const ty = cy - h / 2;
    doc.roundedRect(tx, ty, w, h, 4).stroke();
    doc.rect(tx, ty, w, h * 0.25).stroke();
    doc.moveTo(tx + w * 0.2, ty - 2).lineTo(tx + w * 0.2, ty + 6).stroke();
    doc.moveTo(tx + w * 0.8, ty - 2).lineTo(tx + w * 0.8, ty + 6).stroke();
  }

  doc.restore();
}

// =============================================================================
// Panels & Cards
// =============================================================================
function drawPanel(doc, x, y, w, h, title, FONT_REG, FONT_BOLD, opts = {}) {
  const radius = 12;

  // panel with subtle shadow
  doc.save();
  doc.roundedRect(x + 2, y + 2, w, h, radius).fillOpacity(0.08).fill("#000000");
  doc.fillOpacity(1);
  doc.roundedRect(x, y, w, h, radius).fill(COLORS.panel);
  doc.roundedRect(x, y, w, h, radius).stroke(COLORS.grid);

  // Title row (icon + title)
  const titleX = x + 10;
  const titleY = y + 8;

  if (opts.titleIcon) {
    drawIcon(doc, opts.titleIcon, titleX, titleY + 1, 14, COLORS.emerald);
    doc.fillColor(COLORS.forest).font(FONT_BOLD).fontSize(10).text(title, titleX + 18, titleY, { width: w - 28 });
  } else {
    doc.fillColor(COLORS.forest).font(FONT_BOLD).fontSize(10).text(title, titleX, titleY, { width: w - 20 });
  }

  // separator
  doc
    .moveTo(x + 10, y + 24)
    .lineTo(x + w - 10, y + 24)
    .lineWidth(1)
    .strokeColor(COLORS.grid)
    .stroke();
  doc.restore();
}

function drawKpiCard(doc, x, y, w, h, kpi, FONT_REG, FONT_BOLD) {
  const radius = 14;

  doc.save();
  doc.roundedRect(x + 2, y + 2, w, h, radius).fillOpacity(0.10).fill("#000000");
  doc.fillOpacity(1);

  doc.roundedRect(x, y, w, h, radius).fill(COLORS.white);
  doc.roundedRect(x, y, w, h, radius).stroke(COLORS.grid);

  // icon circle
  const cx = x + 22;
  const cy = y + 24;
  doc.circle(cx, cy, 16).strokeColor(COLORS.grid).lineWidth(1).stroke();
  drawIcon(doc, kpi.icon, cx - 10, cy - 10, 20, kpi.accent);

  // title
  doc.fillColor(COLORS.slate).font(FONT_REG).fontSize(9).text(kpi.title, x + 48, y + 10, {
    width: w - 56,
  });

  // value
  doc.fillColor(COLORS.forest).font(FONT_BOLD).fontSize(18).text(safeText(kpi.value), x + 48, y + 28, {
    width: w - 56,
  });

  // sub
  doc.fillColor(COLORS.slate).font(FONT_REG).fontSize(9).text(kpi.sub, x + 48, y + 54, {
    width: w - 56,
  });

  doc.restore();
}

// =============================================================================
// Tables (CLIPPED inside rounded panel)
// =============================================================================
function beginClipRounded(doc, x, y, w, h, r) {
  doc.save();
  doc.roundedRect(x, y, w, h, r).clip();
}

function endClipRounded(doc) {
  doc.restore();
}

function drawTableHeaderEco(doc, x, y, w, h, cols, FONT_BOLD) {
  // eco-neutral header (NO blue): light gray bg + forest text
  doc.save();
  doc.rect(x, y, w, h).fill("#EEF2F3");
  doc.font(FONT_BOLD).fontSize(9).fillColor(COLORS.forest);

  cols.forEach((c) => {
    doc.text(c.text, c.x, y + 6, { width: c.w, align: c.align || "left" });
  });

  // bottom border
  doc
    .moveTo(x, y + h)
    .lineTo(x + w, y + h)
    .lineWidth(1)
    .strokeColor(COLORS.grid)
    .stroke();

  doc.restore();
}

function drawWasteCodesTable(doc, x, y, w, h, rows, FONT_REG, FONT_BOLD) {
  const radius = 12;
  drawPanel(doc, x, y, w, h, "Coduri deșeu depozitate (Top 8)", FONT_REG, FONT_BOLD, { titleIcon: "recycle" });

  // clip content inside rounded panel
  beginClipRounded(doc, x, y, w, h, radius);

  const tableX = x + 10;
  const tableY = y + 32;
  const tableW = w - 20;

  const tonsW = 92;
  const ticketsW = 82;
  const codeW = tableW - ticketsW - tonsW - 10;

  const cols = [
    { text: "Cod", x: tableX, w: codeW, align: "left" },
    { text: "Tichete", x: tableX + codeW + 5, w: ticketsW, align: "right" },
    { text: "Cantitate (t)", x: tableX + codeW + 5 + ticketsW + 5, w: tonsW, align: "right" },
  ];

  drawTableHeaderEco(doc, tableX, tableY, tableW, 22, cols, FONT_BOLD);

  let cy = tableY + 22;
  const rowH = 22;

  rows.forEach((r, idx) => {
    const bg = idx % 2 === 0 ? COLORS.white : COLORS.soft;

    doc.rect(tableX, cy, tableW, rowH).fill(bg);
    doc.rect(tableX, cy, tableW, rowH).strokeColor(COLORS.grid).lineWidth(0.5).stroke();

    const code = r.waste_code || "—";
    const desc = r.waste_description || "";
    const tickets = Number(r.ticket_count || 0).toLocaleString("ro-RO");
    const tons = r.total_tons_formatted || "0.00";

    // icon (small recycle outline) at left of code
    drawIcon(doc, "recycle", tableX + 6, cy + 5, 12, COLORS.emerald);

    // code
    doc.fillColor(COLORS.anthracite).font(FONT_BOLD).fontSize(9).text(code, tableX + 22, cy + 4, {
      width: codeW - 24,
      ellipsis: true,
    });

    // description: ONE LINE with ellipsis (tiny gray)
    if (desc) {
      const clipped = ellipsisOneLine(doc, desc, codeW - 24, FONT_REG, 7.2);
      doc.fillColor("#9aa4b2").font(FONT_REG).fontSize(7.2).text(clipped, tableX + 22, cy + 13, {
        width: codeW - 24,
      });
    }

    // numbers
    doc.fillColor(COLORS.anthracite).font(FONT_REG).fontSize(9).text(tickets, cols[1].x, cy + 6, {
      width: cols[1].w,
      align: "right",
    });

    doc.fillColor(COLORS.anthracite).font(FONT_REG).fontSize(9).text(tons, cols[2].x, cy + 6, {
      width: cols[2].w,
      align: "right",
    });

    cy += rowH;
  });

  endClipRounded(doc);
}

function drawSectorsTable(doc, x, y, w, h, sectors, FONT_REG, FONT_BOLD) {
  const radius = 12;
  drawPanel(doc, x, y, w, h, "Distribuția pe sectoare", FONT_REG, FONT_BOLD, { titleIcon: "chart" });

  beginClipRounded(doc, x, y, w, h, radius);

  const rows = [...sectors].sort((a, b) => (b.total_tons || 0) - (a.total_tons || 0)).slice(0, 6);

  const tableX = x + 10;
  const tableY = y + 32;
  const tableW = w - 20;

  const tonsW = 92;
  const ticketsW = 82;
  const sectorW = tableW - ticketsW - tonsW - 10;

  const cols = [
    { text: "Sector", x: tableX, w: sectorW, align: "left" },
    { text: "Tichete", x: tableX + sectorW + 5, w: ticketsW, align: "right" },
    { text: "Cantitate (t)", x: tableX + sectorW + 5 + ticketsW + 5, w: tonsW, align: "right" },
  ];

  drawTableHeaderEco(doc, tableX, tableY, tableW, 22, cols, FONT_BOLD);

  let cy = tableY + 22;
  const rowH = 18.5;

  rows.forEach((r, idx) => {
    const bg = idx % 2 === 0 ? COLORS.white : COLORS.soft;

    doc.rect(tableX, cy, tableW, rowH).fill(bg);
    doc.rect(tableX, cy, tableW, rowH).strokeColor(COLORS.grid).lineWidth(0.5).stroke();

    const label = `Sector ${r.sector_number}`;
    const tickets = Number(r.total_tickets || 0).toLocaleString("ro-RO");
    const tons = r.total_tons_formatted || "0.00";

    // small sector icon (calendar-ish not good; reuse "tickets" as marker)
    drawIcon(doc, "tickets", tableX + 6, cy + 3, 12, COLORS.olive);

    doc.fillColor(COLORS.anthracite).font(FONT_BOLD).fontSize(9).text(label, tableX + 22, cy + 4, {
      width: sectorW - 24,
      ellipsis: true,
    });

    doc.fillColor(COLORS.anthracite).font(FONT_REG).fontSize(9).text(tickets, cols[1].x, cy + 4, {
      width: cols[1].w,
      align: "right",
    });

    doc.fillColor(COLORS.anthracite).font(FONT_REG).fontSize(9).text(tons, cols[2].x, cy + 4, {
      width: cols[2].w,
      align: "right",
    });

    cy += rowH;
  });

  endClipRounded(doc);
}

function drawTopOperatorsTable(doc, x, y, w, h, ops, FONT_REG, FONT_BOLD) {
  const radius = 12;
  drawPanel(doc, x, y, w, h, "Top 5 operatori", FONT_REG, FONT_BOLD, { titleIcon: "tickets" });

  beginClipRounded(doc, x, y, w, h, radius);

  const tableX = x + 10;
  const tableY = y + 32;
  const tableW = w - 20;

  const tonsW = 92;
  const sectorsW = 78;
  const opW = tableW - sectorsW - tonsW - 10;

  const cols = [
    { text: "Operator", x: tableX, w: opW, align: "left" },
    { text: "Sectoare", x: tableX + opW + 5, w: sectorsW, align: "right" },
    { text: "Cantitate (t)", x: tableX + opW + 5 + sectorsW + 5, w: tonsW, align: "right" },
  ];

  drawTableHeaderEco(doc, tableX, tableY, tableW, 22, cols, FONT_BOLD);

  let cy = tableY + 22;
  const rowH = 18.5;

  ops.forEach((r, idx) => {
    const bg = idx % 2 === 0 ? COLORS.white : COLORS.soft;

    doc.rect(tableX, cy, tableW, rowH).fill(bg);
    doc.rect(tableX, cy, tableW, rowH).strokeColor(COLORS.grid).lineWidth(0.5).stroke();

    const name = safeText(r.institution_name || "—");
    const sectors =
      safeText(r.sector_numbers_display) ||
      (Array.isArray(r.sector_numbers) ? r.sector_numbers.join(", ") : "") ||
      "—";
    const tons = safeText(r.total_tons_formatted || "0.00");

    // operator icon
    drawIcon(doc, "chart", tableX + 6, cy + 3, 12, COLORS.emerald);

    // operator name (one line ellipsis)
    const name1 = ellipsisOneLine(doc, name, opW - 24, FONT_BOLD, 9);
    doc.fillColor(COLORS.anthracite).font(FONT_BOLD).fontSize(9).text(name1, tableX + 22, cy + 4, {
      width: opW - 24,
    });

    doc.fillColor(COLORS.anthracite).font(FONT_REG).fontSize(9).text(sectors, cols[1].x, cy + 4, {
      width: cols[1].w,
      align: "right",
    });

    doc.fillColor(COLORS.anthracite).font(FONT_REG).fontSize(9).text(tons, cols[2].x, cy + 4, {
      width: cols[2].w,
      align: "right",
    });

    cy += rowH;
  });

  endClipRounded(doc);
}

// =============================================================================
// LINE CHART drawn with PDFKit (no canvas)
// - shows ALL month labels (Jan..Dec)
// =============================================================================
function drawMonthlyLineChart(doc, x, y, w, h, monthlyEvolution, FONT_REG, FONT_BOLD) {
  const padL = 40; // increased so Y labels never cut
  const padR = 10;
  const padT = 10;
  const padB = 22;

  const chartX = x + padL;
  const chartY = y + padT;
  const chartW = w - padL - padR;
  const chartH = h - padT - padB;

  // Normalize: ensure we have 12 months (labels + values)
  // monthlyEvolution from API is already chronological; we’ll map by month if possible.
  const monthsRO = ["Ian", "Feb", "Mar", "Apr", "Mai", "Iun", "Iul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const byMonth = new Map();
  monthlyEvolution.forEach((m) => {
    const mm = Number(m.month);
    if (mm >= 1 && mm <= 12) byMonth.set(mm, Number(m.total_tons || 0));
  });

  const values = monthsRO.map((_, i) => byMonth.get(i + 1) ?? 0);
  const labels = monthsRO;

  const max = Math.max(1, ...values);

  // grid
  doc.save();
  doc.lineWidth(0.5).strokeColor(COLORS.lightGray);
  const gridLines = 4;
  for (let i = 0; i <= gridLines; i++) {
    const gy = chartY + (chartH * i) / gridLines;
    doc.moveTo(chartX, gy).lineTo(chartX + chartW, gy).stroke();
  }
  doc.restore();

  // Y labels (0 and max)
  doc.fillColor(COLORS.slate).font(FONT_REG).fontSize(7);
  doc.text("0", x + 6, chartY + chartH - 4, { width: padL - 10, align: "left" });
  doc.text(max.toLocaleString("ro-RO"), x + 6, chartY - 3, { width: padL - 10, align: "left" });

  // X labels (ALL months)
  const n = labels.length;
  const stepX = n > 1 ? chartW / (n - 1) : chartW;

  doc.fillColor(COLORS.slate).font(FONT_REG).fontSize(7);
  for (let i = 0; i < n; i++) {
    const lx = chartX + stepX * i;
    doc.text(labels[i], lx - 10, chartY + chartH + 6, { width: 20, align: "center" });
  }

  // Build points
  const pts = values.map((v, i) => {
    const px = chartX + stepX * i;
    const py = chartY + chartH - (v / max) * chartH;
    return { x: px, y: py, v };
  });

  // line
  doc.save();
  doc.lineWidth(2);
  doc.strokeColor(COLORS.emerald);
  for (let i = 0; i < pts.length; i++) {
    if (i === 0) doc.moveTo(pts[i].x, pts[i].y);
    else doc.lineTo(pts[i].x, pts[i].y);
  }
  doc.stroke();

  // points
  doc.fillColor(COLORS.white);
  doc.strokeColor(COLORS.emerald);
  pts.forEach((p) => {
    doc.circle(p.x, p.y, 2.8).fillAndStroke();
  });

  doc.restore();
}
