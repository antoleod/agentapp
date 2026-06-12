let allData = [];
let _importParsed    = [];
let _auditAllEntries = [];
let _mathAnswer      = 0;  // correct answer for Delete All math check

document.addEventListener("appReady", async () => {
  if (getSettings().compactTable) document.querySelector(".table-wrap table")?.setAttribute("data-compact", "");

  // Show cached data instantly — guests never see another user's cache
  const isGuest = sessionStorage.getItem("guestSession") === "1";
  const cached  = isGuest ? [] : JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  if (cached.length) {
    allData = cached;
    renderTable(allData);
  } else {
    setTableLoading(true);
  }

  bindEvents();
  bindImportPreview();
  bindAuditModal();

  // Background incremental sync
  try {
    const fresh = await getData();
    if (JSON.stringify(fresh) !== JSON.stringify(allData)) {
      allData = fresh;
      renderTable(allData);
    }
  } catch (err) {
    if (!cached.length) toast("Failed to load data: " + err.message, "error");
  } finally {
    setTableLoading(false);
  }

  // Real-time listener for changes from other users
  subscribeData(data => {
    allData = data;
    renderTable(filterData(document.getElementById("searchInput").value));
  });
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") unsubscribeData();
  else subscribeData(data => {
    allData = data;
    renderTable(filterData(document.getElementById("searchInput")?.value || ""));
  });
});

function setTableLoading(on) {
  if (on) {
    document.getElementById("databaseBody").innerHTML =
      `<tr><td colspan="${7 + getKpiFields().length}"><div class="empty-state"><div class="spinner" style="border-top-color:var(--primary)"></div></div></td></tr>`;
  }
  // false → do nothing; renderTable() replaces the content
}

function scoreBadge(avg) {
  const cls = scoreClass(avg);
  return `<span class="score-badge ${cls}">${avg}</span>`;
}

function slaBadge(val) {
  return val === "Yes"
    ? `<span class="badge badge-danger">⚠ Yes</span>`
    : `<span class="badge badge-success">✓ No</span>`;
}

// Dynamic — rebuilt on every renderTable() call so new custom criteria appear immediately
function getKpiFields() {
  return getActiveCriteria().map(c => ({
    id:    c.id,
    label: c.builtin ? (scoreLabels[c.id] || c.id) : (c.label || c.id),
    abbr:  c.builtin ? (scoreLabels[c.id] || c.id).replace(/\s+/g, "").slice(0, 3).toUpperCase()
                     : (c.label || c.id).replace(/\s+/g, "").slice(0, 3).toUpperCase(),
  }));
}

function sortData(data) {
  const sort = getSettings().dbDefaultSort || "date_desc";
  const d = [...data];
  if (sort === "date_desc")  return d.sort((a,b) => (b.evaluationDate||"").localeCompare(a.evaluationDate||""));
  if (sort === "date_asc")   return d.sort((a,b) => (a.evaluationDate||"").localeCompare(b.evaluationDate||""));
  if (sort === "score_desc") return d.sort((a,b) => calculateAverage(b) - calculateAverage(a));
  if (sort === "score_asc")  return d.sort((a,b) => calculateAverage(a) - calculateAverage(b));
  if (sort === "agent_az")   return d.sort((a,b) => (a.agentName||"").localeCompare(b.agentName||""));
  if (sort === "ticket_asc") return d.sort((a,b) => (a.ticketNumber||"").localeCompare(b.ticketNumber||""));
  return d;
}

function paginateData(data) {
  const perPage = getSettings().dbRowsPerPage !== undefined ? Number(getSettings().dbRowsPerPage) : 50;
  if (!perPage) return data;
  return data.slice(0, perPage);
}

