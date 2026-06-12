let _editCreatedAt = null;
let _editPrevData  = null;

document.addEventListener("appReady", async () => {
  renderAllCriteria();
  initSlaToggle();
  initProgress();
  clearForm();
  populateAgentRoster();
  bindEvents();

  // Edit mode: form.html?edit=INC001
  const ticket = new URLSearchParams(location.search).get("edit");
  if (ticket) {
    const cached = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    const item   = cached.find(x => x.ticketNumber === ticket);
    if (item) {
      _editCreatedAt = item.createdAt || null;
      _editPrevData  = { ...item };
      loadIntoForm(item);
      updateProgress();
      updateAvgBadge();
    } else {
      // Firestore fallback on cache miss
      try {
        const doc = await window.db.collection(COLLECTION).doc(ticket).get();
        if (doc.exists) {
          const data = doc.data();
          _editCreatedAt = data.createdAt || null;
          _editPrevData  = { ...data };
          loadIntoForm(data);
          updateProgress();
          updateAvgBadge();
          toast("Evaluation loaded from database.", "info");
        } else {
          toast(`No saved evaluation found for "${ticket}".`, "warning");
        }
      } catch (err) {
        toast("Failed to load evaluation: " + err.message, "error");
      }
    }
  }

  // Auto-focus
  document.getElementById("ticketNumber").focus();
});

// ── Score pickers ─────────────────────────────────────────────────────────────
function initScorePickers() {
  // No-op: all criteria rendered dynamically by renderAllCriteria()
}

function selectScore(picker, value) {
  picker.dataset.value = value;
  const field = document.getElementById(picker.dataset.field);
  if (field) field.value = value;

  picker.querySelectorAll(".sp-btn").forEach(btn => {
    btn.classList.toggle("sp-active", btn.dataset.v === value);
  });

  updateAvgBadge();
  updateProgress();
}

function setPickerValue(fieldId, value) {
  const picker = document.querySelector(`.score-picker[data-field="${fieldId}"]`);
  if (!picker) return;
  selectScore(picker, String(value));
}

// ── SLA toggle ────────────────────────────────────────────────────────────────
function initSlaToggle() {
  document.querySelectorAll("#slaToggle .toggle-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#slaToggle .toggle-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById("slaBreach").value = btn.dataset.value;
    });
  });
}

function setSlaValue(value) {
  document.querySelectorAll("#slaToggle .toggle-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.value === value);
  });
  document.getElementById("slaBreach").value = value;
}

// ── Progress bar ──────────────────────────────────────────────────────────────
// Key fields the user must fill (scores always have a value so not tracked here)
const REQUIRED_FIELDS = ["ticketNumber", "agentName", "evaluationDate"];
const OPTIONAL_FIELDS = ["lsa", "comments"];

function initProgress() {
  [...REQUIRED_FIELDS, ...OPTIONAL_FIELDS].forEach(id => {
    document.getElementById(id)?.addEventListener("input", updateProgress);
  });
}

function updateProgress() {
  const reqFilled  = REQUIRED_FIELDS.filter(id => document.getElementById(id)?.value.trim()).length;
  const optFilled  = OPTIONAL_FIELDS.filter(id => document.getElementById(id)?.value.trim()).length;
  const total      = REQUIRED_FIELDS.length + OPTIONAL_FIELDS.length;
  const filled     = reqFilled + optFilled;
  const pct        = Math.round((filled / total) * 100);

  const bar   = document.getElementById("progressBar");
  const label = document.getElementById("progressLabel");
  const pctEl = document.getElementById("progressPercent");

  bar.style.width   = pct + "%";
  pctEl.textContent = pct + "%";

  if (reqFilled < REQUIRED_FIELDS.length) {
    const missing = REQUIRED_FIELDS.length - reqFilled;
    const word = missing > 1 ? t("form.req_missing_pl") : t("form.req_missing");
    label.textContent = `${missing} ${word}`;
    bar.classList.remove("done");
  } else if (pct === 100) {
    label.textContent = t("form.all_complete");
    bar.classList.add("done");
  } else {
    label.textContent = `${filled} ${t("form.of_fields")} ${total} ${t("form.fields_filled")}`;
    bar.classList.remove("done");
  }
}

