// src/controllers/dashboardExportController.js
import PDFDocument from "pdfkit";
import path from "path";
import { fileURLToPath } from "url";
import { createCanvas } from "canvas";
import Chart from "chart.js/auto";

import dashboardLandfillController from "./dashboardLandfillController.js";

/**
 * Export Dashboard Landfill - ONE PAGE, REAL DATA (same as /stats)
 * - reuses dashboardLandfillController.getStats => same RBAC, same filters, same sector mapping
 * - 1 page guaranteed (layout calculated)
 * - diacritics OK with TTF font
 */
export const exportLandfillDashboard = async (req, res) => {
  try {
    // 1) Get SAME payload as /stats
    const payload = await captureGetStats(req);

    if (!payload?.success) {
      return res.status(400).json(payload || { success: false, message: "Nu pot genera raportul." });
    }

    const data = payload.data || {};
    const filters = payload.filters_applied || {};

    // 2) Build “export model” from your real data
    const summary = data.summary || {};
    const perSector = Array.isArray(data.per_sector) ? data.per_sector : [];
    const topOperators = Array.isArray(data.top_operators) ? data.top_operators : [];

    // 3) Create PDF (A4 landscape)
    const doc = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margin: 28,
      info: {
        Title: "Raport Depozitare",
        Author: "SAMD",
      },
    });

    const filename = `raport-depozitare-${filters.from || "start"}-${filters.to || "end"}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    doc.pipe(res);

    // 4) Fonts (diacritics)
    const { fontRegular, fontBold } = getFonts();
    doc.registerFont("Inter", fontRegular);
    doc.registerFont("InterBold", fontBold);

    // Helpers
    const pageW = doc.page.width;
    const pageH = doc.page.height;
    const M = doc.page.margins.left; // same on all sides in your config
    const contentW = pageW - M * 2;

    const userName = [req.user?.firstName, req.user?.lastName].filter(Boolean).join(" ") || "Utilizator";
    const generatedAt = new Date().toLocaleString("ro-RO");

    // =========================
    // HEADER
    // =========================
    const headerH = 72;
    doc.save();
    doc.rect(0, 0, pageW, headerH).fill("#10b981");
    doc.restore();

    doc.font("InterBold").fontSize(20).fillColor("#ffffff")
      .text("RAPORT DEPOZITARE DEȘEURI", M, 18, { width: contentW });

    doc.font("Inter").fontSize(10).fillColor("#ffffff")
      .text(`Perioada: ${filters.from || "-"} → ${filters.to || "-"}`, M, 42, { width: contentW });

    doc.font("Inter").fontSize(10).fillColor("#ffffff")
      .text(`Generat de: ${userName} · ${generatedAt}`, M, 56, { width: contentW, align: "right" });

    doc.fillColor("#111827");

    // =========================
    // KPI CARDS (4)
    // =========================
    const cardsY = headerH + 16;
    const cardH = 72;
    const cardGap = 12;
    const cardW = (contentW - cardGap * 3) / 4;

    const kpis = [
      { title: "TOTAL TONE", value: summary.total_tons_formatted || "0.00", sub: "tone depozitate", color: "#10b981" },
      { title: "TOTAL TICHETE", value: (summary.total_tickets || 0).toLocaleString("ro-RO"), sub: "înregistrări", color: "#3b82f6" },
      { title: "MEDIE / TICHET", value: Number(summary.avg_weight_per_ticket || 0).toFixed(2), sub: "tone", color: "#f59e0b" },
      { title: "ZILE", value: String(summary.date_range?.days || 0), sub: "zile analizate", color: "#8b5cf6" },
    ];

    kpis.forEach((k, i) => {
      const x = M + i * (cardW + cardGap);
      drawKpiCard(doc, x, cardsY, cardW, cardH, k);
    });

    // =========================
    // CHARTS (2) - ONE ROW
    // =========================
    const chartsY = cardsY + cardH + 16;
    const chartH = 210;
    const leftW = Math.floor(contentW * 0.42);
    const rightW = contentW - leftW - 12;

    // Build chart data from your REAL stats:
    // Pie: per_sector (tone)
    const pieData = perSector.map(s => ({
      label: `S${s.sector_number}`,
      value: Number(s.total_tons || 0),
      color: s.color || "#10b981",
    }));

    // Bar: top_operators (tone)
    const barData = topOperators.slice(0, 5).map(o => ({
      label: o.institution_name || "—",
      value: Number(o.total_tons || 0),
    }));

    if (pieData.length) {
      const piePng = await makePieChart(pieData);
      doc.image(piePng, M, chartsY, { width: leftW, height: chartH });
      doc.font("InterBold").fontSize(11).fillColor("#111827")
        .text("Distribuție pe sectoare (tone)", M, chartsY + chartH + 6, { width: leftW });
    }

    if (barData.length) {
      const barPng = await makeHorizontalBar(barData);
      doc.image(barPng, M + leftW + 12, chartsY, { width: rightW, height: chartH });
      doc.font("InterBold").fontSize(11).fillColor("#111827")
        .text("Top 5 operatori (tone)", M + leftW + 12, chartsY + chartH + 6, { width: rightW });
    }

    // =========================
    // TABLE (compact) - keep 1 page
    // =========================
    const tableY = chartsY + chartH + 30;
    const footerH = 22;
    const maxTableH = pageH - M - footerH - tableY;

    drawSectorMiniTable(doc, M, tableY, contentW, Math.max(80, maxTableH), perSector, Number(summary.total_tons || 0));

    // =========================
    // FOOTER (always inside page)
    // =========================
    const footerY = pageH - M - 14;
    doc.font("Inter").fontSize(8.5).fillColor("#64748b")
      .text("Raport generat automat din SAMD · reflectă filtrele aplicate la momentul exportului.", M, footerY, {
        width: contentW,
        align: "left",
      });

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

async function captureGetStats(req) {
  return new Promise((resolve, reject) => {
    const fakeRes = {
      status(code) { this.statusCode = code; return this; },
      json(payload) { resolve(payload); },
    };
    dashboardLandfillController.getStats(req, fakeRes).catch(reject);
  });
}

function getFonts() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  // src/controllers -> src/assets/fonts
  const base = path.resolve(__dirname, "../assets/fonts");
  return {
    fontRegular: path.join(base, "Inter-Regular.ttf"),
    fontBold: path.join(base, "Inter-Bold.ttf"),
  };
}

function drawKpiCard(doc, x, y, w, h, { title, value, sub, color }) {
  // Card
  doc.save();
  doc.roundedRect(x, y, w, h, 12).fill("#ffffff");
  doc.roundedRect(x, y, w, h, 12).stroke("#e5e7eb");

  // Accent bar
  doc.rect(x, y, 5, h).fill(color);

  // Text
  doc.fillColor("#64748b").font("Inter").fontSize(9)
    .text(title, x + 14, y + 12, { width: w - 20 });

  doc.fillColor("#0f172a").font("InterBold").fontSize(18)
    .text(String(value), x + 14, y + 28, { width: w - 20 });

  doc.fillColor("#94a3b8").font("Inter").fontSize(9)
    .text(sub, x + 14, y + 54, { width: w - 20 });

  doc.restore();
}

async function makePieChart(items) {
  const canvas = createCanvas(520, 360);
  const ctx = canvas.getContext("2d");

  new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: items.map(i => i.label),
      datasets: [{
        data: items.map(i => i.value),
        backgroundColor: items.map(i => i.color),
        borderWidth: 2,
        borderColor: "#ffffff",
      }],
    },
    options: {
      responsive: false,
      cutout: "62%",
      plugins: {
        legend: { position: "bottom", labels: { boxWidth: 10, font: { size: 11 } } },
      },
    },
  });

  return canvas.toBuffer("image/png");
}

async function makeHorizontalBar(items) {
  const canvas = createCanvas(780, 360);
  const ctx = canvas.getContext("2d");

  const labels = items.map(i => (i.label.length > 28 ? i.label.slice(0, 25) + "..." : i.label));

  new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        data: items.map(i => i.value),
        backgroundColor: "#10b981",
        borderWidth: 1,
      }],
    },
    options: {
      responsive: false,
      indexAxis: "y",
      plugins: { legend: { display: false } },
      scales: { x: { beginAtZero: true } },
    },
  });

  return canvas.toBuffer("image/png");
}

function drawSectorMiniTable(doc, x, y, w, h, sectors, totalTons) {
  const rows = [...sectors].sort((a, b) => (b.total_tons || 0) - (a.total_tons || 0)).slice(0, 6);
  const rowH = 18;

  // Header
  doc.save();
  doc.roundedRect(x, y, w, h, 12).fill("#ffffff");
  doc.roundedRect(x, y, w, h, 12).stroke("#e5e7eb");

  doc.rect(x, y, w, 24).fill("#f8fafc");
  doc.font("InterBold").fontSize(10).fillColor("#334155")
    .text("Top sectoare (după tone)", x + 12, y + 7, { width: w - 24 });

  // Columns
  const col1 = x + 12;
  const col2 = x + Math.floor(w * 0.55);
  const col3 = x + Math.floor(w * 0.75);
  const col4 = x + w - 12;

  doc.font("InterBold").fontSize(9).fillColor("#64748b");
  doc.text("Sector", col1, y + 30);
  doc.text("Tichete", col2, y + 30, { width: 80, align: "right" });
  doc.text("Tone", col3, y + 30, { width: 80, align: "right" });
  doc.text("%", col4 - 30, y + 30, { width: 30, align: "right" });

  // Rows
  let cy = y + 46;
  doc.font("Inter").fontSize(9).fillColor("#0f172a");

  rows.forEach((r, idx) => {
    const tons = Number(r.total_tons || 0);
    const pct = totalTons > 0 ? ((tons / totalTons) * 100).toFixed(1) : "0.0";

    if (idx % 2 === 1) {
      doc.rect(x + 1, cy - 2, w - 2, rowH).fill("#fafafa");
    }

    doc.fillColor("#0f172a").font("InterBold").text(`S${r.sector_number}`, col1, cy, { width: 60 });
    doc.fillColor("#64748b").font("Inter").text(r.sector_name || "", col1 + 34, cy, { width: 220 });

    doc.fillColor("#0f172a").text(String((r.total_tickets || 0).toLocaleString("ro-RO")), col2, cy, { width: 80, align: "right" });
    doc.fillColor("#0f172a").text(String(r.total_tons_formatted || tons.toFixed(2)), col3, cy, { width: 80, align: "right" });
    doc.fillColor("#0f172a").text(`${pct}%`, col4 - 30, cy, { width: 30, align: "right" });

    cy += rowH;
  });

  doc.restore();
}
