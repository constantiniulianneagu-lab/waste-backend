// src/controllers/dashboardExportController.js
/**
 * ============================================================================
 * DASHBOARD EXPORT CONTROLLER - LANDFILL (DEPOZITARE) - 1 PAGE A4 LANDSCAPE
 * ============================================================================
 *
 * ✅ Corporate theme (ADIGIDMB):
 * Petrol Blue:   #003B5C (titles, strong accents, table headers)
 * Emerald Green: #2E7D32 (positive, charts)
 * Anthracite:    #2A2A2A (main text)
 * Light Gray:    #E6E6E6 (table background / subtle fills)
 * White:         #FFFFFF (space)
 * Table grid:    #DADADA
 *
 * ✅ Layout (1 page):
 * Header: title left, period line (bold label), logo right (ONLY logo), separator line
 * Row 1: 4 KPI cards with icons (simple Unicode icons)
 * Row 2: LEFT Monthly bar chart | RIGHT Waste codes table (Top 8) + description small gray
 * Row 3: LEFT "Distribuția pe sectoare" table | RIGHT "Top 5 operatori" table
 * Footer: thin gray line + ℹ︎ + text left, right "Generat la data: dd.mm.yyyy, ora HH:mm:ss" (RO tz)
 *
 * ✅ Uses SAME data as /stats (reuses dashboardLandfillController.getStats)
 * ✅ Diacritics OK with Inter TTF fonts
 *
 * Required assets:
 * - src/assets/fonts/Inter-Regular.ttf
 * - src/assets/fonts/Inter-Bold.ttf
 * - src/assets/branding/adigidmb.png
 */

import PDFDocument from "pdfkit";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { createCanvas } from "canvas";
import Chart from "chart.js/auto";

import dashboardLandfillController from "./dashboardLandfillController.js";

