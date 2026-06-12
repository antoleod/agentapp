let _reportData = [];

document.addEventListener("appReady", async () => {
  // Show cached data instantly, then refresh from Firestore in background
  const cached = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  if (cached.length) {
    _reportData = cached;
    renderReports(cached);
  }

  try {
    const data = await getData();
    if (JSON.stringify(data) !== JSON.stringify(_reportData)) {
      _reportData = data;
      renderReports(data);
    }
  } catch (err) {
    if (!cached.length) toast("Failed to load reports: " + err.message, "error");
  }

  document.getElementById("refreshBtn").addEventListener("click", async () => {
    const btn     = document.getElementById("refreshBtn");
    const labelEl = btn.querySelector(".refresh-label");
    if (btn.disabled) return;
    btn.disabled = true;
    if (labelEl) labelEl.textContent = "Refreshing…";
    try {
      const data = await getData();
      _reportData = data;
      renderReports(data);
      toast("Reports updated.", "info");
    } finally {
      btn.disabled = false;
      if (labelEl) labelEl.textContent = t("rep.refresh");
    }
  });

  bindExportModal();
});

function renderReports(data) {
  const total   = data.length;
  const breaches = data.filter(x => x.slaBreach === "Yes").length;
  const avgScore = total
    ? (data.reduce((s, i) => s + calculateAverage(i), 0) / total).toFixed(2)
    : "—";

  document.getElementById("statTotal").textContent   = total;
  document.getElementById("statBreaches").textContent = breaches;
  document.getElementById("statAvg").textContent      = avgScore;
  document.getElementById("statBreachPct").textContent  = total
    ? `${((breaches / total) * 100).toFixed(0)}% breach rate`
    : "No data";

  renderAgentChart(data);
}