// ── Average badge ─────────────────────────────────────────────────────────────
function updateAvgBadge() {
  const allFields = getAllScoreFields();
  const values    = allFields.map(id => Number(document.getElementById(id)?.value || 0));
  const avg       = values.reduce((s, v) => s + v, 0) / (values.length || 1);
  const badge     = document.getElementById("avgBadge");

  badge.textContent = `Avg ${avg.toFixed(2)}`;
  badge.className   = "avg-badge " + (avg >= 4 ? "avg-high" : avg >= 3 ? "avg-mid" : "avg-low");
}

// ── Criteria rendering (built-ins + custom, all dynamic) ─────────────────────
function buildCriterionHtml(id, label, hint) {
  return `
    <div class="criterion" id="criterion-${id}">
      <div class="criterion-label">
        <span>${escapeHtml(label)}</span>
        <span class="criterion-hint" style="${getSettings().formShowScoreHints === false ? 'display:none' : ''}">${escapeHtml(hint)}</span>
      </div>
      <div class="score-picker" data-field="${id}" data-value="3">
        <button type="button" class="sp-btn" data-v="1">1</button>
        <button type="button" class="sp-btn" data-v="2">2</button>
        <button type="button" class="sp-btn sp-active" data-v="3">3</button>
        <button type="button" class="sp-btn" data-v="4">4</button>
        <button type="button" class="sp-btn" data-v="5">5</button>
      </div>
      <input type="hidden" id="${id}" value="3" />
    </div>`;
}

function renderAllCriteria() {
  const container = document.getElementById("scoreCriteria");
  if (!container) return;
  container.innerHTML = "";

  getActiveCriteria().forEach(c => {
    const label = c.builtin ? t(c.labelKey) : c.label;
    const hint  = c.builtin ? t(c.hintKey)  : (c.hint || t("crit.custom_hint"));
    container.insertAdjacentHTML("beforeend", buildCriterionHtml(c.id, label, hint));
  });

  container.querySelectorAll(".score-picker").forEach(picker => {
    picker.querySelectorAll(".sp-btn").forEach(btn => {
      btn.addEventListener("click", () => selectScore(picker, btn.dataset.v));
    });
  });
}

// ── Ticket type badge ─────────────────────────────────────────────────────────
function updateTicketBadge(value) {
  const badge  = document.getElementById("ticketBadge");
  const types  = { INC: "Incident", RITM: "Request Item", REQ: "Request", SCTASK: "Task" };
  const match  = Object.entries(types).find(([k]) => value.startsWith(k));
  if (match) {
    badge.textContent = match[1];
    badge.hidden      = false;
  } else {
    badge.hidden = true;
  }
}

// ── Form read / load ──────────────────────────────────────────────────────────
function readForm() {
  const v = id => document.getElementById(id)?.value ?? "";
  return {
    ticketNumber:       v("ticketNumber").trim().toUpperCase(),
    agentName:          v("agentName").trim(),
    evaluationDate:     v("evaluationDate"),
    slaBreach:          v("slaBreach"),
    lsa:                v("lsa").trim(),
    ...Object.fromEntries(getActiveCriteria().map(c => [c.id, v(c.id)])),
    comments:           v("comments").trim(),
    evaluatedBy:        v("evaluatedBy").trim(),
    createdAt:          _editCreatedAt || new Date().toISOString(),
    createdBy:          window.currentUser?.email || "guest",
  };
}

function loadIntoForm(item) {
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ""; };
  set("ticketNumber",   item.ticketNumber);
  set("agentName",      item.agentName);
  set("evaluationDate", item.evaluationDate);
  set("lsa",            item.lsa);
  set("comments",       item.comments);
  // Keep original evaluator when loading; current user shown as read-only hint
  set("evaluatedBy", item.evaluatedBy || resolveEvaluatorName());

  setSlaValue(item.slaBreach || "No");
  getActiveCriteria().forEach(({ id }) => setPickerValue(id, item[id] || "3"));

  updateTicketBadge(item.ticketNumber || "");
}