function renderTable(data) {
  const s    = getSettings();
  const showKpi           = s.dbShowKpi !== false;
  const highlightBreaches = s.dbHighlightBreaches !== false;

  const sorted    = sortData(data);
  const paginated = paginateData(sorted);
  const kpiFields = getKpiFields();

  // Rebuild KPI header columns dynamically
  const headRow = document.querySelector("#dbHead tr");
  if (headRow) {
    // Remove old kpi-col headers
    headRow.querySelectorAll(".kpi-col").forEach(th => th.remove());
    // Insert before the Avg th (second-to-last th before Actions)
    const avgTh = headRow.querySelector("[data-i18n='db.col_score']");
    kpiFields.forEach(({ abbr, label }) => {
      const th = document.createElement("th");
      th.className = "kpi-col";
      th.title     = label;
      th.textContent = abbr;
      th.style.display = showKpi ? "" : "none";
      headRow.insertBefore(th, avgTh);
    });
  }

  const totalCols = 7 + kpiFields.length; // checkbox+ticket+agent+date+sla+lsa + kpis + avg+evalby+actions
  const body = document.getElementById("databaseBody");

  if (!data.length) {
    body.innerHTML = `
      <tr><td colspan="${totalCols}">
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>
          </svg>
          <p>No evaluations found</p>
        </div>
      </td></tr>`;
    return;
  }

  // Reset select-all checkbox
  const selectAll = document.getElementById("selectAllRows");
  if (selectAll) selectAll.checked = false;

  body.innerHTML = paginated.map(item => {
    const avg    = calculateAverage(item);
    const ticket = escapeHtml(item.ticketNumber);
    const isBreach = item.slaBreach === "Yes";
    const rowClass = highlightBreaches && isBreach ? " class=\"row-breach\"" : "";
    const kpiCells = kpiFields.map(({ id, label }) => {
      const val = item[id];
      const display = showKpi ? "" : " style=\"display:none\"";
      if (!val && val !== 0) return `<td class="kpi-cell kpi-empty" title="${label}"${display}>—</td>`;
      const cls = val >= 4 ? "kpi-high" : val >= 3 ? "kpi-mid" : "kpi-low";
      return `<td class="kpi-cell ${cls}" title="${label}: ${val}"${display}>${val}</td>`;
    }).join("");
    return `
      <tr${rowClass}>
        <td style="text-align:center"><input type="checkbox" class="row-select" data-ticket="${ticket}" style="cursor:pointer"></td>
        <td><strong>${ticket}</strong></td>
        <td>${escapeHtml(item.agentName)}</td>
        <td>${escapeHtml(formatDisplayDate(item.evaluationDate))}</td>
        <td>${slaBadge(item.slaBreach)}</td>
        <td>${escapeHtml(item.lsa || "—")}</td>
        ${kpiCells}
        <td>${scoreBadge(avg)}</td>
        <td>${escapeHtml(item.evaluatedBy || "—")}</td>
        <td>
          <div class="td-actions">
            <a class="btn btn-secondary btn-sm"
               href="form.html?edit=${encodeURIComponent(item.ticketNumber)}">${t("db.edit")}</a>
            <button class="btn btn-ghost btn-sm" data-action="open" data-ticket="${ticket}">${t("db.open")}</button>
            <button class="btn btn-ghost btn-sm" data-action="report" data-ticket="${ticket}" title="Export PDF report">&#x1F4C4;</button>
            <button class="btn btn-danger btn-sm btn-icon" data-action="delete" data-ticket="${ticket}" title="Delete evaluation"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;pointer-events:none"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg></button>
          </div>
        </td>
      </tr>`;
  }).join("");
}

async function confirmDelete(ticketNumber) {
  if (getSettings().confirmDeleteSingle !== false) {
    if (!confirm(`Delete evaluation ${ticketNumber}? This cannot be undone.`)) return;
  }
  const snapshot = allData.find(x => x.ticketNumber === ticketNumber) || null;
  try {
    await deleteEvaluation(ticketNumber, snapshot);
    allData = allData.filter(x => x.ticketNumber !== ticketNumber);
    renderTable(filterData(document.getElementById("searchInput").value));
    toast(`${ticketNumber} deleted.`, "success");
  } catch (err) {
    toast("Delete failed: " + err.message, "error");
  }
}

function filterData(q) {
  if (!q) return allData;
  const s = q.toLowerCase();
  return allData.filter(x =>
    x.ticketNumber.toLowerCase().includes(s) ||
    x.agentName.toLowerCase().includes(s) ||
    (x.lsa || "").toLowerCase().includes(s)
  );
}

function exportCsv(data) {
  const criteria = getActiveCriteria();
  const headers = [
    "Ticket Number", "Agent Name", "Evaluation Date", "SLA Breach",
    "LSA", "Evaluated By",
    ...criteria.map(c => c.builtin ? (scoreLabels[c.id] || c.id) : (c.label || c.id)),
    "Average Score", "Comments", "Created At",
  ];
  const rows = data.map(item => {
    const avg = calculateAverage(item);
    const esc = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
    return [
      esc(item.ticketNumber), esc(item.agentName), esc(item.evaluationDate),
      esc(item.slaBreach), esc(item.lsa), esc(item.evaluatedBy),
      ...criteria.map(c => esc(item[c.id] ?? "")),
      esc(avg), esc(item.comments), esc(item.createdAt),
    ].join(",");
  });
  return [headers.join(","), ...rows].join("\r\n");
}