function bindExportModal() {
  const modal        = document.getElementById("exportModal");
  const openBtn      = document.getElementById("exportReportBtn");
  const closeBtn     = document.getElementById("exportModalClose");
  const cancelBtn    = document.getElementById("exportCancel");
  const downloadBtn  = document.getElementById("exportDownloadBtn");
  const expRecords   = document.getElementById("expRecords");
  const colPicker    = document.getElementById("columnPicker");
  const colList      = document.getElementById("columnList");
  const matchBadge   = document.getElementById("matchBadge");
  const fmtBtns      = document.querySelectorAll("#exportFormat .toggle-btn");
  const filterDateFrom  = document.getElementById("filterDateFrom");
  const filterDateTo    = document.getElementById("filterDateTo");
  const filterSLA       = document.getElementById("filterSLA");
  const filterAgent     = document.getElementById("filterAgent");
  const filterCritField = document.getElementById("filterCritField");
  const filterCritOp    = document.getElementById("filterCritOp");
  const filterCritValue = document.getElementById("filterCritValue");

  fmtBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      fmtBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
    });
  });

  expRecords.addEventListener("change", () => {
    colPicker.style.display = expRecords.checked ? "" : "none";
  });

  // Populate criterion score filter dropdown
  function populateCritFilter() {
    const noneOpt = filterCritField.options[0];
    filterCritField.innerHTML = "";
    filterCritField.appendChild(noneOpt);
    getActiveCriteria().forEach(c => {
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = c.builtin ? t(c.labelKey) : c.label;
      filterCritField.appendChild(opt);
    });
  }

  // Build current filter object from UI
  function getFilters() {
    const critVal = parseFloat(filterCritValue.value);
    return {
      dateFrom:   filterDateFrom.value  || null,
      dateTo:     filterDateTo.value    || null,
      sla:        filterSLA.value       || null,
      agent:      filterAgent.value.trim().toLowerCase() || null,
      critField:  filterCritField.value || null,
      critOp:     filterCritOp.value,
      critValue:  isNaN(critVal) ? null : critVal,
    };
  }

  // Live match badge
  function updateMatchBadge() {
    const filtered = applyFilters(_reportData, getFilters());
    if (filtered.length < _reportData.length) {
      matchBadge.textContent = filtered.length + " / " + _reportData.length + " records";
      matchBadge.style.display = "";
    } else {
      matchBadge.style.display = "none";
    }
  }

  [filterDateFrom, filterDateTo, filterSLA, filterAgent, filterCritField, filterCritOp, filterCritValue]
    .forEach(el => el.addEventListener("input", updateMatchBadge));
  [filterSLA, filterCritField, filterCritOp]
    .forEach(el => el.addEventListener("change", updateMatchBadge));

  function renderColumns() {
    const basecols = [
      { id: "ticketNumber",   label: "Ticket" },
      { id: "agentName",      label: "Agent" },
      { id: "evaluationDate", label: "Date" },
      { id: "slaBreach",      label: "SLA Breach" },
      { id: "lsa",            label: "LSA" },
      { id: "evaluatedBy",    label: "Evaluated By" },
      { id: "averageScore",   label: "Avg Score" },
      { id: "comments",       label: "Comments" },
      { id: "createdAt",      label: "Created At" },
      ...getActiveCriteria().map(c => ({
        id:    c.id,
        label: c.builtin ? t(c.labelKey) : c.label,
      })),
    ];
    colList.innerHTML = basecols.map(col => `
      <label class="check-tag">
        <input type="checkbox" value="${escapeHtml(col.id)}" checked>
        ${escapeHtml(col.label)}
      </label>
    `).join("");
  }

  function openModal() {
    renderColumns();
    populateCritFilter();
    // Reset filters
    filterDateFrom.value  = "";
    filterDateTo.value    = "";
    filterSLA.value       = "";
    filterAgent.value     = "";
    filterCritField.value = "";
    filterCritValue.value = "";
    matchBadge.style.display = "none";
    modal.hidden = false;
    document.body.style.overflow = "hidden";
  }

  function closeModal() {
    modal.hidden = true;
    document.body.style.overflow = "";
  }

  openBtn.addEventListener("click", openModal);
  closeBtn.addEventListener("click", closeModal);
  cancelBtn.addEventListener("click", closeModal);
  modal.addEventListener("click", e => { if (e.target === modal) closeModal(); });
  document.addEventListener("keydown", e => { if (!modal.hidden && e.key === "Escape") closeModal(); });

  downloadBtn.addEventListener("click", () => {
    const format = document.querySelector("#exportFormat .toggle-btn.active")?.dataset.fmt || "csv";
    const sections = {
      summary: document.getElementById("expSummary").checked,
      agents:  document.getElementById("expAgents").checked,
      records: expRecords.checked,
    };
    const columns = sections.records
      ? [...colList.querySelectorAll("input:checked")].map(cb => cb.value)
      : [];

    const content = exportReportData(format, sections, columns, getFilters());
    const ext  = format === "json" ? "json" : "csv";
    const mime = format === "json" ? "application/json" : "text/csv;charset=utf-8;";
    const blob = new Blob([content], { type: mime });
    const a    = Object.assign(document.createElement("a"), {
      href:     URL.createObjectURL(blob),
      download: `report-${new Date().toISOString().slice(0,10)}.${ext}`,
    });
    a.click();
    URL.revokeObjectURL(a.href);
    closeModal();
    toast(`Report exported as ${ext.toUpperCase()}.`, "success");
  });
}

function applyFilters(data, f) {
  return data.filter(item => {
    if (f.dateFrom) {
      const d = (item.evaluationDate || "").slice(0, 10);
      if (d && d < f.dateFrom) return false;
    }
    if (f.dateTo) {
      const d = (item.evaluationDate || "").slice(0, 10);
      if (d && d > f.dateTo) return false;
    }
    if (f.sla && item.slaBreach !== f.sla) return false;
    if (f.agent) {
      const name = (item.agentName || "").toLowerCase();
      if (!name.includes(f.agent)) return false;
    }
    if (f.critField && f.critValue !== null) {
      const score = Number(item[f.critField]);
      if (isNaN(score)) return false;
      if (f.critOp === "lte" && score > f.critValue) return false;
      if (f.critOp === "gte" && score < f.critValue) return false;
      if (f.critOp === "eq"  && score !== f.critValue) return false;
    }
    return true;
  });
}