function resolveEvaluatorName() {
  const user = window.currentUser;
  if (!user || user.isAnonymous) return getSettings().defaultEvaluator || "Guest";
  return user.displayName || user.email?.split("@")[0] || getSettings().defaultEvaluator || "";
}

function populateAgentRoster() {
  const list   = document.getElementById("agentRosterList");
  if (!list) return;
  const roster = getSettings().agentRoster || [];
  list.innerHTML = roster.map(n => `<option value="${escapeHtml(n)}">`).join("");
}

function clearForm() {
  document.getElementById("evaluationForm").reset();
  document.getElementById("evaluationDate").value = today();
  document.getElementById("evaluatedBy").value    = resolveEvaluatorName();
  document.getElementById("ticketBadge").hidden   = true;

  const s = getSettings();
  setSlaValue(s.defaultSla || "No");
  const defScore = s.defaultScore !== undefined ? s.defaultScore : "3";
  getActiveCriteria().forEach(({ id }) => setPickerValue(id, defScore));

  updateAvgBadge();
  updateProgress();
}

// ── ServiceNow paste ──────────────────────────────────────────────────────────
async function pasteServiceNowInfo() {
  let text = "";
  try {
    if (navigator.clipboard?.readText) text = await navigator.clipboard.readText();
  } catch { /* ignored */ }
  if (!text) text = prompt("Paste the ServiceNow JSON here:");
  if (!text) return;

  let data;
  try { data = JSON.parse(text); } catch {
    toast("Invalid ServiceNow JSON.", "error");
    return;
  }

  const filled   = [];
  const skipped  = [];

  function setField(id, value, label) {
    const el = document.getElementById(id);
    if (!el || !value) { skipped.push(label); return; }
    el.value = value;
    filled.push(label);
  }

  const ticket = data.number || data.ticketNumber || "";
  setField("ticketNumber", ticket,                           "Ticket Number");
  setField("lsa",          data.assignmentGroup || data.lsa, "LSA");

  const agentEl = document.getElementById("agentName");
  if (agentEl?.value.trim()) {
    skipped.push("Agent Name (kept existing)");
  }

  // SLA Breach — auto-set from bookmarklet data
  if (data.slaBreach) {
    setSlaValue(data.slaBreach);
    const pctLabel = data.slaPercentage !== null ? ` (${data.slaPercentage}%)` : "";
    filled.push(`SLA Breach${pctLabel} → ${data.slaBreach === "Yes" ? "⚠ Breached" : "✓ OK"}`);
  } else {
    skipped.push("SLA Breach (set manually)");
  }

  // Build comments from shortDescription + state
  const commentParts = [
    data.shortDescription || data.comments,
    data.state ? `State: ${data.state}` : "",
    data.slaName ? `SLA: ${data.slaName}` : "",
  ].filter(Boolean);
  if (commentParts.length) {
    document.getElementById("comments").value = commentParts.join("\n\n");
    filled.push("Comments");
  }

  updateTicketBadge(ticket);
  updateProgress();
  showAuditPanel(data, filled);

  // Focus first field that still needs input
  const firstEmpty = ["agentName", "evaluationDate"]
    .find(id => !document.getElementById(id)?.value.trim());
  if (firstEmpty) document.getElementById(firstEmpty).focus();
}

