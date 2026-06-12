let allData = [];
let _importParsed   = [];  // rows from last parsed import file
let _auditAllEntries = []; // full audit log loaded into viewer

document.addEventListener("appReady", async () => {
  if (getSettings().compactTable) document.querySelector(".table-wrap table")?.setAttribute("data-compact", "");

  // Show cached data instantly, then refresh from Firestore in background
  const cached = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  if (cached.length) {
    allData = cached;
    renderTable(allData);
  } else {
    setTableLoading(true);
  }

  bindEvents();
  bindImportPreview();
  bindAuditModal();

  // Background refresh
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
});

function setTableLoading(on) {
  if (on) {
    document.getElementById("databaseBody").innerHTML =
      `<tr><td colspan="9"><div class="empty-state"><div class="spinner" style="border-top-color:var(--primary)"></div></div></td></tr>`;
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

function renderTable(data) {
  const body = document.getElementById("databaseBody");
  if (!data.length) {
    body.innerHTML = `
      <tr><td colspan="9">
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>
          </svg>
          <p>No evaluations found</p>
        </div>
      </td></tr>`;
    return;
  }
  body.innerHTML = data.map(item => {
    const avg    = calculateAverage(item);
    const ticket = escapeHtml(item.ticketNumber);
    return `
      <tr>
        <td><strong>${ticket}</strong></td>
        <td>${escapeHtml(item.agentName)}</td>
        <td>${escapeHtml(formatDisplayDate(item.evaluationDate))}</td>
        <td>${slaBadge(item.slaBreach)}</td>
        <td>${escapeHtml(item.lsa || "—")}</td>
        <td>${escapeHtml(item.assignedTo || "—")}</td>
        <td>${scoreBadge(avg)}</td>
        <td>${escapeHtml(item.evaluatedBy || "—")}</td>
        <td>
          <div class="td-actions">
            <a class="btn btn-secondary btn-sm"
               href="form.html?edit=${encodeURIComponent(item.ticketNumber)}">${t("db.edit")}</a>
            <button class="btn btn-ghost btn-sm" data-action="open" data-ticket="${ticket}">${t("db.open")}</button>
            <button class="btn btn-danger btn-sm" data-action="delete" data-ticket="${ticket}">${t("db.delete")}</button>
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
  const scoreKeys = Object.keys(scoreLabels);
  const headers = [
    "Ticket Number", "Agent Name", "Evaluation Date", "SLA Breach",
    "LSA", "Assigned To", "Evaluated By",
    ...scoreKeys.map(k => scoreLabels[k]),
    "Average Score", "Comments", "Created At",
  ];
  const rows = data.map(item => {
    const avg = calculateAverage(item);
    const esc = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
    return [
      esc(item.ticketNumber), esc(item.agentName), esc(item.evaluationDate),
      esc(item.slaBreach), esc(item.lsa), esc(item.assignedTo), esc(item.evaluatedBy),
      ...scoreKeys.map(k => esc(item[k] ?? "")),
      esc(avg), esc(item.comments), esc(item.createdAt),
    ].join(",");
  });
  return [headers.join(","), ...rows].join("\r\n");
}

function bindEvents() {
  let debounce;
  document.getElementById("searchInput").addEventListener("input", e => {
    clearTimeout(debounce);
    debounce = setTimeout(() => renderTable(filterData(e.target.value)), 200);
  });

  document.getElementById("databaseBody").addEventListener("click", e => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const ticket = btn.dataset.ticket;
    if (btn.dataset.action === "open")   openServiceNow(ticket);
    if (btn.dataset.action === "delete") confirmDelete(ticket);
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

  document.getElementById("deleteAllBtn").addEventListener("click", async () => {
    if (!confirm(`Delete ALL ${allData.length} evaluations? This cannot be undone.`)) return;
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

    confirmBtn.disabled = true;
    confirmBtn.querySelector("span").textContent = "Importing…";
    try {
      const batch = window.db.batch();
      toImport.forEach(item => {
        const ref = window.db.collection(COLLECTION).doc(item.ticketNumber.trim());
        batch.set(ref, { ...item, updatedAt: firebase.firestore.FieldValue.serverTimestamp(), createdAt: item.createdAt || firebase.firestore.FieldValue.serverTimestamp() });
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

      allData = await getData();
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