function exportTicketReport(item) {
  const avg      = calculateAverage(item);
  const criteria = getActiveCriteria();
  const isBreach = item.slaBreach === "Yes";
  const esc      = escapeHtml;

  const scoreBar = v => {
    if (!v && v !== 0) return `<span class="score-empty">—</span>`;
    const pct   = (v / 5) * 100;
    const color = v >= 4 ? "#22c55e" : v >= 3 ? "#f59e0b" : "#ef4444";
    return `<div class="score-row">
      <span class="score-num">${v}</span>
      <div class="score-track"><div class="score-fill" style="width:${pct}%;background:${color}"></div></div>
    </div>`;
  };

  const scoreRows = criteria.map(c => {
    const label = c.builtin ? (scoreLabels[c.id] || c.id) : (c.label || c.id);
    return `<tr>
      <td class="crit-label">${esc(label)}</td>
      <td class="crit-score">${scoreBar(item[c.id])}</td>
    </tr>`;
  }).join("");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Evaluation Report — ${esc(item.ticketNumber)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 13px; color: #1a1a2e; background: #fff; padding: 32px; max-width: 760px; margin: 0 auto; }
  @media print { body { padding: 16px; } .no-print { display: none; } }
  h1 { font-size: 22px; font-weight: 700; margin-bottom: 4px; }
  .subtitle { color: #666; font-size: 13px; margin-bottom: 24px; }
  .badge-breach { display:inline-block; background:#fee2e2; color:#b91c1c; border:1px solid #fca5a5; border-radius:4px; padding:2px 8px; font-size:11px; font-weight:700; }
  .badge-ok    { display:inline-block; background:#dcfce7; color:#166534; border:1px solid #86efac; border-radius:4px; padding:2px 8px; font-size:11px; font-weight:700; }
  .section { border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px 20px; margin-bottom: 16px; }
  .section h2 { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: #9ca3af; margin-bottom: 12px; }
  .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 24px; }
  .meta-item label { font-size: 11px; color: #6b7280; display: block; margin-bottom: 2px; }
  .meta-item span  { font-weight: 600; font-size: 13px; }
  table.scores { width: 100%; border-collapse: collapse; }
  table.scores td { padding: 7px 0; border-bottom: 1px solid #f3f4f6; vertical-align: middle; }
  table.scores tr:last-child td { border-bottom: none; }
  .crit-label { color: #374151; width: 50%; }
  .crit-score { width: 50%; }
  .score-row  { display: flex; align-items: center; gap: 8px; }
  .score-num  { font-weight: 700; width: 16px; text-align: right; flex-shrink: 0; }
  .score-track { flex: 1; height: 8px; background: #f3f4f6; border-radius: 99px; overflow: hidden; }
  .score-fill  { height: 100%; border-radius: 99px; transition: width .3s; }
  .score-empty { color: #9ca3af; }
  .avg-block  { display: flex; align-items: center; gap: 12px; }
  .avg-big    { font-size: 36px; font-weight: 800; line-height: 1; }
  .avg-sub    { font-size: 12px; color: #6b7280; }
  .comments-text { white-space: pre-wrap; color: #374151; line-height: 1.6; font-size: 13px; }
  .footer { margin-top: 24px; font-size: 11px; color: #9ca3af; border-top: 1px solid #f3f4f6; padding-top: 12px; display: flex; justify-content: space-between; }
  .print-btn { display: inline-block; margin-bottom: 20px; padding: 8px 20px; background: #4f46e5; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 600; }
  .print-btn:hover { background: #4338ca; }
</style>
</head>
<body>
  <button class="print-btn no-print" onclick="window.print()">&#x1F5A8; Print / Save as PDF</button>
  <h1>${esc(item.ticketNumber)}</h1>
  <p class="subtitle">Agent Evaluation Report</p>

  <div class="section">
    <h2>Ticket Details</h2>
    <div class="meta-grid">
      <div class="meta-item"><label>Ticket Number</label><span>${esc(item.ticketNumber)}</span></div>
      <div class="meta-item"><label>Agent</label><span>${esc(item.agentName)}</span></div>
      <div class="meta-item"><label>Evaluation Date</label><span>${esc(formatDisplayDate(item.evaluationDate))}</span></div>
      <div class="meta-item"><label>SLA Breach</label><span>${isBreach ? '<span class="badge-breach">YES</span>' : '<span class="badge-ok">NO</span>'}</span></div>
      ${item.lsa ? `<div class="meta-item"><label>LSA</label><span>${esc(item.lsa)}</span></div>` : ""}
      <div class="meta-item"><label>Evaluated By</label><span>${esc(item.evaluatedBy || "—")}</span></div>
      ${item.createdAt ? `<div class="meta-item"><label>Recorded At</label><span>${esc(typeof item.createdAt === "object" ? item.evaluationDate : item.createdAt)}</span></div>` : ""}
    </div>
  </div>

  <div class="section">
    <h2>Scores</h2>
    <table class="scores">${scoreRows}</table>
  </div>

  <div class="section">
    <h2>Overall Score</h2>
    <div class="avg-block">
      <div class="avg-big" style="color:${avg >= 4 ? '#22c55e' : avg >= 3 ? '#f59e0b' : '#ef4444'}">${avg.toFixed(2)}</div>
      <div class="avg-sub">out of 5.00</div>
    </div>
  </div>

  ${item.comments ? `<div class="section">
    <h2>Comments</h2>
    <p class="comments-text">${esc(item.comments)}</p>
  </div>` : ""}

  <div class="footer">
    <span>Generated from Agent Evaluation Tool</span>
    <span>${new Date().toLocaleString()}</span>
  </div>
</body>
</html>`;

  const win = window.open("", "_blank");
  if (!win) { toast("Pop-up blocked. Allow pop-ups and try again.", "warning"); return; }
  win.document.write(html);
  win.document.close();
}

function exportMultiTicketReport(items) {
  const criteria = getActiveCriteria();
  const esc      = escapeHtml;

  const scoreBar = v => {
    if (!v && v !== 0) return `<span style="color:#9ca3af">—</span>`;
    const pct   = (v / 5) * 100;
    const color = v >= 4 ? "#22c55e" : v >= 3 ? "#f59e0b" : "#ef4444";
    return `<span style="font-weight:700;color:${color};margin-right:6px">${v}</span><span style="display:inline-block;vertical-align:middle;width:60px;height:6px;background:#f3f4f6;border-radius:99px;overflow:hidden"><span style="display:block;width:${pct}%;height:100%;background:${color}"></span></span>`;
  };

  const ticketCards = items.map((item, idx) => {
    const avg      = calculateAverage(item);
    const isBreach = item.slaBreach === "Yes";
    const scoreRows = criteria.map(c => {
      const label = c.builtin ? (scoreLabels[c.id] || c.id) : (c.label || c.id);
      return `<tr><td style="padding:5px 0;color:#374151;width:50%;font-size:12px">${esc(label)}</td><td style="padding:5px 0">${scoreBar(item[c.id])}</td></tr>`;
    }).join("");
    return `
    <div style="${idx > 0 ? "page-break-before:always;" : ""}border:1px solid #e5e7eb;border-radius:8px;padding:20px;margin-bottom:24px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid #f3f4f6">
        <div>
          <h2 style="font-size:18px;font-weight:700;margin-bottom:2px">${esc(item.ticketNumber)}</h2>
          <p style="font-size:12px;color:#6b7280">${esc(item.agentName)} · ${esc(formatDisplayDate(item.evaluationDate))}</p>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          ${isBreach ? '<span style="background:#fee2e2;color:#b91c1c;border:1px solid #fca5a5;border-radius:4px;padding:2px 8px;font-size:11px;font-weight:700">SLA BREACH</span>' : '<span style="background:#dcfce7;color:#166534;border:1px solid #86efac;border-radius:4px;padding:2px 8px;font-size:11px;font-weight:700">SLA OK</span>'}
          <span style="font-size:22px;font-weight:800;color:${avg >= 4 ? '#22c55e' : avg >= 3 ? '#f59e0b' : '#ef4444'}">${avg.toFixed(2)}</span>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 24px;margin-bottom:14px;font-size:12px">
        ${item.lsa ? `<div><span style="color:#6b7280">LSA:</span> <strong>${esc(item.lsa)}</strong></div>` : ""}
        ${item.evaluatedBy ? `<div><span style="color:#6b7280">Evaluated by:</span> <strong>${esc(item.evaluatedBy)}</strong></div>` : ""}
      </div>
      <table style="width:100%;border-collapse:collapse">${scoreRows}</table>
      ${item.comments ? `<div style="margin-top:12px;padding:10px 12px;background:#f9fafb;border-radius:6px;font-size:12px;color:#374151;white-space:pre-wrap">${esc(item.comments)}</div>` : ""}
    </div>`;
  }).join("");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Evaluation Report — ${items.length} ticket${items.length !== 1 ? "s" : ""}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 13px; color: #1a1a2e; background: #fff; padding: 28px; max-width: 800px; margin: 0 auto; }
  @media print { body { padding: 12px; } .no-print { display: none; } }
  .print-btn { display: inline-block; margin-bottom: 20px; padding: 8px 20px; background: #4f46e5; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 600; }
  .print-btn:hover { background: #4338ca; }
</style>
</head>
<body>
  <button class="print-btn no-print" onclick="window.print()">&#x1F5A8; Print / Save as PDF</button>
  <div style="margin-bottom:20px;padding-bottom:16px;border-bottom:2px solid #e5e7eb">
    <h1 style="font-size:20px;font-weight:700">Agent Evaluation Report</h1>
    <p style="font-size:12px;color:#6b7280;margin-top:4px">${items.length} evaluation${items.length !== 1 ? "s" : ""} · Generated ${new Date().toLocaleString()}</p>
  </div>
  ${ticketCards}
</body>
</html>`;

  const win = window.open("", "_blank");
  if (!win) { toast("Pop-up blocked. Allow pop-ups and try again.", "warning"); return; }
  win.document.write(html);
  win.document.close();
}

function getSelectedTickets() {
  return [...document.querySelectorAll(".row-select:checked")].map(cb => cb.dataset.ticket);
}

function updatePdfLabel() {
  const sel = getSelectedTickets();
  const label = document.getElementById("exportPdfLabel");
  if (label) label.textContent = sel.length ? `Export PDF (${sel.length})` : "Export PDF";
}

function bindEvents() {
  let debounce;
  document.getElementById("searchInput").addEventListener("input", e => {
    clearTimeout(debounce);
    debounce = setTimeout(() => renderTable(filterData(e.target.value)), 200);
  });

  // Select-all checkbox in header
  document.getElementById("selectAllRows")?.addEventListener("change", e => {
    document.querySelectorAll(".row-select").forEach(cb => { cb.checked = e.target.checked; });
    updatePdfLabel();
  });

  // Row checkbox — update PDF label and header checkbox state
  document.getElementById("databaseBody").addEventListener("change", e => {
    if (e.target.classList.contains("row-select")) {
      const all  = document.querySelectorAll(".row-select");
      const chkd = document.querySelectorAll(".row-select:checked");
      const hdr  = document.getElementById("selectAllRows");
      if (hdr) { hdr.checked = all.length && chkd.length === all.length; hdr.indeterminate = chkd.length > 0 && chkd.length < all.length; }
      updatePdfLabel();
    }
  });

  document.getElementById("databaseBody").addEventListener("click", e => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const ticket = btn.dataset.ticket;
    if (btn.dataset.action === "open")   openServiceNow(ticket);
    if (btn.dataset.action === "delete") confirmDelete(ticket);
    if (btn.dataset.action === "report") {
      const item = allData.find(x => x.ticketNumber === ticket);
      if (item) exportTicketReport(item);
    }
  });

  // PDF export — selected rows, or all if none selected
  document.getElementById("exportPdfBtn")?.addEventListener("click", () => {
    const selected = getSelectedTickets();
    const items    = selected.length
      ? allData.filter(x => selected.includes(x.ticketNumber))
      : allData;
    if (!items.length) { toast("No data to export.", "warning"); return; }
    exportMultiTicketReport(items);
  });

  document.getElementById("exportJsonBtn").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(allData, null, 2)], { type: "application/json" });
    const a    = Object.assign(document.createElement("a"), {
      href:     URL.createObjectURL(blob),
      download: `agent-evaluations-${today()}.json`,
    });
    a.click();
    toast("JSON export downloaded.", "success");
  });

  document.getElementById("exportCsvBtn")?.addEventListener("click", () => {
    const blob = new Blob([exportCsv(allData)], { type: "text/csv;charset=utf-8;" });
    const a    = Object.assign(document.createElement("a"), {
      href:     URL.createObjectURL(blob),
      download: `agent-evaluations-${today()}.csv`,
    });
    a.click();
    toast("CSV export downloaded.", "success");
  });

  // Export dropdown toggle
  const exportDropdownBtn  = document.getElementById("exportDropdownBtn");
  const exportDropdownMenu = document.getElementById("exportDropdownMenu");
  if (exportDropdownBtn && exportDropdownMenu) {
    exportDropdownBtn.addEventListener("click", e => {
      e.stopPropagation();
      const open = !exportDropdownMenu.hidden;
      exportDropdownMenu.hidden = open;
      exportDropdownBtn.setAttribute("aria-expanded", String(!open));
    });
    exportDropdownMenu.addEventListener("click", () => {
      exportDropdownMenu.hidden = true;
      exportDropdownBtn.setAttribute("aria-expanded", "false");
    });
    document.addEventListener("click", () => {
      exportDropdownMenu.hidden = true;
      exportDropdownBtn.setAttribute("aria-expanded", "false");
    });
  }

  // Delete All — open math confirm modal
  document.getElementById("deleteAllBtn").addEventListener("click", () => {
    if (!allData.length) { toast("Nothing to delete.", "warning"); return; }
    const a = Math.floor(Math.random() * 20) + 5;
    const b = Math.floor(Math.random() * 30) + 10;
    _mathAnswer = a + b;
    document.getElementById("mathQuestion").textContent  = `${a} + ${b} = ?`;
    document.getElementById("mathAnswer").value          = "";
    document.getElementById("mathError").textContent     = "";
    document.getElementById("mathConfirmCount").textContent = `all ${allData.length}`;
    document.getElementById("mathConfirmModal").hidden   = false;
    setTimeout(() => document.getElementById("mathAnswer").focus(), 50);
  });

  document.getElementById("mathConfirmClose")?.addEventListener("click",  () => { document.getElementById("mathConfirmModal").hidden = true; });
  document.getElementById("mathConfirmCancel")?.addEventListener("click", () => { document.getElementById("mathConfirmModal").hidden = true; });

  document.getElementById("mathAnswer")?.addEventListener("keydown", e => {
    if (e.key === "Enter") document.getElementById("mathConfirmSubmit").click();
    if (e.key === "Escape") document.getElementById("mathConfirmModal").hidden = true;
  });

  document.getElementById("mathConfirmSubmit")?.addEventListener("click", async () => {
    const answer = Number(document.getElementById("mathAnswer").value);
    if (answer !== _mathAnswer) {
      document.getElementById("mathError").textContent = "Incorrect answer. Try again.";
      document.getElementById("mathAnswer").focus();
      return;
    }
    document.getElementById("mathConfirmModal").hidden = true;
    const btn = document.getElementById("deleteAllBtn");
    btn.disabled    = true;
    btn.textContent = "Deleting…";
    try {
      const batch = window.db.batch();
      allData.forEach(item => {
        batch.delete(window.db.collection(COLLECTION).doc(item.ticketNumber));
      });
      await batch.commit();
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(SYNC_KEY);
      allData = [];
      renderTable([]);
      toast("All evaluations deleted.", "success");
    } catch (err) {
      toast("Delete failed: " + err.message, "error");
    } finally {
      btn.disabled    = false;
      btn.textContent = "Delete All";
    }
  });
}

// ── Import validation + preview ───────────────────────────────────────────────

function validateRow(item, existingTickets) {
  const errors   = [];
  const warnings = [];

  if (!item || typeof item.ticketNumber !== "string" || !item.ticketNumber.trim()) {
    errors.push("Missing ticket number");
    return { errors, warnings, level: "error" };
  }

  if (!item.agentName) warnings.push("Missing agent name");
  if (!item.evaluationDate || !/^\d{4}-\d{2}-\d{2}$/.test(item.evaluationDate))
    warnings.push("Invalid date format (expected YYYY-MM-DD)");
  if (item.slaBreach && !["Yes", "No"].includes(item.slaBreach))
    warnings.push("SLA Breach must be Yes or No");

  getActiveCriteria().forEach(c => {
    const v = item[c.id];
    if (v !== undefined && v !== "" && v !== null) {
      const n = Number(v);
      if (isNaN(n) || n < 1 || n > 5)
        warnings.push(`Score "${c.builtin ? t(c.labelKey) : c.label}" out of range (1–5)`);
    }
  });

  if (existingTickets.has(item.ticketNumber.trim()))
    warnings.push("Will overwrite existing record");

  const level = errors.length ? "error" : warnings.length ? "warning" : "valid";
  return { errors, warnings, level };
}

function bindImportPreview() {
  const modal       = document.getElementById("importPreviewModal");
  const closeBtn    = document.getElementById("importPreviewClose");
  const cancelBtn   = document.getElementById("importPreviewCancel");
  const confirmBtn  = document.getElementById("importConfirmBtn");
  const selectAll   = document.getElementById("importSelectAll");
  const previewBody = document.getElementById("importPreviewBody");
  const labelEl     = document.getElementById("importConfirmLabel");

  function closeModal() {
    modal.hidden = true;
    document.body.style.overflow = "";
    document.getElementById("importJsonInput").value = "";
  }

  closeBtn.addEventListener("click",  closeModal);
  cancelBtn.addEventListener("click", closeModal);
  modal.addEventListener("click", e => { if (e.target === modal) closeModal(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !modal.hidden) closeModal(); });

  function updateConfirmLabel() {
    const checked = previewBody.querySelectorAll("input[type=checkbox]:checked").length;
    labelEl.textContent = `Import ${checked} selected`;
    confirmBtn.disabled = checked === 0;
  }

  selectAll.addEventListener("change", () => {
    previewBody.querySelectorAll("input[type=checkbox]:not(:disabled)").forEach(cb => {
      cb.checked = selectAll.checked;
    });
    updateConfirmLabel();
  });

  previewBody.addEventListener("change", e => {
    if (e.target.type === "checkbox") updateConfirmLabel();
  });

  confirmBtn.addEventListener("click", async () => {
    const selectedIdxs = [...previewBody.querySelectorAll("input[type=checkbox]:checked")]
      .map(cb => parseInt(cb.dataset.idx, 10));
    const toImport = selectedIdxs.map(i => _importParsed[i]).filter(Boolean);
    if (!toImport.length) return;

    function sanitizeImportRow(item) {
      const allowed = new Set([
        "ticketNumber", "agentName", "evaluationDate", "slaBreach", "lsa",
        "comments", "evaluatedBy", "createdBy", "createdAt",
        ...getActiveCriteria().map(c => c.id),
      ]);
      const out = {};
      for (const key of allowed) {
        if (key in item) out[key] = item[key];
      }
      return out;
    }

    confirmBtn.disabled = true;
    confirmBtn.querySelector("span").textContent = "Importing…";
    try {
      const batch = window.db.batch();
      toImport.forEach(item => {
        const ref = window.db.collection(COLLECTION).doc(item.ticketNumber.trim());
        batch.set(ref, { ...sanitizeImportRow(item), updatedAt: firebase.firestore.FieldValue.serverTimestamp(), createdAt: item.createdAt || firebase.firestore.FieldValue.serverTimestamp() });
      });
      await batch.commit();

      // Single bulk audit entry
      logAudit({
        action:      "import",
        ticketNumber: "",
        agentName:   "",
        evaluationDate: "",
        importCount: toImport.length,
        tickets:     toImport.map(x => x.ticketNumber),
      });

      allData = await getData({ forceFullSync: true });
      renderTable(allData);
      toast(`${toImport.length} evaluation${toImport.length !== 1 ? "s" : ""} imported.`, "success");
      closeModal();
    } catch (err) {
      toast("Import failed: " + err.message, "error");
      confirmBtn.disabled = false;
      confirmBtn.querySelector("span").textContent = `Import ${selectedIdxs.length} selected`;
    }
  });

  // Wire file input to validation preview
  document.getElementById("importJsonInput").addEventListener("change", e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!Array.isArray(parsed)) throw new Error("Expected a JSON array.");
        showImportPreview(parsed);
      } catch (err) {
        toast("Import failed: " + err.message, "error");
        e.target.value = "";
      }
    };
    reader.readAsText(file);
  });

  function showImportPreview(parsed) {
    _importParsed = parsed;
    const existingTickets = new Set(allData.map(x => x.ticketNumber));

    const validated = parsed.map((item, idx) => ({
      idx,
      item,
      ...validateRow(item, existingTickets),
    }));

    const counts = { valid: 0, warning: 0, error: 0 };
    validated.forEach(r => counts[r.level]++);

    document.getElementById("importPreviewTitle").textContent =
      `Import Preview — ${parsed.length} record${parsed.length !== 1 ? "s" : ""}`;

    document.getElementById("importSummaryBar").innerHTML = [
      counts.valid   && `<span class="imp-pill valid">✓ ${counts.valid} valid</span>`,
      counts.warning && `<span class="imp-pill warning">⚠ ${counts.warning} warning${counts.warning !== 1 ? "s" : ""}</span>`,
      counts.error   && `<span class="imp-pill error">✗ ${counts.error} error${counts.error !== 1 ? "s" : ""}</span>`,
    ].filter(Boolean).join("");

    previewBody.innerHTML = validated.map(r => {
      const isError   = r.level === "error";
      const statusIcon = isError
        ? `<span class="import-status-icon error">✗</span>`
        : r.level === "warning"
          ? `<span class="import-status-icon warning">⚠</span>`
          : `<span class="import-status-icon valid">✓</span>`;
      const issues = [...r.errors, ...r.warnings]
        .map(s => `<span class="import-issue">${escapeHtml(s)}</span>`)
        .join("") || `<span class="import-issue" style="color:var(--success)">OK</span>`;
      return `
        <tr style="background:${isError ? "rgba(239,68,68,.04)" : r.level === "warning" ? "rgba(245,158,11,.04)" : ""}">
          <td style="padding:8px 10px">
            <input type="checkbox" data-idx="${r.idx}"
              ${isError ? "disabled" : "checked"}
              ${isError ? 'style="opacity:.35;cursor:not-allowed"' : ""}>
          </td>
          <td style="padding:8px 6px">${statusIcon}</td>
          <td style="padding:8px 10px;font-weight:600">${escapeHtml(r.item?.ticketNumber || "—")}</td>
          <td style="padding:8px 10px;color:var(--text-secondary)">${escapeHtml(r.item?.agentName || "—")}</td>
          <td style="padding:8px 10px;color:var(--text-secondary)">${escapeHtml(r.item?.evaluationDate || "—")}</td>
          <td style="padding:8px 10px">${r.item?.slaBreach === "Yes"
            ? `<span class="badge badge-danger">Yes</span>`
            : r.item?.slaBreach === "No"
              ? `<span class="badge badge-success">No</span>`
              : `<span style="color:var(--muted)">—</span>`}</td>
          <td style="padding:8px 10px">${issues}</td>
        </tr>`;
    }).join("");

    selectAll.checked = true;
    updateConfirmLabel();
    modal.hidden = false;
    document.body.style.overflow = "hidden";
  }
}

// ── Audit log viewer ──────────────────────────────────────────────────────────

function bindAuditModal() {
  const modal      = document.getElementById("auditLogModal");
  const openBtn    = document.getElementById("auditLogBtn");
  const closeBtn   = document.getElementById("auditLogClose");
  const closeBtnF  = document.getElementById("auditLogCloseBtn");
  const exportBtn  = document.getElementById("auditExportCsvBtn");
  const dateFrom   = document.getElementById("auditDateFrom");
  const dateTo     = document.getElementById("auditDateTo");
  const actionSel  = document.getElementById("auditActionFilter");
  const searchIn   = document.getElementById("auditSearch");
  const listEl     = document.getElementById("auditEntriesList");

  function closeModal() {
    modal.hidden = true;
    document.body.style.overflow = "";
  }

  closeBtn.addEventListener("click",  closeModal);
  closeBtnF.addEventListener("click", closeModal);
  modal.addEventListener("click", e => { if (e.target === modal) closeModal(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !modal.hidden) closeModal(); });

  openBtn.addEventListener("click", async () => {
    modal.hidden = false;
    document.body.style.overflow = "hidden";
    listEl.innerHTML = `<div class="empty-state" style="padding:32px">
      <div class="spinner" style="border-top-color:var(--primary)"></div>
    </div>`;
    _auditAllEntries = await getAuditLog(300);
    renderAuditEntries();
  });

  [dateFrom, dateTo, actionSel, searchIn].forEach(el => {
    el.addEventListener("input",  renderAuditEntries);
    el.addEventListener("change", renderAuditEntries);
  });

  exportBtn.addEventListener("click", () => {
    const filtered = getFilteredAudit();
    if (!filtered.length) { toast("No entries to export.", "warning"); return; }
    const header = "Timestamp,Action,Ticket,Agent,Date,PerformedBy";
    const rows   = filtered.map(e => {
      const esc = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
      return [
        esc(fmtTimestamp(e.timestamp)),
        esc(e.action),
        esc(e.ticketNumber),
        esc(e.agentName),
        esc(e.evaluationDate),
        esc(e.performedBy),
      ].join(",");
    });
    const blob = new Blob([[header, ...rows].join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const a    = Object.assign(document.createElement("a"), {
      href:     URL.createObjectURL(blob),
      download: `audit-log-${today()}.csv`,
    });
    a.click();
    toast("Audit log exported.", "success");
  });

  function getFilteredAudit() {
    const from   = dateFrom.value;
    const to     = dateTo.value;
    const action = actionSel.value;
    const q      = searchIn.value.trim().toLowerCase();
    return _auditAllEntries.filter(e => {
      const d = fmtDate(e.timestamp);
      if (from && d < from) return false;
      if (to   && d > to)   return false;
      if (action && e.action !== action) return false;
      if (q && !`${e.ticketNumber} ${e.agentName}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }

  function renderAuditEntries() {
    const filtered = getFilteredAudit();
    if (!filtered.length) {
      listEl.innerHTML = `<div class="empty-state" style="padding:32px">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:28px;height:28px">
          <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/>
        </svg>
        <p>No audit entries found</p>
      </div>`;
      return;
    }

    // Group by calendar day
    const groups = {};
    filtered.forEach(e => {
      const day = fmtDate(e.timestamp) || "Unknown date";
      (groups[day] ??= []).push(e);
    });

    listEl.innerHTML = Object.entries(groups).map(([day, entries]) => `
      <div class="audit-day-header">${day}</div>
      ${entries.map(e => `
        <div class="audit-entry" data-id="${escapeHtml(e.id)}">
          <div class="audit-time">${fmtTime(e.timestamp)}</div>
          <div><span class="audit-action-badge ${escapeHtml(e.action)}">${escapeHtml(e.action)}</span></div>
          <div class="audit-meta">
            ${e.action === "import"
              ? `<strong>Bulk import</strong> — ${e.importCount || "?"} records`
              : `<strong>${escapeHtml(e.ticketNumber || "—")}</strong>${e.agentName ? ` · ${escapeHtml(e.agentName)}` : ""}`}
            <div class="audit-by">by ${escapeHtml(e.performedBy || "unknown")}</div>
            ${buildDiffHtml(e)}
          </div>
          <svg class="audit-expand-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
               style="width:14px;height:14px;flex-shrink:0;margin-top:3px;${!hasDiff(e) ? "visibility:hidden" : ""}">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </div>`
      ).join("")}
    `).join("");

    listEl.querySelectorAll(".audit-entry").forEach(row => {
      if (!row.querySelector(".audit-diff")) return;
      row.addEventListener("click", () => row.classList.toggle("expanded"));
    });
  }

  function hasDiff(e) {
    if (e.action === "update" && e.changes && Object.keys(e.changes).length) return true;
    if (e.action === "import" && e.tickets?.length) return true;
    if (e.action === "create" || e.action === "delete") return !!e.snapshot;
    return false;
  }

  function buildDiffHtml(e) {
    if (!hasDiff(e)) return "";
    let inner = "";
    if (e.action === "update" && e.changes) {
      inner = Object.entries(e.changes).map(([field, { before, after }]) => `
        <div class="audit-diff-row">
          <span class="audit-diff-field">${escapeHtml(field)}</span>
          <span class="audit-diff-before">${escapeHtml(String(before ?? ""))}</span>
          <span style="color:var(--muted)">→</span>
          <span class="audit-diff-after">${escapeHtml(String(after ?? ""))}</span>
        </div>`).join("");
    } else if (e.action === "import" && e.tickets?.length) {
      inner = `<div style="color:var(--muted);font-size:11px">${e.tickets.map(t => escapeHtml(t)).join(", ")}</div>`;
    } else if ((e.action === "create" || e.action === "delete") && e.snapshot) {
      const snap = e.snapshot;
      inner = [
        snap.agentName      && `<div class="audit-diff-row"><span class="audit-diff-field">agentName</span><span>${escapeHtml(snap.agentName)}</span></div>`,
        snap.evaluationDate && `<div class="audit-diff-row"><span class="audit-diff-field">date</span><span>${escapeHtml(snap.evaluationDate)}</span></div>`,
        snap.slaBreach      && `<div class="audit-diff-row"><span class="audit-diff-field">slaBreach</span><span>${escapeHtml(snap.slaBreach)}</span></div>`,
      ].filter(Boolean).join("");
    }
    if (!inner) return "";
    return `<div class="audit-diff">${inner}</div>`;
  }
}

// ── Timestamp helpers ─────────────────────────────────────────────────────────
function fmtDate(ts) {
  if (!ts) return "";
  try { return ts.toDate().toISOString().slice(0, 10); } catch { return ""; }
}
function fmtTime(ts) {
  if (!ts) return "";
  try {
    const d = ts.toDate();
    return d.toTimeString().slice(0, 5);
  } catch { return ""; }
}
function fmtTimestamp(ts) {
  if (!ts) return "";
  try { return ts.toDate().toISOString().replace("T", " ").slice(0, 19); } catch { return ""; }
}