function exportReportData(format, sections, columns, filters = {}) {
  const rows     = applyFilters(_reportData, filters);
  const total    = rows.length;
  const breaches = rows.filter(x => x.slaBreach === "Yes").length;
  const avgScore = total
    ? (rows.reduce((s, i) => s + calculateAverage(i), 0) / total).toFixed(2)
    : "0";

  const critLabels = Object.fromEntries(
    getActiveCriteria().map(c => [c.id, c.builtin ? t(c.labelKey) : c.label])
  );

  if (format === "json") {
    const out = {};
    if (sections.summary) {
      out.summary = {
        total,
        breaches,
        breachRate:   total ? ((breaches / total) * 100).toFixed(1) + "%" : "0%",
        averageScore: avgScore,
      };
    }
    if (sections.agents) {
      const byAgent = {};
      rows.forEach(item => { (byAgent[item.agentName] ??= []).push(calculateAverage(item)); });
      out.agents = Object.entries(byAgent)
        .map(([agent, vals]) => ({
          agent,
          evaluations: vals.length,
          average:     (vals.reduce((s, v) => s + v, 0) / vals.length).toFixed(2),
        }))
        .sort((a, b) => b.average - a.average);
    }
    if (sections.records && columns.length) {
      out.records = rows.map(item => {
        const rec = {};
        columns.forEach(col => {
          rec[col] = col === "averageScore" ? calculateAverage(item) : (item[col] ?? "");
        });
        return rec;
      });
    }
    return JSON.stringify(out, null, 2);
  }

  // CSV
  const esc = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [];

  if (sections.summary) {
    lines.push("Metric,Value");
    lines.push(`Total Evaluations,${total}`);
    lines.push(`SLA Breaches,${breaches}`);
    lines.push(`Breach Rate,${total ? ((breaches / total) * 100).toFixed(1) + "%" : "0%"}`);
    lines.push(`Average Score,${avgScore}`);
    lines.push("");
  }

  if (sections.agents) {
    const byAgent = {};
    rows.forEach(item => { (byAgent[item.agentName] ??= []).push(calculateAverage(item)); });
    const agentRows = Object.entries(byAgent)
      .map(([agent, vals]) => ({
        agent,
        count: vals.length,
        avg:   (vals.reduce((s, v) => s + v, 0) / vals.length).toFixed(2),
      }))
      .sort((a, b) => b.avg - a.avg);
    lines.push("Agent,Evaluations,Average Score");
    agentRows.forEach(r => lines.push([esc(r.agent), r.count, r.avg].join(",")));
    lines.push("");
  }

  if (sections.records && columns.length) {
    const colHeaderMap = {
      ticketNumber:   "Ticket",
      agentName:      "Agent",
      evaluationDate: "Date",
      slaBreach:      "SLA Breach",
      lsa:            "LSA",
      evaluatedBy:    "Evaluated By",
      averageScore:   "Average Score",
      comments:       "Comments",
      createdAt:      "Created At",
      ...critLabels,
    };
    lines.push(columns.map(c => esc(colHeaderMap[c] || c)).join(","));
    rows.forEach(item => {
      lines.push(columns.map(c =>
        esc(c === "averageScore" ? calculateAverage(item) : (item[c] ?? ""))
      ).join(","));
    });
  }

  return lines.join("\r\n");
}

function renderAgentChart(data) {
  const byAgent = {};
  data.forEach(item => {
    (byAgent[item.agentName] ??= []).push(calculateAverage(item));
  });

  const container = document.getElementById("agentReport");

  if (!Object.keys(byAgent).length) {
    container.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M18 20V10M12 20V4M6 20v-6"/>
        </svg>
        <p>No evaluation data yet</p>
      </div>`;
    return;
  }

  const rows = Object.entries(byAgent)
    .map(([agent, vals]) => ({
      agent,
      avg:   vals.reduce((s, v) => s + v, 0) / vals.length,
      count: vals.length,
    }))
    .sort((a, b) => b.avg - a.avg);

  container.innerHTML = `<div class="agent-list">${rows.map(({ agent, avg, count }) => {
    const pct    = Math.min(100, (avg / 5) * 100);
    const cls    = avg >= 4 ? "high" : avg >= 3 ? "mid" : "low";
    const color  = avg >= 4 ? "var(--success)" : avg >= 3 ? "var(--warning)" : "var(--danger)";
    return `
      <div class="agent-row">
        <div>
          <div class="agent-name">${escapeHtml(agent)}</div>
          <div style="font-size:11px;color:var(--muted)">${count} ${count !== 1 ? t("common.eval_label") : t("common.eval_label1")}</div>
        </div>
        <div class="bar-track">
          <div class="bar-fill ${cls}" style="width:${pct}%"></div>
        </div>
        <div class="agent-score" style="color:${color}">${avg.toFixed(2)}</div>
      </div>`;
  }).join("")}</div>`;
}