// =====================
// CORPORATE PALETTE
// =====================
const COLORS = {
  petrol: "#003B5C",
  emerald: "#2E7D32",
  anthracite: "#2A2A2A",
  lightGray: "#E6E6E6",
  white: "#FFFFFF",
  grid: "#DADADA",
  muted: "#64748b",
  soft: "#F7F7F7",
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

const formatDateTimeROWithSeconds = (d) => {
  const formatted = new Intl.DateTimeFormat("ro-RO", {
    timeZone: "Europe/Bucharest",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(d);

  // ro-RO Intl may return "08.01.2026, 02:08:56" already — keep it.
  return formatted;
};

const safeText = (v) => (v === null || v === undefined ? "" : String(v));

// =====================
// MAIN EXPORT
// =====================
export const exportLandfillDashboard = async (req, res) => {
  try {
    // 1) Capture SAME payload as /stats (RBAC + filters identical)
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

    // Logged user name
    const first = req.user?.firstName || req.user?.first_name || "";
    const last = req.user?.lastName || req.user?.last_name || "";
    const userName = [first, last].filter(Boolean).join(" ").trim();

    const generatedAt = formatDateTimeROWithSeconds(new Date());

    // 2) PDF setup
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

    // 3) Fonts (diacritics)
    const { fontRegular, fontBold } = getFonts();
    if (fs.existsSync(fontRegular) && fs.existsSync(fontBold)) {
      doc.registerFont("Inter", fontRegular);
      doc.registerFont("InterBold", fontBold);
    } else {
      console.warn("[EXPORT] Missing Inter fonts in src/assets/fonts. Diacritics may render incorrectly.");
    }

    // Geometry
    const pageW = doc.page.width;
    const pageH = doc.page.height;
    const M = doc.page.margins.left;
    const contentW = pageW - M * 2;

    // Font names
    const FONT_REG = fs.existsSync(fontRegular) ? "Inter" : "Helvetica";
    const FONT_BOLD = fs.existsSync(fontBold) ? "InterBold" : "Helvetica-Bold";

    // =========================
    // HEADER (clean corporate)
    // =========================
    const headerY = M;
    const headerH = 54;

    // Title logic: București vs Sector X
    const locationText =
      filters.sector_id && filters.sector_id !== "all" ? `Sector ${filters.sector_id}` : "București";

    const title = `RAPORT DEPOZITARE DEȘEURI – ${locationText}`;

    const periodLabel = "Perioada:";
    const periodValue = `${formatDateRO(filters.from)} – ${formatDateRO(filters.to)}`;

    // LOGO right only, keep aspect ratio (width only)
    const logoPath = getLogoPath();
    if (logoPath && fs.existsSync(logoPath)) {
      try {
        const logoW = 140; // wide logo: keep proportional
        const logoX = pageW - M - logoW;
        const logoY = headerY + 4;
        doc.image(logoPath, logoX, logoY, { width: logoW }); // no height => proportional
      } catch {
        // ignore
      }
    }

    // Title petrol
    doc.fillColor(COLORS.petrol).font(FONT_BOLD).fontSize(18).text(title, M, headerY, {
      width: contentW - 160,
    });

    // Period line: bold label + regular value
    const periodY = headerY + 26;
    doc.fillColor(COLORS.anthracite).font(FONT_BOLD).fontSize(10.5).text(periodLabel, M, periodY, {
      continued: true,
    });
    doc.fillColor(COLORS.anthracite).font(FONT_REG).fontSize(10.5).text(` ${periodValue}`, {
      continued: false,
    });

    // Separator line petrol
    doc.save();
    doc
      .moveTo(M, headerY + headerH)
      .lineTo(pageW - M, headerY + headerH)
      .lineWidth(1.5)
      .strokeColor(COLORS.petrol)
      .stroke();
    doc.restore();

    // =========================
    // ROW 1: KPI CARDS (4)
    // =========================
    const cardsY = headerY + headerH + 14;
    const cardH = 72;
    const cardGap = 12;
    const cardW = (contentW - cardGap * 3) / 4;

    const kpis = [
      {
        title: "TOTAL DEȘEURI",
        value: summary.total_tons_formatted || "0.00",
        sub: "tone depozitate",
        icon: "♻︎",
        iconColor: COLORS.emerald,
        valueColor: COLORS.petrol,
      },
      {
        title: "TICHETE",
        value: (summary.total_tickets || 0).toLocaleString("ro-RO"),
        sub: "înregistrări",
        icon: "🗂︎",
        iconColor: COLORS.petrol,
        valueColor: COLORS.petrol,
      },
      {
        title: "MEDIE TICHET",
        value: Number(summary.avg_weight_per_ticket || 0).toFixed(2),
        sub: "tone / tichet",
        icon: "📊",
        iconColor: COLORS.emerald,
        valueColor: COLORS.petrol,
      },
      {
        title: "ZILE ANALIZATE",
        value: String(summary.date_range?.days || 0),
        sub: "zile",
        icon: "📅",
        iconColor: COLORS.anthracite,
        valueColor: COLORS.petrol,
      },
    ];

    kpis.forEach((k, i) => {
      const x = M + i * (cardW + cardGap);
      drawKpiCard(doc, x, cardsY, cardW, cardH, k, FONT_REG, FONT_BOLD);
    });

    // =========================
    // ROW 2: LEFT monthly bar chart | RIGHT waste codes table
    // =========================
    const row2Y = cardsY + cardH + 14;
    const boxH2 = 185;
    const leftW2 = Math.floor(contentW * 0.62);
    const rightW2 = contentW - leftW2 - 12;

    // Left: monthly bar chart (rounded thin bars)
    const monthlyPng = await makeMonthlyBar(monthlyEvolution);
    drawBoxTitle(doc, M, row2Y, leftW2, boxH2, "Cantități depozitate lunar (tone)", FONT_REG, FONT_BOLD);
    doc.image(monthlyPng, M + 10, row2Y + 28, { width: leftW2 - 20, height: boxH2 - 38 });

    // Right: waste codes table (Top 8) with small gray description
    const wasteTop = wasteCodes.slice(0, 8);
    drawWasteCodesTable(doc, M + leftW2 + 12, row2Y, rightW2, boxH2, wasteTop, FONT_REG, FONT_BOLD);

    // =========================
    // ROW 3: LEFT sectors table | RIGHT top 5 operators table
    // =========================
    const row3Y = row2Y + boxH2 + 12;
    const boxH3 = 140;
    const leftW3 = Math.floor(contentW * 0.52);
    const rightW3 = contentW - leftW3 - 12;

    drawSectorsTable(doc, M, row3Y, leftW3, boxH3, perSector, FONT_REG, FONT_BOLD);
    drawTopOperatorsTable(doc, M + leftW3 + 12, row3Y, rightW3, boxH3, topOperators.slice(0, 5), FONT_REG, FONT_BOLD);

    // =========================
    // FOOTER (corporate)
    // =========================
    const footerY = pageH - M - 18;

    // thin line
    doc.save();
    doc
      .moveTo(M, footerY - 6)
      .lineTo(pageW - M, footerY - 6)
      .lineWidth(1)
      .strokeColor(COLORS.grid)
      .stroke();
    doc.restore();

    // left: info icon + text
    doc.font(FONT_REG).fontSize(8.5).fillColor(COLORS.anthracite)
      .text("ℹ︎", M, footerY, { continued: true });

    doc.font(FONT_REG).fontSize(8.5).fillColor(COLORS.anthracite)
      .text(" Raport generat automat din SAMD · Reflectă filtrele aplicate la momentul exportului.", {
        continued: false,
      });

    // right: generated at
    const rightText = `Generat la data: ${generatedAt}`;
    doc.font(FONT_REG).fontSize(8.5).fillColor(COLORS.anthracite)
      .text(rightText, M, footerY, { width: contentW, align: "right" });

    // optional: include user name on right (requested earlier)
    // If you want BOTH user + datetime, uncomment below and comment the line above:
    // const rightText = `Generat de: ${userName || "—"} · ${generatedAt}`;

    doc.end();
  } catch (error) {
    console.error("💥 Export PDF error:", error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: "Eroare la generarea raportului PDF",
        error: error.message,
      });
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
// Paths: fonts + logo
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
// UI helpers
// =============================================================================
function drawKpiCard(doc, x, y, w, h, kpi, FONT_REG, FONT_BOLD) {
  const { title, value, sub, icon, iconColor, valueColor } = kpi;

  doc.save();

  // subtle shadow mimic: draw a light rect behind
  doc.roundedRect(x + 2, y + 2, w, h, 14).fillOpacity(0.10).fill("#000000");
  doc.fillOpacity(1);

  // card base
  doc.roundedRect(x, y, w, h, 14).fill(COLORS.white);
  doc.roundedRect(x, y, w, h, 14).stroke(COLORS.grid);

  // icon circle (outline-ish)
  const r = 16;
  const cx = x + 20;
  const cy = y + 22;
  doc.circle(cx, cy, r).strokeColor(COLORS.grid).lineWidth(1).stroke();
  doc.fillColor(iconColor).font(FONT_BOLD).fontSize(12).text(icon, cx - 6, cy - 8);

  // title
  doc.fillColor(COLORS.anthracite).font(FONT_REG).fontSize(9).text(title, x + 44, y + 10, {
    width: w - 54,
  });

  // value
  doc.fillColor(valueColor).font(FONT_BOLD).fontSize(18).text(safeText(value), x + 44, y + 28, {
    width: w - 54,
  });

  // sub
  doc.fillColor("#6b7280").font(FONT_REG).fontSize(9).text(sub, x + 44, y + 54, {
    width: w - 54,
  });

  doc.restore();
}

function drawBoxTitle(doc, x, y, w, h, title, FONT_REG, FONT_BOLD) {
  doc.save();

  doc.roundedRect(x, y, w, h, 12).fill(COLORS.white);
  doc.roundedRect(x, y, w, h, 12).stroke(COLORS.grid);

  // title
  doc.font(FONT_BOLD).fontSize(10).fillColor(COLORS.petrol)
    .text(title, x + 10, y + 8, { width: w - 20 });

  // separator line
  doc
    .moveTo(x + 10, y + 24)
    .lineTo(x + w - 10, y + 24)
    .lineWidth(1)
    .strokeColor(COLORS.grid)
    .stroke();

  doc.restore();
}

function drawTableHeader(doc, x, y, w, h, cols, FONT_BOLD) {
  // Petrol header with white text
  doc.save();
  doc.rect(x, y, w, h).fill(COLORS.petrol);
  doc.font(FONT_BOLD).fontSize(9).fillColor(COLORS.white);

  cols.forEach((c) => {
    doc.text(c.text, c.x, y + 6, { width: c.w, align: c.align || "left" });
  });

  doc.restore();
}

function drawWasteCodesTable(doc, x, y, w, h, rows, FONT_REG, FONT_BOLD) {
  drawBoxTitle(doc, x, y, w, h, "Coduri deșeu depozitate (Top 8)", FONT_REG, FONT_BOLD);

  const tableX = x + 10;
  const tableY = y + 32;
  const tableW = w - 20;

  // column widths
  const tonsW = 86;
  const ticketsW = 82;
  const codeW = tableW - ticketsW - tonsW - 10; // 10 = internal gap

  const cols = [
    { text: "Cod", x: tableX, w: codeW, align: "left" },
    { text: "Tichete", x: tableX + codeW + 5, w: ticketsW, align: "right" },
    { text: "Cantitate (t)", x: tableX + codeW + 5 + ticketsW + 5, w: tonsW, align: "right" },
  ];

  // header
  drawTableHeader(doc, tableX, tableY, tableW, 22, cols, FONT_BOLD);

  // rows zebra
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

    // left icon (simple)
    const icon = "♻︎";

    // Code + tiny desc
    doc.fillColor(COLORS.anthracite).font(FONT_BOLD).fontSize(9)
      .text(`${icon} ${code}`, tableX + 6, cy + 4, { width: codeW - 8, ellipsis: true });

    if (desc) {
      doc.fillColor("#9aa4b2").font(FONT_REG).fontSize(7.2)
        .text(desc, tableX + 20, cy + 13, { width: codeW - 24, ellipsis: true });
    }

    // numbers
    doc.fillColor(COLORS.anthracite).font(FONT_REG).fontSize(9)
      .text(tickets, cols[1].x, cy + 6, { width: cols[1].w, align: "right" });

    doc.fillColor(COLORS.anthracite).font(FONT_REG).fontSize(9)
      .text(tons, cols[2].x, cy + 6, { width: cols[2].w, align: "right" });

    cy += rowH;
  });
}

function drawSectorsTable(doc, x, y, w, h, sectors, FONT_REG, FONT_BOLD) {
  drawBoxTitle(doc, x, y, w, h, "Distribuția pe sectoare", FONT_REG, FONT_BOLD);

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

  drawTableHeader(doc, tableX, tableY, tableW, 22, cols, FONT_BOLD);

  let cy = tableY + 22;
  const rowH = 18.5;

  rows.forEach((r, idx) => {
    const bg = idx % 2 === 0 ? COLORS.white : COLORS.soft;
    doc.rect(tableX, cy, tableW, rowH).fill(bg);
    doc.rect(tableX, cy, tableW, rowH).strokeColor(COLORS.grid).lineWidth(0.5).stroke();

    const sectorLabel = `🏙︎ Sector ${r.sector_number}`;
    const tickets = Number(r.total_tickets || 0).toLocaleString("ro-RO");
    const tons = r.total_tons_formatted || "0.00";

    doc.fillColor(COLORS.anthracite).font(FONT_BOLD).fontSize(9)
      .text(sectorLabel, tableX + 6, cy + 4, { width: sectorW - 8, ellipsis: true });

    doc.fillColor(COLORS.anthracite).font(FONT_REG).fontSize(9)
      .text(tickets, cols[1].x, cy + 4, { width: cols[1].w, align: "right" });

    doc.fillColor(COLORS.anthracite).font(FONT_REG).fontSize(9)
      .text(tons, cols[2].x, cy + 4, { width: cols[2].w, align: "right" });

    cy += rowH;
  });
}

function drawTopOperatorsTable(doc, x, y, w, h, ops, FONT_REG, FONT_BOLD) {
  drawBoxTitle(doc, x, y, w, h, "Top 5 operatori", FONT_REG, FONT_BOLD);

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

  drawTableHeader(doc, tableX, tableY, tableW, 22, cols, FONT_BOLD);

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

    doc.fillColor(COLORS.anthracite).font(FONT_BOLD).fontSize(9)
      .text(`🏢 ${name}`, tableX + 6, cy + 4, { width: opW - 8, ellipsis: true });

    doc.fillColor(COLORS.anthracite).font(FONT_REG).fontSize(9)
      .text(sectors, cols[1].x, cy + 4, { width: cols[1].w, align: "right" });

    doc.fillColor(COLORS.anthracite).font(FONT_REG).fontSize(9)
      .text(tons, cols[2].x, cy + 4, { width: cols[2].w, align: "right" });

    cy += rowH;
  });
}

// =============================================================================
// Chart: Monthly BAR (rounded thin bars, emerald, light grid)
// =============================================================================
async function makeMonthlyBar(monthlyEvolution) {
  const canvas = createCanvas(920, 360);
  const ctx = canvas.getContext("2d");

  const labels = monthlyEvolution.map((m) => m.month_name || m.month_label || "");
  const values = monthlyEvolution.map((m) => Number(m.total_tons || 0));

  new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          data: values,
          backgroundColor: COLORS.emerald,
          borderRadius: 6,
          barThickness: 10,
          maxBarThickness: 12,
          categoryPercentage: 0.8,
          barPercentage: 0.8,
        },
      ],
    },
    options: {
      responsive: false,
      plugins: { legend: { display: false } },
      scales: {
        x: {
          grid: { display: false },
          ticks: { maxRotation: 0, autoSkip: true },
        },
        y: {
          beginAtZero: true,
          grid: { display: true, color: COLORS.lightGray },
          ticks: { precision: 0 },
        },
      },
    },
  });

  return canvas.toBuffer("image/png");
}
