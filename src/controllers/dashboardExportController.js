// src/controllers/dashboardExportController.js
/**
 * ============================================================================
 * DASHBOARD EXPORT CONTROLLER - LANDFILL (DEPOZITARE) - MODERN SAMSUNG STYLE
 * ============================================================================
 * ✅ Modern, premium design inspired by Samsung's clean aesthetic
 * ✅ Bold typography, generous spacing, gradient accents
 * ✅ NO native deps (NO canvas / NO chart.js)
 *
 * Style: Premium, minimalist with bold visual hierarchy
 * - Header: Large bold title with gradient accent bar
 * - Floating cards with subtle shadows and rounded corners
 * - Modern color palette: deep blues, vibrant accents
 * - Clean sans-serif typography with varied weights
 * - Sophisticated data visualization
 * ============================================================================
 */

import PDFDocument from "pdfkit";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import dashboardLandfillController from "./dashboardLandfillController.js";

// =====================
// MODERN THEME (Samsung-inspired)
// =====================
const COLORS = {
  primary: "#0066FF",      // vibrant blue
  primaryDark: "#0052CC",  // deeper blue
  accent: "#00D4AA",       // teal accent
  purple: "#7B61FF",       // premium purple
  orange: "#FF6B35",       // warm orange
  text: "#1A1A1A",         // near black
  textSoft: "#666666",     // medium gray
  textLight: "#999999",    // light gray
  bg: "#F8F9FA",           // soft background
  bgCard: "#FFFFFF",       // pure white cards
  border: "#E8E8E8",       // subtle borders
  gridLight: "#F0F0F0",    // very light grid
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
      margin: 32,
      info: { Title: "Raport Depozitare Deșeuri - Modern", Author: "ADIGIDMB / SAMD" },
    });

    const now = new Date();
    const timestamp = new Intl.DateTimeFormat("ro-RO", {
      timeZone: "Europe/Bucharest",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(now).replace(/[.:]/g, "-").replace(/[, ]/g, "_");
    
    const filename = `Raport_depozitare_${timestamp}.pdf`;
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
    // MODERN HEADER with gradient accent
    // =========================
    const headerY = M;
    const headerH = 72;

    // Background card for header
    drawModernCard(doc, M, headerY, contentW, headerH, 20);

    // Gradient accent bar at top
    drawGradientBar(doc, M, headerY, contentW, 6, 20);

    // Logo (right, floating style)
    const logoPath = getLogoPath();
    const logoW = 140;
    const logoX = pageW - M - logoW - 16;
    const logoY = headerY + 18;
    if (logoPath && fs.existsSync(logoPath)) {
      try {
        doc.image(logoPath, logoX, logoY, { width: logoW });
      } catch {}
    }

    // Title - large and bold
    const titleY = headerY + 16;
    doc.fillColor(COLORS.text).font(FONT_BOLD).fontSize(24).text("Raport Depozitare Deșeuri", M + 20, titleY, {
      width: contentW - logoW - 60,
    });

    // Subtitle with location and period
    const locationText = filters.sector_id && filters.sector_id !== "all" 
      ? `Sector ${filters.sector_id}` 
      : "București";
    
    const subtitleY = titleY + 30;
    doc.fillColor(COLORS.textSoft).font(FONT_REG).fontSize(11).text(locationText, M + 20, subtitleY, {
      continued: true,
    });
    doc.fillColor(COLORS.textLight).font(FONT_REG).fontSize(11).text("  •  ", { continued: true });
    doc.fillColor(COLORS.textSoft).font(FONT_REG).fontSize(11).text(
      `${formatDateRO(filters.from)} – ${formatDateRO(filters.to)}`,
      { continued: false }
    );

    // =========================
    // KPI CARDS - Modern floating style
    // =========================
    const cardsY = headerY + headerH + 20;
    const cardH = 88;
    const cardGap = 16;
    const cardW = (contentW - cardGap * 3) / 4;

    const kpis = [
      { 
        title: "Total Deșeuri", 
        value: summary.total_tons_formatted || "0.00", 
        sub: "tone depozitate", 
        gradient: [COLORS.primary, COLORS.primaryDark],
        icon: "●"
      },
      { 
        title: "Tichete", 
        value: (summary.total_tickets || 0).toLocaleString("ro-RO"), 
        sub: "înregistrări", 
        gradient: [COLORS.accent, "#00B894"],
        icon: "◆"
      },
      { 
        title: "Medie Tichet", 
        value: Number(summary.avg_weight_per_ticket || 0).toFixed(2), 
        sub: "tone / tichet", 
        gradient: [COLORS.orange, "#FF5722"],
        icon: "▲"
      },
      { 
        title: "Perioadă", 
        value: String(summary.date_range?.days || 0), 
        sub: "zile analizate", 
        gradient: [COLORS.purple, "#6B46C1"],
        icon: "■"
      },
    ];

    kpis.forEach((k, i) => {
      const x = M + i * (cardW + cardGap);
      drawModernKpiCard(doc, x, cardsY, cardW, cardH, k, FONT_REG, FONT_BOLD);
    });

    // =========================
    // DATA SECTION
    // =========================
    const dataY = cardsY + cardH + 20;
    const sectionH = 220;
    
    // Monthly Evolution - Full width, prominent
    drawModernPanel(doc, M, dataY, contentW, sectionH, "Evoluție Lunară", FONT_REG, FONT_BOLD);
    drawModernLineChart(doc, M, dataY, contentW, sectionH, monthlyEvolution, FONT_REG, FONT_BOLD);

    // =========================
    // BOTTOM ROW - 3 columns
    // =========================
    const bottomY = dataY + sectionH + 16;
    const bottomH = 200;
    const col1W = Math.floor(contentW * 0.35);
    const col2W = Math.floor(contentW * 0.32);
    const col3W = contentW - col1W - col2W - 32;

    // Waste Codes
    drawModernPanel(doc, M, bottomY, col1W, bottomH, "Tipuri Deșeuri", FONT_REG, FONT_BOLD);
    drawModernWasteTable(doc, M, bottomY, col1W, bottomH, wasteCodes.slice(0, 6), FONT_REG, FONT_BOLD);

    // Sectors
    drawModernPanel(doc, M + col1W + 16, bottomY, col2W, bottomH, "Sectoare", FONT_REG, FONT_BOLD);
    drawModernSectorsTable(doc, M + col1W + 16, bottomY, col2W, bottomH, perSector, FONT_REG, FONT_BOLD);

    // Operators
    drawModernPanel(doc, M + col1W + col2W + 32, bottomY, col3W, bottomH, "Top Operatori", FONT_REG, FONT_BOLD);
    drawModernOperatorsTable(doc, M + col1W + col2W + 32, bottomY, col3W, bottomH, topOperators.slice(0, 5), FONT_REG, FONT_BOLD);

    // =========================
    // MODERN FOOTER
    // =========================
    const footerY = pageH - M - 16;
    
    doc.fillColor(COLORS.textLight).font(FONT_REG).fontSize(8).text(
      "Raport generat automat · SAMD",
      M,
      footerY,
      { width: contentW / 2, align: "left" }
    );

    doc.fillColor(COLORS.textLight).font(FONT_REG).fontSize(8).text(
      `Generat: ${generatedAt}`,
      M + contentW / 2,
      footerY,
      { width: contentW / 2, align: "right" }
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
// Helper Functions
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
// Modern Drawing Helpers
// =============================================================================

function drawModernCard(doc, x, y, w, h, r = 18) {
  // Shadow
  doc.save();
  doc.roundedRect(x + 2, y + 3, w, h, r).fillOpacity(0.06).fill("#000000");
  doc.fillOpacity(1);
  
  // Card
  doc.roundedRect(x, y, w, h, r).fill(COLORS.bgCard);
  doc.roundedRect(x, y, w, h, r).lineWidth(0.5).stroke(COLORS.border);
  doc.restore();
}

function drawGradientBar(doc, x, y, w, h, r) {
  // Simulate gradient with overlapping rectangles
  const steps = 20;
  const stepW = w / steps;
  
  for (let i = 0; i < steps; i++) {
    const ratio = i / steps;
    const color = interpolateColor(COLORS.primary, COLORS.accent, ratio);
    doc.rect(x + i * stepW, y, stepW + 1, h).fill(color);
  }
  
  // Smooth corners
  doc.roundedRect(x, y, w, h, r).clip();
}

function interpolateColor(color1, color2, ratio) {
  const c1 = parseInt(color1.slice(1), 16);
  const c2 = parseInt(color2.slice(1), 16);
  
  const r1 = (c1 >> 16) & 255;
  const g1 = (c1 >> 8) & 255;
  const b1 = c1 & 255;
  
  const r2 = (c2 >> 16) & 255;
  const g2 = (c2 >> 8) & 255;
  const b2 = c2 & 255;
  
  const r = Math.round(r1 + (r2 - r1) * ratio);
  const g = Math.round(g1 + (g2 - g1) * ratio);
  const b = Math.round(b1 + (b2 - b1) * ratio);
  
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

function drawModernKpiCard(doc, x, y, w, h, kpi, FONT_REG, FONT_BOLD) {
  drawModernCard(doc, x, y, w, h, 16);

  // Gradient accent top
  const accentH = 4;
  for (let i = 0; i < w; i++) {
    const ratio = i / w;
    const color = interpolateColor(kpi.gradient[0], kpi.gradient[1], ratio);
    doc.rect(x + i, y, 1, accentH).fill(color);
  }

  // Icon with gradient color
  doc.fillColor(kpi.gradient[0]).font(FONT_BOLD).fontSize(20).text(kpi.icon, x + 16, y + 16);

  // Title
  doc.fillColor(COLORS.textLight).font(FONT_REG).fontSize(9).text(kpi.title.toUpperCase(), x + 16, y + 20, {
    width: w - 32,
  });

  // Value - large and prominent
  doc.fillColor(COLORS.text).font(FONT_BOLD).fontSize(26).text(safeText(kpi.value), x + 16, y + 36, {
    width: w - 32,
  });

  // Subtitle
  doc.fillColor(COLORS.textSoft).font(FONT_REG).fontSize(9).text(kpi.sub, x + 16, y + 66, {
    width: w - 32,
  });
}

function drawModernPanel(doc, x, y, w, h, title, FONT_REG, FONT_BOLD) {
  drawModernCard(doc, x, y, w, h, 18);

  // Title with colored dot
  doc.fillColor(COLORS.primary).font(FONT_BOLD).fontSize(8).text("●", x + 16, y + 16);
  doc.fillColor(COLORS.text).font(FONT_BOLD).fontSize(12).text(title, x + 26, y + 14, {
    width: w - 42,
  });

  // Subtle divider
  doc.save();
  doc.moveTo(x + 16, y + 36)
    .lineTo(x + w - 16, y + 36)
    .lineWidth(1)
    .strokeColor(COLORS.gridLight)
    .stroke();
  doc.restore();
}

function beginClip(doc, x, y, w, h, r) {
  doc.save();
  doc.roundedRect(x, y, w, h, r).clip();
}

function endClip(doc) {
  doc.restore();
}

// =============================================================================
// Modern Tables
// =============================================================================

function drawModernWasteTable(doc, x, y, w, h, rows, FONT_REG, FONT_BOLD) {
  beginClip(doc, x, y, w, h, 18);

  const tableX = x + 16;
  const tableY = y + 44;
  const tableW = w - 32;

  let cy = tableY;
  const rowH = 24;

  rows.forEach((r, idx) => {
    // Alternating background
    if (idx % 2 === 1) {
      doc.rect(tableX - 8, cy - 2, tableW + 16, rowH).fill(COLORS.bg);
    }

    const code = r.waste_code || "—";
    const tons = r.total_tons_formatted || "0.00";

    // Code with colored circle
    const circleColor = idx % 3 === 0 ? COLORS.primary : idx % 3 === 1 ? COLORS.accent : COLORS.orange;
    doc.circle(tableX, cy + 6, 3).fill(circleColor);
    
    doc.fillColor(COLORS.text).font(FONT_BOLD).fontSize(10).text(code, tableX + 10, cy, {
      width: tableW - 60,
    });

    // Tons on right
    doc.fillColor(COLORS.textSoft).font(FONT_REG).fontSize(10).text(tons, tableX + tableW - 50, cy, {
      width: 50,
      align: "right",
    });

    // Description below (tiny)
    if (r.waste_description) {
      const desc = ellipsisOneLine(doc, r.waste_description, tableW - 10, FONT_REG, 7);
      doc.fillColor(COLORS.textLight).font(FONT_REG).fontSize(7).text(desc, tableX + 10, cy + 12, {
        width: tableW - 10,
      });
    }

    cy += rowH;
  });

  endClip(doc);
}

function drawModernSectorsTable(doc, x, y, w, h, sectors, FONT_REG, FONT_BOLD) {
  beginClip(doc, x, y, w, h, 18);

  const rows = [...sectors].sort((a, b) => (b.total_tons || 0) - (a.total_tons || 0)).slice(0, 6);

  const tableX = x + 16;
  const tableY = y + 44;
  const tableW = w - 32;

  let cy = tableY;
  const rowH = 24;

  rows.forEach((r, idx) => {
    if (idx % 2 === 1) {
      doc.rect(tableX - 8, cy - 2, tableW + 16, rowH).fill(COLORS.bg);
    }

    // Sector badge
    doc.roundedRect(tableX, cy + 2, 32, 16, 8).fill(COLORS.primary);
    doc.fillColor("#FFFFFF").font(FONT_BOLD).fontSize(9).text(`S${r.sector_number}`, tableX, cy + 6, {
      width: 32,
      align: "center",
    });

    // Tons
    const tons = r.total_tons_formatted || "0.00";
    doc.fillColor(COLORS.text).font(FONT_BOLD).fontSize(11).text(tons, tableX + 40, cy + 4, {
      width: tableW - 50,
    });

    cy += rowH;
  });

  endClip(doc);
}

function drawModernOperatorsTable(doc, x, y, w, h, ops, FONT_REG, FONT_BOLD) {
  beginClip(doc, x, y, w, h, 18);

  const tableX = x + 16;
  const tableY = y + 44;
  const tableW = w - 32;

  let cy = tableY;
  const rowH = 28;

  ops.forEach((r, idx) => {
    if (idx % 2 === 1) {
      doc.rect(tableX - 8, cy - 2, tableW + 16, rowH).fill(COLORS.bg);
    }

    // Rank badge
    const rankColors = [COLORS.primary, COLORS.accent, COLORS.purple, COLORS.orange, COLORS.textSoft];
    doc.circle(tableX + 8, cy + 10, 8).fill(rankColors[idx] || COLORS.textSoft);
    doc.fillColor("#FFFFFF").font(FONT_BOLD).fontSize(9).text(String(idx + 1), tableX + 5, cy + 6, {
      width: 6,
      align: "center",
    });

    // Operator name
    const name = ellipsisOneLine(doc, r.institution_name || "—", tableW - 70, FONT_BOLD, 9);
    doc.fillColor(COLORS.text).font(FONT_BOLD).fontSize(9).text(name, tableX + 24, cy + 2, {
      width: tableW - 94,
    });

    // Tons
    const tons = r.total_tons_formatted || "0.00";
    doc.fillColor(COLORS.textSoft).font(FONT_REG).fontSize(9).text(tons, tableX + tableW - 70, cy + 2, {
      width: 70,
      align: "right",
    });

    // Sectors below
    const sectors = safeText(r.sector_numbers_display || (Array.isArray(r.sector_numbers) ? r.sector_numbers.join(", ") : "—"));
    doc.fillColor(COLORS.textLight).font(FONT_REG).fontSize(7).text(`Sectoare: ${sectors}`, tableX + 24, cy + 14, {
      width: tableW - 24,
    });

    cy += rowH;
  });

  endClip(doc);
}

// =============================================================================
// Modern Line Chart
// =============================================================================

function drawModernLineChart(doc, x, y, w, h, monthlyEvolution, FONT_REG, FONT_BOLD) {
  const padL = 60;
  const padR = 20;
  const padT = 54;
  const padB = 32;

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
  const step = max / 4;

  // Grid lines - subtle
  doc.save();
  doc.lineWidth(0.5).strokeColor(COLORS.gridLight);
  for (let i = 0; i <= 4; i++) {
    const gy = chartY + (chartH * i) / 4;
    doc.moveTo(chartX, gy).lineTo(chartX + chartW, gy).stroke();
  }
  doc.restore();

  // Y-axis labels - modern style
  doc.fillColor(COLORS.textLight).font(FONT_REG).fontSize(8);
  for (let i = 0; i <= 4; i++) {
    const val = max - step * i;
    const gy = chartY + (chartH * i) / 4;
    doc.text(Math.round(val).toLocaleString("ro-RO"), x + 16, gy - 4, {
      width: padL - 24,
      align: "right",
    });
  }

  // X-axis labels
  const n = 12;
  const stepX = chartW / (n - 1);
  doc.fillColor(COLORS.textSoft).font(FONT_REG).fontSize(9);
  for (let i = 0; i < n; i++) {
    const lx = chartX + stepX * i;
    doc.text(monthsRO[i], lx - 15, chartY + chartH + 12, {
      width: 30,
      align: "center",
    });
  }

  // Calculate points
  const pts = values.map((v, i) => ({
    x: chartX + stepX * i,
    y: chartY + chartH - (v / max) * chartH,
  }));

  // Gradient fill area
  doc.save();
  doc.moveTo(pts[0].x, chartY + chartH);
  pts.forEach((p) => doc.lineTo(p.x, p.y));
  doc.lineTo(pts[pts.length - 1].x, chartY + chartH);
  doc.closePath();
  doc.fillOpacity(0.1).fill(COLORS.primary);
  doc.fillOpacity(1);
  doc.restore();

  // Line with gradient effect (simulate with multiple segments)
  doc.save();
  doc.lineWidth(3).lineJoin("round").lineCap("round");
  for (let i = 0; i < pts.length - 1; i++) {
    const ratio = i / (pts.length - 1);
    const color = interpolateColor(COLORS.primary, COLORS.accent, ratio);
    doc.strokeColor(color);
    doc.moveTo(pts[i].x, pts[i].y).lineTo(pts[i + 1].x, pts[i + 1].y).stroke();
  }
  doc.restore();

  // Dots with shadow
  doc.save();
  pts.forEach((p) => {
    // Shadow
    doc.circle(p.x + 1, p.y + 1, 5).fillOpacity(0.2).fill("#000000");
    doc.fillOpacity(1);
    // Dot
    doc.circle(p.x, p.y, 5).fill(COLORS.bgCard);
    doc.circle(p.x, p.y, 5).lineWidth(2.5).stroke(COLORS.primary);
  });
  doc.restore();
}