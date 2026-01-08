// src/controllers/dashboardExportController.js
/**
 * ============================================================================
 * DASHBOARD EXPORT CONTROLLER - LANDFILL (DEPOZITARE) - 1 PAGE A4 LANDSCAPE
 * ============================================================================
 * ✅ NO native deps (NO canvas / NO chart.js)
 *
 * Style target: SAME as UI screenshots (clean white cards, light tables, green accent line)
 * - Header: Title (green), Location + Period on SAME line, logo right
 * - Green separator line below header
 * - KPI cards: simple, with thin colored left accent
 * - Panels: rounded corners, title + thin divider line (no colored table header bar)
 * - Tables: light, zebra rows, NO blue headers
 * - Line chart: month labels all months (Ian..Dec)
 * - Waste code description: 1 line with ellipsis
 * - Footer: left info + right "Generat la data: dd.mm.yyyy, ora HH:mm:ss" (RO time)
 * ============================================================================
 */

import PDFDocument from "pdfkit";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import dashboardLandfillController from "./dashboardLandfillController.js";

// =====================
// THEME (green like UI)
// =====================
const COLORS = {
  green: "#10B981",       // main accent (emerald)
  greenDark: "#059669",   // for bold title
  text: "#0F172A",        // slate-900
  text2: "#475569",       // slate-600
  grid: "#E2E8F0",        // slate-200
  soft: "#F8FAFC",        // slate-50
  white: "#FFFFFF",
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
    // HEADER (as screenshot)
    // =========================
    const headerY = M;
    const headerH = 52;

    const locationText =
      filters.sector_id && filters.sector_id !== "all" ? `Sector ${filters.sector_id}` : "București";

    const title = "RAPORT DEPOZITARE DEȘEURI";

    // Logo (right) - better vertical alignment
    const logoPath = getLogoPath();
    const logoW = 138;
    const logoX = pageW - M - logoW;
    const logoY = headerY + 8; // visually centered
    if (logoPath && fs.existsSync(logoPath)) {
      try {
        doc.image(logoPath, logoX, logoY, { width: logoW });
      } catch {}
    }

    // Title left
    doc.fillColor(COLORS.greenDark).font(FONT_BOLD).fontSize(18).text(title, M, headerY + 4, {
      width: contentW - (logoW + 14),
    });

    // Location + Period SAME line
    const metaY = headerY + 26;
    const metaLeftW = contentW - (logoW + 14);

    const metaTextLeft = `Locație: ${locationText}   •   `;
    doc.fillColor(COLORS.text2).font(FONT_REG).fontSize(10.5).text(metaTextLeft, M, metaY, {
      width: metaLeftW,
      continued: true,
    });

    doc.fillColor(COLORS.text).font(FONT_BOLD).fontSize(10.5).text("Perioada:", { continued: true });
    doc
      .fillColor(COLORS.text2)
      .font(FONT_REG)
      .fontSize(10.5)
      .text(` ${formatDateRO(filters.from)} – ${formatDateRO(filters.to)}`, { continued: false });

    // Green separator line
    doc.save();
    doc
      .moveTo(M, headerY + headerH)
      .lineTo(pageW - M, headerY + headerH)
      .lineWidth(2)
      .strokeColor(COLORS.green)
      .stroke();
    doc.restore();

    // =========================
    // KPI CARDS (4) - clean with left accent like UI
    // =========================
    const cardsY = headerY + headerH + 12;
    const cardH = 70;
    const cardGap = 12;
    const cardW = (contentW - cardGap * 3) / 4;

    const kpis = [
      { title: "TOTAL DEȘEURI", value: summary.total_tons_formatted || "0.00", sub: "tone depozitate", accent: COLORS.green },
      { title: "TICHETE", value: (summary.total_tickets || 0).toLocaleString("ro-RO"), sub: "înregistrări", accent: "#3B82F6" },
      { title: "MEDIE TICHET", value: Number(summary.avg_weight_per_ticket || 0).toFixed(2), sub: "tone / tichet", accent: "#F59E0B" },
      { title: "ZILE", value: String(summary.date_range?.days || 0), sub: "zile analizate", accent: "#7C3AED" },
    ];

    kpis.forEach((k, i) => {
      const x = M + i * (cardW + cardGap);
      drawKpiCardClean(doc, x, cardsY, cardW, cardH, k, FONT_REG, FONT_BOLD);
    });

    // =========================
    // ROW 2: chart + waste codes
    // =========================
    const row2Y = cardsY + cardH + 12;
    const boxH2 = 190;
    const leftW2 = Math.floor(contentW * 0.62);
    const rightW2 = contentW - leftW2 - 12;

    // LEFT: line chart panel
    drawPanelSimple(doc, M, row2Y, leftW2, boxH2, "Cantități depozitate lunar (tone)", FONT_REG, FONT_BOLD);
    drawMonthlyLineChart(
      doc,
      M + 12,
      row2Y + 34,
      leftW2 - 24,
      boxH2 - 48,
      monthlyEvolution,
      FONT_REG,
      FONT_BOLD
    );

    // RIGHT: waste codes panel + table
    drawPanelSimple(doc, M + leftW2 + 12, row2Y, rightW2, boxH2, "Coduri deșeu depozitate (Top 8)", FONT_REG, FONT_BOLD);
    drawWasteCodesTableLight(doc, M + leftW2 + 12, row2Y, rightW2, boxH2, wasteCodes.slice(0, 8), FONT_REG, FONT_BOLD);

    // =========================
    // ROW 3: sectors + operators
    // =========================
    const row3Y = row2Y + boxH2 + 10;
    const boxH3 = 140;
    const leftW3 = Math.floor(contentW * 0.52);
    const rightW3 = contentW - leftW3 - 12;

    drawPanelSimple(doc, M, row3Y, leftW3, boxH3, "Sectoare", FONT_REG, FONT_BOLD);
    drawSectorsTableLight(doc, M, row3Y, leftW3, boxH3, perSector, FONT_REG, FONT_BOLD);

    drawPanelSimple(doc, M + leftW3 + 12, row3Y, rightW3, boxH3, "Top 5 operatori", FONT_REG, FONT_BOLD);
    drawTopOperatorsTableLight(doc, M + leftW3 + 12, row3Y, rightW3, boxH3, topOperators.slice(0, 5), FONT_REG, FONT_BOLD);

    // =========================
    // FOOTER
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

    doc.fillColor(COLORS.text2).font(FONT_REG).fontSize(8.5).text("ℹ︎", M, footerY, { continued: true });
    doc
      .fillColor(COLORS.text2)
      .font(FONT_REG)
      .fontSize(8.5)
      .text(" Raport generat automat din SAMD · Reflectă filtrele aplicate la momentul exportului.", {
        continued: false,
      });

    doc
      .fillColor(COLORS.text2)
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
// Drawing helpers
// =============================================================================
function drawRoundedCard(doc, x, y, w, h, r = 14) {
  // subtle shadow
  doc.save();
  doc.roundedRect(x + 1.5, y + 1.5, w, h, r).fillOpacity(0.08).fill("#000000");
  doc.fillOpacity(1);
  doc.roundedRect(x, y, w, h, r).fill(COLORS.white);
  doc.roundedRect(x, y, w, h, r).stroke(COLORS.grid);
  doc.restore();
}

function drawKpiCardClean(doc, x, y, w, h, kpi, FONT_REG, FONT_BOLD) {
  drawRoundedCard(doc, x, y, w, h, 14);

  // left accent bar
  doc.save();
  doc.roundedRect(x, y, 5, h, 14).fill(kpi.accent);
  doc.restore();

  // title
  doc.fillColor(COLORS.text2).font(FONT_REG).fontSize(9.5).text(kpi.title, x + 14, y + 10, { width: w - 24 });

  // value
  doc.fillColor(COLORS.text).font(FONT_BOLD).fontSize(20).text(safeText(kpi.value), x + 14, y + 28, { width: w - 24 });

  // sub
  doc.fillColor(COLORS.text2).font(FONT_REG).fontSize(9.5).text(kpi.sub, x + 14, y + 52, { width: w - 24 });
}

function drawPanelSimple(doc, x, y, w, h, title, FONT_REG, FONT_BOLD) {
  drawRoundedCard(doc, x, y, w, h, 18);

  // title
  doc.fillColor(COLORS.text).font(FONT_BOLD).fontSize(10.5).text(title, x + 12, y + 10, { width: w - 24 });

  // divider line
  doc.save();
  doc
    .moveTo(x + 12, y + 26)
    .lineTo(x + w - 12, y + 26)
    .lineWidth(1)
    .strokeColor(COLORS.grid)
    .stroke();
  doc.restore();
}

// clip inside rounded box
function beginClip(doc, x, y, w, h, r) {
  doc.save();
  doc.roundedRect(x, y, w, h, r).clip();
}
function endClip(doc) {
  doc.restore();
}

// =============================================================================
// Tables (light like UI)
// =============================================================================
function drawWasteCodesTableLight(doc, x, y, w, h, rows, FONT_REG, FONT_BOLD) {
  const radius = 18;
  beginClip(doc, x, y, w, h, radius);

  const tableX = x + 12;
  const tableY = y + 34;
  const tableW = w - 24;

  // widths tuned not to overlap
  const tonsW = 78;
  const ticketsW = 76;
  const codeW = tableW - ticketsW - tonsW - 10;

  // header text only (no colored bg)
  doc.fillColor(COLORS.text2).font(FONT_BOLD).fontSize(9).text("Cod", tableX, tableY, { width: codeW });
  doc.fillColor(COLORS.text2).font(FONT_BOLD).fontSize(9).text("Tichete", tableX + codeW + 5, tableY, { width: ticketsW, align: "right" });
  doc.fillColor(COLORS.text2).font(FONT_BOLD).fontSize(9).text("Tone", tableX + codeW + 5 + ticketsW + 5, tableY, { width: tonsW, align: "right" });

  // separator
  doc.save();
  doc
    .moveTo(tableX, tableY + 14)
    .lineTo(tableX + tableW, tableY + 14)
    .lineWidth(1)
    .strokeColor(COLORS.grid)
    .stroke();
  doc.restore();

  let cy = tableY + 18;
  const rowH = 18;

  rows.forEach((r, idx) => {
    const bg = idx % 2 === 0 ? COLORS.white : COLORS.soft;
    doc.rect(tableX, cy, tableW, rowH).fill(bg);

    const code = r.waste_code || "—";
    const desc = r.waste_description || "";
    const tickets = Number(r.ticket_count || 0).toLocaleString("ro-RO");
    const tons = r.total_tons_formatted || "0.00";

    doc.fillColor(COLORS.text).font(FONT_BOLD).fontSize(9).text(code, tableX, cy + 3, { width: codeW });

    // one-line description (tiny)
    if (desc) {
      const clipped = ellipsisOneLine(doc, desc, codeW, FONT_REG, 7);
      doc.fillColor("#94A3B8").font(FONT_REG).fontSize(7).text(clipped, tableX, cy + 12, { width: codeW });
    }

    doc.fillColor(COLORS.text).font(FONT_REG).fontSize(9).text(tickets, tableX + codeW + 5, cy + 3, {
      width: ticketsW,
      align: "right",
    });
    doc.fillColor(COLORS.text).font(FONT_REG).fontSize(9).text(tons, tableX + codeW + 5 + ticketsW + 5, cy + 3, {
      width: tonsW,
      align: "right",
    });

    cy += rowH;
  });

  endClip(doc);
}

function drawSectorsTableLight(doc, x, y, w, h, sectors, FONT_REG, FONT_BOLD) {
  const radius = 18;
  beginClip(doc, x, y, w, h, radius);

  const rows = [...sectors].sort((a, b) => (b.total_tons || 0) - (a.total_tons || 0)).slice(0, 6);

  const tableX = x + 12;
  const tableY = y + 34;
  const tableW = w - 24;

  const tonsW = 86;
  const ticketsW = 78;
  const sectorW = tableW - ticketsW - tonsW - 10;

  doc.fillColor(COLORS.text2).font(FONT_BOLD).fontSize(9).text("Sector", tableX, tableY, { width: sectorW });
  doc.fillColor(COLORS.text2).font(FONT_BOLD).fontSize(9).text("Tichete", tableX + sectorW + 5, tableY, { width: ticketsW, align: "right" });
  doc.fillColor(COLORS.text2).font(FONT_BOLD).fontSize(9).text("Tone", tableX + sectorW + 5 + ticketsW + 5, tableY, { width: tonsW, align: "right" });

  doc.save();
  doc
    .moveTo(tableX, tableY + 14)
    .lineTo(tableX + tableW, tableY + 14)
    .lineWidth(1)
    .strokeColor(COLORS.grid)
    .stroke();
  doc.restore();

  let cy = tableY + 18;
  const rowH = 18;

  rows.forEach((r, idx) => {
    const bg = idx % 2 === 0 ? COLORS.white : COLORS.soft;
    doc.rect(tableX, cy, tableW, rowH).fill(bg);

    doc.fillColor(COLORS.text).font(FONT_BOLD).fontSize(9).text(`S${r.sector_number}`, tableX, cy + 3, { width: sectorW });
    doc.fillColor(COLORS.text).font(FONT_REG).fontSize(9).text(Number(r.total_tickets || 0).toLocaleString("ro-RO"), tableX + sectorW + 5, cy + 3, {
      width: ticketsW,
      align: "right",
    });
    doc.fillColor(COLORS.text).font(FONT_REG).fontSize(9).text(r.total_tons_formatted || "0.00", tableX + sectorW + 5 + ticketsW + 5, cy + 3, {
      width: tonsW,
      align: "right",
    });

    cy += rowH;
  });

  endClip(doc);
}

function drawTopOperatorsTableLight(doc, x, y, w, h, ops, FONT_REG, FONT_BOLD) {
  const radius = 18;
  beginClip(doc, x, y, w, h, radius);

  const tableX = x + 12;
  const tableY = y + 34;
  const tableW = w - 24;

  const tonsW = 86;
  const sectorsW = 70;
  const opW = tableW - sectorsW - tonsW - 10;

  doc.fillColor(COLORS.text2).font(FONT_BOLD).fontSize(9).text("Operator", tableX, tableY, { width: opW });
  doc.fillColor(COLORS.text2).font(FONT_BOLD).fontSize(9).text("Sectoare", tableX + opW + 5, tableY, { width: sectorsW, align: "right" });
  doc.fillColor(COLORS.text2).font(FONT_BOLD).fontSize(9).text("Tone", tableX + opW + 5 + sectorsW + 5, tableY, { width: tonsW, align: "right" });

  doc.save();
  doc
    .moveTo(tableX, tableY + 14)
    .lineTo(tableX + tableW, tableY + 14)
    .lineWidth(1)
    .strokeColor(COLORS.grid)
    .stroke();
  doc.restore();

  let cy = tableY + 18;
  const rowH = 18;

  ops.forEach((r, idx) => {
    const bg = idx % 2 === 0 ? COLORS.white : COLORS.soft;
    doc.rect(tableX, cy, tableW, rowH).fill(bg);

    const name = ellipsisOneLine(doc, r.institution_name || "—", opW, FONT_BOLD, 9);
    const sectors = safeText(r.sector_numbers_display || (Array.isArray(r.sector_numbers) ? r.sector_numbers.join(", ") : "—"));
    const tons = safeText(r.total_tons_formatted || "0.00");

    doc.fillColor(COLORS.text).font(FONT_BOLD).fontSize(9).text(name, tableX, cy + 3, { width: opW });
    doc.fillColor(COLORS.text).font(FONT_REG).fontSize(9).text(sectors, tableX + opW + 5, cy + 3, { width: sectorsW, align: "right" });
    doc.fillColor(COLORS.text).font(FONT_REG).fontSize(9).text(tons, tableX + opW + 5 + sectorsW + 5, cy + 3, { width: tonsW, align: "right" });

    cy += rowH;
  });

  endClip(doc);
}

// =============================================================================
// LINE CHART drawn with PDFKit (no canvas) - all months
// =============================================================================
function drawMonthlyLineChart(doc, x, y, w, h, monthlyEvolution, FONT_REG, FONT_BOLD) {
  const padL = 44;
  const padR = 10;
  const padT = 8;
  const padB = 22;

  const chartX = x + padL;
  const chartY = y + padT;
  const chartW = w - padL - padR;
  const chartH = h - padT - padB;

  const monthsRO = ["Ian", "Feb", "Mar", "Apr", "Mai", "Iun", "Iul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const byMonth = new Map();
  monthlyEvolution.forEach((m) => {
    const mm = Number(m.month);
    if (mm >= 1 && mm <= 12) byMonth.set(mm, Number(m.total_tons || 0));
  });
  const values = monthsRO.map((_, i) => byMonth.get(i + 1) ?? 0);

  const max = Math.max(1, ...values);

  // grid
  doc.save();
  doc.lineWidth(0.5).strokeColor("#E5E7EB");
  const gridLines = 4;
  for (let i = 0; i <= gridLines; i++) {
    const gy = chartY + (chartH * i) / gridLines;
    doc.moveTo(chartX, gy).lineTo(chartX + chartW, gy).stroke();
  }
  doc.restore();

  // y labels
  doc.fillColor("#64748B").font(FONT_REG).fontSize(7);
  doc.text("0", x + 6, chartY + chartH - 4, { width: padL - 10, align: "left" });
  doc.text(max.toLocaleString("ro-RO"), x + 6, chartY - 3, { width: padL - 10, align: "left" });

  // x labels all months
  const n = 12;
  const stepX = chartW / (n - 1);
  doc.fillColor("#64748B").font(FONT_REG).fontSize(7);
  for (let i = 0; i < n; i++) {
    const lx = chartX + stepX * i;
    doc.text(monthsRO[i], lx - 10, chartY + chartH + 6, { width: 20, align: "center" });
  }

  // points
  const pts = values.map((v, i) => ({
    x: chartX + stepX * i,
    y: chartY + chartH - (v / max) * chartH,
  }));

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
  pts.forEach((p) => doc.circle(p.x, p.y, 2.6).fillAndStroke());
  doc.restore();
}