function showAuditPanel(data, filled) {
  // Remove existing panel
  document.getElementById("auditPanel")?.remove();

  const remaining = [];
  if (!document.getElementById("agentName").value.trim()) remaining.push("Agent Name");
  if (!document.getElementById("evaluationDate").value)   remaining.push("Evaluation Date");
  if (!data.slaBreach)                                    remaining.push("SLA Breach");
  const allScoresDefault = getAllScoreFields().every(id => {
    const v = document.getElementById(id)?.value;
    return !v || v === "3";
  });
  if (allScoresDefault) remaining.push("Scores (6 criteria) — all at default 3");

  const panel = document.createElement("div");
  panel.id = "auditPanel";
  panel.className = "audit-panel";
  const slaPct     = data.slaPercentage !== null ? data.slaPercentage : null;
  const slaColor   = slaPct === null ? "" : slaPct > 100 ? "color:var(--danger);font-weight:700" : "color:var(--success);font-weight:700";
  const slaPctSafe = slaPct !== null ? escapeHtml(String(slaPct)) : "";
  const slaDisplay = slaPct !== null
    ? `<span style="${slaColor}">${slaPctSafe}% ${slaPct > 100 ? "⚠ Breached" : "✓ OK"}</span>`
    : "";

  panel.innerHTML = `
    <div class="audit-header">
      <span class="audit-icon">📋</span>
      <strong>ServiceNow Import</strong>
      <span class="audit-ticket">${escapeHtml(data.number || "")}</span>
      ${slaDisplay ? `<span class="audit-sla">${slaDisplay}</span>` : ""}
      <button type="button" class="audit-close" onclick="document.getElementById('auditPanel').remove()">×</button>
    </div>
    <div class="audit-body">
      <div class="audit-col">
        <div class="audit-col-title audit-done">✓ Auto-filled</div>
        ${filled.map(f => `<div class="audit-item audit-item-done">${f}</div>`).join("")}
      </div>
      <div class="audit-col">
        <div class="audit-col-title audit-todo">→ Still needed</div>
        ${remaining.map(f => `<div class="audit-item audit-item-todo">${f}</div>`).join("")}
      </div>
    </div>
  `;

  // Insert above the form card
  const form = document.getElementById("evaluationForm");
  form.parentNode.insertBefore(panel, form);
  panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// ── Save ──────────────────────────────────────────────────────────────────────
async function handleSave(e) {
  e.preventDefault();

  if (window.currentUser?.isAnonymous) {
    toast("Sign in to save evaluations. Guest access is read-only.", "warning");
    return;
  }

  const item = readForm();

  if (!item.ticketNumber || !item.agentName || !item.evaluationDate) {
    toast("Ticket Number, Agent Name and Date are required.", "warning");
    document.getElementById(
      !item.ticketNumber ? "ticketNumber" : !item.agentName ? "agentName" : "evaluationDate"
    ).focus();
    return;
  }

  if (getSettings().requireAllScores) {
    const missing = getActiveCriteria().filter(c => !item[c.id] && item[c.id] !== 0);
    if (missing.length) {
      const labels = missing.map(c => c.builtin ? t(c.labelKey) : c.label);
      toast(`Score required: ${labels.join(", ")}`, "warning");
      document.querySelector(`.score-picker[data-field="${missing[0].id}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      return;
    }
  }

  const btn = document.getElementById("saveBtn");
  btn.disabled     = true;
  btn.textContent  = "Saving…";

  try {
    const isEdit   = _editCreatedAt !== null;
    const auditCtx = { action: isEdit ? "update" : "create", prevData: isEdit ? _editPrevData : null };
    await saveEvaluation(item, auditCtx);
    toast("Evaluation saved successfully.", "success");
    _editCreatedAt = null;
    _editPrevData  = null;

    const fs = getSettings();
    if (fs.formClearAfterSave) {
      clearForm();
      document.getElementById("ticketNumber").focus();
    }
    if (fs.formAutoOpenSN && item.ticketNumber) {
      openServiceNow(item.ticketNumber);
    }
  } catch (err) {
    toast("Failed to save: " + err.message, "error");
  } finally {
    btn.disabled    = false;
    btn.innerHTML   = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:15px;height:15px"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Save Evaluation`;
  }
}

// ── Events ────────────────────────────────────────────────────────────────────
function bindEvents() {
  document.getElementById("evaluationForm").addEventListener("submit", handleSave);

  // Auto-uppercase ticket + badge
  document.getElementById("ticketNumber").addEventListener("input", e => {
    const pos = e.target.selectionStart;
    e.target.value = e.target.value.toUpperCase();
    e.target.setSelectionRange(pos, pos);
    updateTicketBadge(e.target.value);
    updateProgress();
  });

  // Enter on ticket → open ServiceNow (stop form submission and tab-advance)
  document.getElementById("ticketNumber").addEventListener("keydown", e => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const ticket = e.target.value.trim().toUpperCase();
    if (ticket) openServiceNow(ticket);
    else toast("Enter a ticket number first.", "warning");
  }, true); // capture phase — runs before form's submit listener

  document.getElementById("searchLocalBtn").addEventListener("click", async () => {
    const ticket = document.getElementById("ticketNumber").value.trim().toUpperCase();
    if (!ticket) { toast("Enter a ticket number first.", "warning"); return; }
    const cached = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    const item   = cached.find(x => x.ticketNumber === ticket);
    if (item) {
      _editCreatedAt = item.createdAt || null;
      _editPrevData  = { ...item };
      loadIntoForm(item);
      updateProgress();
      toast("Evaluation loaded.", "info");
      return;
    }
    // Firestore fallback
    try {
      const doc = await window.db.collection(COLLECTION).doc(ticket).get();
      if (doc.exists) {
        const data = doc.data();
        _editCreatedAt = data.createdAt || null;
        _editPrevData  = { ...data };
        loadIntoForm(data);
        updateProgress();
        toast("Evaluation loaded from database.", "info");
      } else {
        toast("No saved evaluation for this ticket.", "warning");
      }
    } catch (err) {
      toast("Failed to load: " + err.message, "error");
    }
  });

  document.getElementById("clearBtn").addEventListener("click", () => {
    if (!confirm("Clear the form? Unsaved changes will be lost.")) return;
    _editCreatedAt = null;
    clearForm();
    document.getElementById("ticketNumber").focus();
  });

  const openSnow = () => {
    const ticket = document.getElementById("ticketNumber").value.trim().toUpperCase();
    if (!ticket) { toast("Enter a ticket number first.", "warning"); return; }
    openServiceNow(ticket);
  };

  document.getElementById("openSnowBtn").addEventListener("click", openSnow);
  document.getElementById("searchSnowBtn").addEventListener("click", openSnow);

  document.getElementById("pasteSnowBtn").addEventListener("click", pasteServiceNowInfo);

  // Global Ctrl+V — auto-fill form if clipboard contains ServiceNow JSON
  document.addEventListener("paste", e => {
    const active = document.activeElement;
    const isTyping = active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.tagName === "SELECT");
    if (isTyping) return; // let normal paste work in fields

    const text = e.clipboardData?.getData("text") || "";
    if (!text.trim().startsWith("{")) return; // only handle JSON
    e.preventDefault();
    handleSnowPaste(text);
  });
}

function handleSnowPaste(text) {
  let data;
  try { data = JSON.parse(text); } catch {
    toast("Clipboard content is not valid ServiceNow JSON.", "warning");
    return;
  }
  if (!data.number && !data.ticketNumber) {
    toast("No ticket number found in pasted data.", "warning");
    return;
  }

  const filled  = [];
  const skipped = [];

  function setField(id, value, label) {
    const el = document.getElementById(id);
    if (!el || !value) { skipped.push(label); return; }
    el.value = value;
    filled.push(label);
  }

  const ticket = (data.number || data.ticketNumber || "").toUpperCase();
  setField("ticketNumber", ticket,                           "Ticket Number");
  setField("lsa",          data.assignmentGroup || data.lsa, "LSA");

  const agentEl = document.getElementById("agentName");
  if (agentEl?.value.trim()) skipped.push("Agent Name (kept existing)");

  if (data.slaBreach) {
    setSlaValue(data.slaBreach);
    const pctLabel = data.slaPercentage !== null ? ` (${data.slaPercentage}%)` : "";
    filled.push(`SLA Breach${pctLabel} → ${data.slaBreach === "Yes" ? "⚠ Breached" : "✓ OK"}`);
  }

  const commentParts = [
    data.shortDescription || data.comments,
    data.state ? `State: ${data.state}` : "",
    data.slaName ? `SLA: ${data.slaName}` : "",
  ].filter(Boolean);
  if (commentParts.length) {
    document.getElementById("comments").value = commentParts.join("\n\n");
    filled.push("Comments");
  }

  updateTicketBadge(ticket);
  updateProgress();
  showAuditPanel(data, filled);

  const firstEmpty = ["agentName", "evaluationDate"].find(id => !document.getElementById(id)?.value.trim());
  if (firstEmpty) document.getElementById(firstEmpty).focus();
}
