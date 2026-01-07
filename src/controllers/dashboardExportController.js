// src/controllers/dashboardExportController.js
/**
 * ============================================================================
 * DASHBOARD EXPORT CONTROLLER - LANDFILL (DEPOZITARE) - 1 PAGE A4 LANDSCAPE
 * ============================================================================
 *
 * ✅ Layout (as requested):
 * - Header WITHOUT green background
 * - Title in green + green separator line
 * - Period in RO format (dd.mm.yyyy)
 * - Right: ADIGIDMB logo + SAMD text
 *
 * Row 1: KPI cards (Total tone / Tichete / Medie / Zile)
 * Row 2: LEFT Monthly deposited (Line chart) | RIGHT Waste codes table Top 8
 * Row 3: LEFT Sectors table | RIGHT Top 5 operators table
 *
 * Footer: Left standard text | Right "Generat de: user + date-time"
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

const formatDateRO = (iso) => {
  if (!iso) return "-";
  const [y, m, d] = String(iso).split("-");
  if (!y || !m || !d) return String(iso);
  return `${d}.${m}.${y}`;
};

const safeText = (v) => (v === null || v === undefined ? "" : String(v));

export const exportLandfillDashboard = async (req, res) => {
  try {
    // 1) Capture SAME payload as /stats (RBAC + filters + sector mapping identical)
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

    const userName =
      [req.user?.firstName, req.user?.lastName].filter(Boolean).join(" ") ||
      [req.user?.first_name, req.user?.last_name].filter(Boolean).join(" ") ||
      "Utilizator";
    const generatedAt = new Date().toLocaleString("ro-RO");

    // 2) PDF setup
    const doc = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margin: 28,
      info: {
        Title: "Raport Depozitare Deșeuri",
        Author: "SAMD",
      },
    });

    const filename = `raport-depozitare-${filters.from || "start"}-${filters.to || "end"}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    doc.pipe(res);

    // 3) Fonts (diacritics)
    const { fontRegular, fontBold } = getFonts();
    if (!fs.existsSync(fontRegular) || !fs.existsSync(fontBold)) {
      // Don't fail hard; but diacritics might be broken without fonts
      console.warn("[EXPORT] Missing Inter fonts in src/assets/fonts. Diacritics may render incorrectly.");
    } else {
      doc.registerFont("Inter", fontRegular);
      doc.registerFont("InterBold", fontBold);
    }

    // Defaults
    const pageW = doc.page.width;
    const pageH = doc.page.height;
    const M = doc.page.margins.left; // same on all sides
    const contentW = pageW - M * 2;

    // Choose fonts if available; else fallback to Helvetica
    const FONT_REG = fs.existsSync(fontRegular) ? "Inter" : "Helvetica";
    const FONT_BOLD = fs.existsSync(fontBold) ? "InterBold" : "Helvetica-Bold";

    // =========================
    // HEADER (NO GREEN BG)
    // =========================
    const headerY = M;
    const headerH = 58;

    const locationText =
      filters.sector_id && filters.sector_id !== "all"
        ? `București / Sector ${filters.sector_id}`
        : "București / Sectoarele 1–6";

    const title = `RAPORT DEPOZITARE DEȘEURI – ${locationText}`;
    const periodText = `Perioada ${formatDateRO(filters.from)} – ${formatDateRO(filters.to)}`;

    // Title (green)
    doc.fillColor("#10b981").font(FONT_BOLD).fontSize(18).text(title, M, headerY, {
      width: contentW - 140,
    });

    // Period (gray)
    doc.fillColor("#334155").font(FONT_REG).fontSize(10.5).text(periodText, M, headerY + 24, {
      width: contentW - 140,
    });

    // Right: logo + SAMD text
    const logoSize = 42;
    const logoX = pageW - M - logoSize;
    const logoY = headerY + 4;

    const logoPath = getLogoPath();
    if (logoPath && fs.existsSync(logoPath)) {
      try {
        doc.image(logoPath, logoX, logoY, { width: logoSize, height: logoSize });
      } catch {
        // ignore
      }
    }

    doc.fillColor("#0f172a").font(FONT_BOLD).fontSize(10).text("SAMD", pageW - M - 120, headerY + 2, {
      width: 70,
      align: "right",
    });

    doc.fillColor("#64748b").font(FONT_REG).fontSize(8.5).text(
      "Sistem Avansat de Monitorizare a Deșeurilor",
      pageW - M - 240,
      headerY + 16,
      { width: 190, align: "right" }
    );

    // Green separator line
    doc.save();
    doc
      .moveTo(M, headerY + headerH)
      .lineTo(pageW - M, headerY + headerH)
      .lineWidth(1.5)
      .strokeColor("#10b981")
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
      { title: "TOTAL DEȘEURI", value: summary.total_tons_formatted || "0.00", sub: "tone depozitate", color: "#10b981" },
      { title: "TICHETE", value: (summary.total_tickets || 0).toLocaleString("ro-RO"), sub: "înregistrări", color: "#3b82f6" },
      { title: "MEDIE TICHET", value: Number(summary.avg_weight_per_ticket || 0).toFixed(2), sub: "tone / tichet", color: "#f59e0b" },
      { title: "ZILE", value: String(summary.date_range?.days || 0), sub: "zile analizate", color: "#8b5cf6" },
    ];

    kpis.forEach((k, i) => {
      const x = M + i * (cardW + cardGap);
      drawKpiCard(doc, x, cardsY, cardW, cardH, k, FONT_REG, FONT_BOLD);
    });

    // =========================
    // ROW 2: LEFT monthly chart | RIGHT waste codes table (Top 8)
    // =========================
    const row2Y = cardsY + cardH + 14;
    const boxH2 = 185;
    const leftW2 = Math.floor(contentW * 0.62);
    const rightW2 = contentW - leftW2 - 12;

    // Left monthly line chart
    const monthlyPng = await makeMonthlyLine(monthlyEvolution);
    drawBoxTitle(doc, M, row2Y, leftW2, boxH2, "Cantități depozitate lunar (tone)", FONT_REG, FONT_BOLD);
    doc.image(monthlyPng, M + 10, row2Y + 28, { width: leftW2 - 20, height: boxH2 - 38 });

    // Right waste codes table
    const wasteTop = wasteCodes.slice(0, 8);
    drawWasteCodesTable(doc, M + leftW2 + 12, row2Y, rightW2, boxH2, wasteTop, FONT_REG, FONT_BOLD);

    // =========================
    // ROW 3: LEFT sectors table | RIGHT top 5 operators
    // =========================
    const row3Y = row2Y + boxH2 + 12;
    const boxH3 = 140;
    const leftW3 = Math.floor(contentW * 0.52);
    const rightW3 = contentW - leftW3 - 12;

    drawSectorsTable(doc, M, row3Y, leftW3, boxH3, perSector, Number(summary.total_tons || 0), FONT_REG, FONT_BOLD);
    drawTopOperatorsTable(doc, M + leftW3 + 12, row3Y, rightW3, boxH3, topOperators.slice(0, 5), FONT_REG, FONT_BOLD);

    // =========================
    // FOOTER
    // =========================
    const footerY = pageH - M - 14;
    doc.font(FONT_REG).fontSize(8.5).fillColor("#64748b").text(
      "Raport generat automat din SAMD · reflectă filtrele aplicate la momentul exportului.",
      M,
      footerY,
      { width: contentW, align: "left" }
    );

    doc.font(FONT_REG).fontSize(8.5).fillColor("#64748b").text(
      `Generat de: ${userName} · ${generatedAt}`,
      M,
      footerY,
      { width: contentW, align: "right" }
    );

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
function drawKpiCard(doc, x, y, w, h, { title, value, sub, color }, FONT_REG, FONT_BOLD) {
  doc.save();

  // Card box
  doc.roundedRect(x, y, w, h, 12).fill("#ffffff");
  doc.roundedRect(x, y, w, h, 12).stroke("#e5e7eb");

  // Accent bar
  doc.rect(x, y, 5, h).fill(color);

  // Text
  doc.fillColor("#64748b").font(FONT_REG).fontSize(9).text(title, x + 14, y + 12, { width: w - 20 });

  doc.fillColor("#0f172a").font(FONT_BOLD).fontSize(18).text(safeText(value), x + 14, y + 28, {
    width: w - 20,
  });

  doc.fillColor("#94a3b8").font(FONT_REG).fontSize(9).text(sub, x + 14, y + 54, { width: w - 20 });

  doc.restore();
}

function drawBoxTitle(doc, x, y, w, h, title, FONT_REG, FONT_BOLD) {
  doc.save();
  doc.roundedRect(x, y, w, h, 12).fill("#ffffff");
  doc.roundedRect(x, y, w, h, 12).stroke("#e5e7eb");

  doc.font(FONT_BOLD).fontSize(10).fillColor("#334155").text(title, x + 10, y + 8, { width: w - 20 });

  doc
    .moveTo(x + 10, y + 24)
    .lineTo(x + w - 10, y + 24)
    .lineWidth(1)
    .strokeColor("#e5e7eb")
    .stroke();

  doc.restore();
}

function drawWasteCodesTable(doc, x, y, w, h, rows, FONT_REG, FONT_BOLD) {
  drawBoxTitle(doc, x, y, w, h, "Coduri deșeu depozitate (Top 8)", FONT_REG, FONT_BOLD);

  const startY = y + 32;
  const col1 = x + 10;
  const col2 = x + Math.floor(w * 0.62);
  const col3 = x + w - 10;

  doc.font(FONT_BOLD).fontSize(9).fillColor("#64748b");
  doc.text("Cod", col1, startY);
  doc.text("Tichete", col2, startY, { width: 70, align: "right" });
  doc.text("Tone", col3 - 70, startY, { width: 70, align: "right" });

  let cy = startY + 14;
  const rowH = 18;

  doc.font(FONT_REG).fontSize(9).fillColor("#0f172a");
  rows.forEach((r, idx) => {
    if (idx % 2 === 1) doc.rect(x + 1, cy - 2, w - 2, rowH).fill("#f8fafc");

    const code = r.waste_code || "—";
    const tickets = Number(r.ticket_count || 0).toLocaleString("ro-RO");
    const tons = r.total_tons_formatted || "0.00";

    doc.fillColor("#0f172a").font(FONT_BOLD).text(code, col1, cy);
    doc.fillColor("#0f172a").font(FONT_REG).text(tickets, col2, cy, { width: 70, align: "right" });
    doc.fillColor("#0f172a").font(FONT_REG).text(tons, col3 - 70, cy, { width: 70, align: "right" });

    cy += rowH;
  });
}

function drawSectorsTable(doc, x, y, w, h, sectors, totalTons, FONT_REG, FONT_BOLD) {
  drawBoxTitle(doc, x, y, w, h, "Sectoare", FONT_REG, FONT_BOLD);

  const rows = [...sectors].sort((a, b) => (b.total_tons || 0) - (a.total_tons || 0)).slice(0, 6);
  const startY = y + 32;
  const col1 = x + 10;
  const col2 = x + Math.floor(w * 0.62);
  const col3 = x + w - 10;

  doc.font(FONT_BOLD).fontSize(9).fillColor("#64748b");
  doc.text("Sector", col1, startY);
  doc.text("Tichete", col2, startY, { width: 70, align: "right" });
  doc.text("Tone", col3 - 70, startY, { width: 70, align: "right" });

  let cy = startY + 14;
  const rowH = 18;

  rows.forEach((r, idx) => {
    if (idx % 2 === 1) doc.rect(x + 1, cy - 2, w - 2, rowH).fill("#f8fafc");

    const sectorLabel = `S${r.sector_number}`;
    const tickets = Number(r.total_tickets || 0).toLocaleString("ro-RO");
    const tons = r.total_tons_formatted || "0.00";

    doc.fillColor("#0f172a").font(FONT_BOLD).text(sectorLabel, col1, cy);
    doc.fillColor("#0f172a").font(FONT_REG).text(tickets, col2, cy, { width: 70, align: "right" });
    doc.fillColor("#0f172a").font(FONT_REG).text(tons, col3 - 70, cy, { width: 70, align: "right" });

    cy += rowH;
  });
}

function drawTopOperatorsTable(doc, x, y, w, h, ops, FONT_REG, FONT_BOLD) {
  drawBoxTitle(doc, x, y, w, h, "Top 5 operatori", FONT_REG, FONT_BOLD);

  const startY = y + 32;
  const col1 = x + 10;
  const col2 = x + Math.floor(w * 0.74);
  const col3 = x + w - 10;

  doc.font(FONT_BOLD).fontSize(9).fillColor("#64748b");
  doc.text("Operator", col1, startY);
  doc.text("Sectoare", col2, startY, { width: 80, align: "right" });
  doc.text("Tone", col3 - 70, startY, { width: 70, align: "right" });

  let cy = startY + 14;
  const rowH = 18;

  ops.forEach((r, idx) => {
    if (idx % 2 === 1) doc.rect(x + 1, cy - 2, w - 2, rowH).fill("#f8fafc");

    const name = safeText(r.institution_name || "—");
    const sectors =
      safeText(r.sector_numbers_display) ||
      (Array.isArray(r.sector_numbers) ? r.sector_numbers.join(", ") : "") ||
      "—";
    const tons = safeText(r.total_tons_formatted || "0.00");

    const shortName = name.length > 30 ? name.slice(0, 27) + "…" : name;

    doc.fillColor("#0f172a").font(FONT_BOLD).text(shortName, col1, cy, { width: col2 - col1 - 6 });
    doc.fillColor("#0f172a").font(FONT_REG).text(sectors, col2, cy, { width: 80, align: "right" });
    doc.fillColor("#0f172a").font(FONT_REG).text(tons, col3 - 70, cy, { width: 70, align: "right" });

    cy += rowH;
  });
}

// =============================================================================
// Chart: Monthly line
// =============================================================================
async function makeMonthlyLine(monthlyEvolution) {
  const canvas = createCanvas(920, 360);
  const ctx = canvas.getContext("2d");

  const labels = monthlyEvolution.map((m) => m.month_name || m.month_label || "");
  const values = monthlyEvolution.map((m) => Number(m.total_tons || 0));

  new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          data: values,
          borderWidth: 3,
          pointRadius: 2,
          tension: 0.35,
          borderColor: "#10b981",
        },
      ],
    },
    options: {
      responsive: false,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true } },
    },
  });

  return canvas.toBuffer("image/png");
}
