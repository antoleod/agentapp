document.addEventListener("appReady", () => {
  const s = getSettings();
  document.getElementById("serviceNowInstance").value = s.serviceNowInstance || "europarl.service-now.com";
  document.getElementById("defaultEvaluator").value   = s.defaultEvaluator   || "";
  document.getElementById("loginEmail").value         = s.loginEmail         || "";

  // ── Evaluation Defaults ───────────────────────────────────────────────────
  document.getElementById("defaultSla").value        = s.defaultSla    || "No";
  document.getElementById("defaultScore").value      = s.defaultScore  !== undefined ? s.defaultScore : "3";
  document.getElementById("requireAllScores").checked = !!s.requireAllScores;

  ["defaultSla", "defaultScore"].forEach(id => {
    document.getElementById(id).addEventListener("change", e => {
      saveSettings({ ...getSettings(), [id]: e.target.value });
      toast(t("set.save") + " ✓", "success");
    });
  });
  document.getElementById("requireAllScores").addEventListener("change", e => {
    saveSettings({ ...getSettings(), requireAllScores: e.target.checked });
    toast(t("set.save") + " ✓", "success");
  });

  // User info
  const user = window.currentUser;
  if (user && !user.isAnonymous) {
    document.getElementById("currentUserEmail").value = user.email || "—";
    document.getElementById("currentUid").value       = user.uid;
  } else {
    document.getElementById("userInfoSection").style.display = "none";
  }

  // ── Appearance: theme picker ──────────────────────────────────────────────
  const THEMES = [
    { id: "light",    name: "Light",    sidebar: "#0f172a", primary: "#2563eb", bg: "#f1f5f9", panel: "#ffffff" },
    { id: "dark",     name: "Dark",     sidebar: "#0f172a", primary: "#2563eb", bg: "#0f172a", panel: "#1e293b" },
    { id: "ocean",    name: "Ocean",    sidebar: "#0c2340", primary: "#0891b2", bg: "#f0f9ff", panel: "#ffffff" },
    { id: "forest",   name: "Forest",   sidebar: "#14532d", primary: "#16a34a", bg: "#f0fdf4", panel: "#ffffff" },
    { id: "sunset",   name: "Sunset",   sidebar: "#431407", primary: "#ea580c", bg: "#fff7ed", panel: "#ffffff" },
    { id: "violet",   name: "Violet",   sidebar: "#3b0764", primary: "#7c3aed", bg: "#faf5ff", panel: "#ffffff" },
    { id: "midnight", name: "Midnight", sidebar: "#020617", primary: "#6366f1", bg: "#020617", panel: "#0f172a" },
  ];

  const currentTheme = s.theme || "light";
  const picker = document.getElementById("themePicker");
  picker.innerHTML = THEMES.map(th => `
    <div class="theme-swatch${th.id === currentTheme ? " active" : ""}"
         data-theme="${th.id}" role="button" tabindex="0"
         aria-pressed="${th.id === currentTheme}" title="${th.name}">
      <div class="swatch-preview">
        <div class="swatch-sidebar" style="background:${th.sidebar}">
          <div class="swatch-dot" style="background:${th.primary}"></div>
          <div class="swatch-dot" style="background:rgba(255,255,255,.15)"></div>
          <div class="swatch-dot" style="background:rgba(255,255,255,.08)"></div>
        </div>
        <div class="swatch-content" style="background:${th.bg}">
          <div class="swatch-bar" style="background:${th.primary}"></div>
          <div class="swatch-panel" style="background:${th.panel}"></div>
        </div>
      </div>
      <span class="swatch-name">${th.name}</span>
    </div>
  `).join("");

  picker.addEventListener("click", e => {
    const swatch = e.target.closest("[data-theme]");
    if (!swatch) return;
    const theme = swatch.dataset.theme;
    picker.querySelectorAll(".theme-swatch").forEach(sw => {
      sw.classList.remove("active");
      sw.setAttribute("aria-pressed", "false");
    });
    swatch.classList.add("active");
    swatch.setAttribute("aria-pressed", "true");
    applyTheme(theme);
    saveSettings({ ...getSettings(), theme });
  });

  picker.addEventListener("keydown", e => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.target.closest("[data-theme]")?.click();
    }
  });

  // ── Appearance: font picker ──────────────────────────────────────────────
  const currentFont = s.font || "inter";
  const fontPicker  = document.getElementById("fontPicker");

  // Pre-load all fonts so swatches render correctly
  FONTS.forEach(f => { if (f.id !== "inter") loadGoogleFont(f); });

  fontPicker.innerHTML = FONTS.map(f => `
    <div class="font-swatch${f.id === currentFont ? " active" : ""}"
         data-font="${f.id}" role="button" tabindex="0"
         aria-pressed="${f.id === currentFont}" title="${f.name}"
         style="font-family:${f.stack}">
      <div class="font-swatch-sample">Aa</div>
      <div class="font-swatch-sub">0–9 Bb</div>
      <div class="font-swatch-name">${f.name}</div>
    </div>
  `).join("");

  fontPicker.addEventListener("click", e => {
    const swatch = e.target.closest("[data-font]");
    if (!swatch) return;
    const fontId = swatch.dataset.font;
    fontPicker.querySelectorAll(".font-swatch").forEach(sw => {
      sw.classList.remove("active");
      sw.setAttribute("aria-pressed", "false");
    });
    swatch.classList.add("active");
    swatch.setAttribute("aria-pressed", "true");
    applyFont(fontId);
    saveSettings({ ...getSettings(), font: fontId });
  });

  fontPicker.addEventListener("keydown", e => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.target.closest("[data-font]")?.click();
    }
  });

  // ── Appearance: font size ─────────────────────────────────────────────────
  const currentSize  = s.fontSize || "md";
  const sizeBtns     = document.querySelectorAll("#fontSizePicker .toggle-btn");
  sizeBtns.forEach(btn => {
    if (btn.dataset.size === currentSize) btn.classList.add("active");
    btn.addEventListener("click", () => {
      sizeBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const size = btn.dataset.size;
      applyFontSize(size);
      saveSettings({ ...getSettings(), fontSize: size });
    });
  });

  // ── Appearance: language ──────────────────────────────────────────────────
  const langSelect = document.getElementById("languageSelect");
  langSelect.value = s.language || "en";
  langSelect.addEventListener("change", () => {
    saveSettings({ ...getSettings(), language: langSelect.value });
    applyI18n();
    renderAllCriteriaList();
  });

  // ── Appearance: date format + compact table ───────────────────────────────
  document.getElementById("dateFormat").value      = s.dateFormat || "iso";
  document.getElementById("compactTable").checked  = !!s.compactTable;

  document.getElementById("dateFormat").addEventListener("change", e => {
    saveSettings({ ...getSettings(), dateFormat: e.target.value });
    toast(t("set.save") + " ✓", "success");
  });
  document.getElementById("compactTable").addEventListener("change", e => {
    saveSettings({ ...getSettings(), compactTable: e.target.checked });
    toast(t("set.save") + " ✓", "success");
  });

  // ── Database View ─────────────────────────────────────────────────────────
  document.getElementById("dbDefaultSort").value       = s.dbDefaultSort    || "date_desc";
  document.getElementById("dbRowsPerPage").value       = s.dbRowsPerPage !== undefined ? String(s.dbRowsPerPage) : "50";
  document.getElementById("dbShowKpi").checked         = s.dbShowKpi !== false;
  document.getElementById("dbHighlightBreaches").checked = s.dbHighlightBreaches !== false;

  ["dbDefaultSort","dbRowsPerPage"].forEach(id => {
    document.getElementById(id).addEventListener("change", e => {
      saveSettings({ ...getSettings(), [id]: id === "dbRowsPerPage" ? Number(e.target.value) : e.target.value });
      toast(t("set.save") + " ✓", "success");
    });
  });
  ["dbShowKpi","dbHighlightBreaches"].forEach(id => {
    document.getElementById(id).addEventListener("change", e => {
      saveSettings({ ...getSettings(), [id]: e.target.checked });
      toast(t("set.save") + " ✓", "success");
    });
  });

  // ── Form Behavior ─────────────────────────────────────────────────────────
  document.getElementById("formAutoOpenSN").checked      = !!s.formAutoOpenSN;
  document.getElementById("formClearAfterSave").checked  = !!s.formClearAfterSave;
  document.getElementById("formShowScoreHints").checked  = s.formShowScoreHints !== false;

  ["formAutoOpenSN","formClearAfterSave","formShowScoreHints"].forEach(id => {
    document.getElementById(id).addEventListener("change", e => {
      saveSettings({ ...getSettings(), [id]: e.target.checked });
      toast(t("set.save") + " ✓", "success");
    });
  });

  // ── Export Defaults ───────────────────────────────────────────────────────
  document.getElementById("exportDefaultFormat").value    = s.exportDefaultFormat || "csv";
  document.getElementById("slaThreshold").value           = s.slaThreshold !== undefined ? s.slaThreshold : 100;
  document.getElementById("exportIncludeComments").checked = s.exportIncludeComments !== false;

  document.getElementById("exportDefaultFormat").addEventListener("change", e => {
    saveSettings({ ...getSettings(), exportDefaultFormat: e.target.value });
    toast(t("set.save") + " ✓", "success");
  });
  document.getElementById("slaThreshold").addEventListener("change", e => {
    saveSettings({ ...getSettings(), slaThreshold: Number(e.target.value) });
    toast(t("set.save") + " ✓", "success");
  });
  document.getElementById("exportIncludeComments").addEventListener("change", e => {
    saveSettings({ ...getSettings(), exportIncludeComments: e.target.checked });
    toast(t("set.save") + " ✓", "success");
  });

  // ── Data Behavior ────────────────────────────────────────────────────────
  document.getElementById("confirmDeleteSingle").checked = s.confirmDeleteSingle !== false;
  document.getElementById("confirmDeleteSingle").addEventListener("change", e => {
    saveSettings({ ...getSettings(), confirmDeleteSingle: e.target.checked });
    toast(t("set.save") + " ✓", "success");
  });

  document.getElementById("autoSaveDraft").checked = !!s.autoSaveDraft;
  document.getElementById("autoSaveDraft").addEventListener("change", e => {
    saveSettings({ ...getSettings(), autoSaveDraft: e.target.checked });
    toast(t("set.save") + " ✓", "success");
  });

  // ── Agent Roster ─────────────────────────────────────────────────────────
  renderAgentRoster();
  document.getElementById("addAgentBtn").addEventListener("click", addAgentToRoster);
  document.getElementById("newAgentName").addEventListener("keydown", e => {
    if (e.key === "Enter") addAgentToRoster();
  });

  // ── Criteria list ─────────────────────────────────────────────────────────
  renderAllCriteriaList();

  document.getElementById("addCriterionBtn").addEventListener("click", addCustomCriterion);
  document.getElementById("newCriterionLabel").addEventListener("keydown", e => {
    if (e.key === "Enter") addCustomCriterion();
  });

  // ── Save settings ─────────────────────────────────────────────────────────
  document.getElementById("saveSettingsBtn").addEventListener("click", () => {
    const updated = {
      ...getSettings(),
      serviceNowInstance: document.getElementById("serviceNowInstance").value.trim(),
      defaultEvaluator:   document.getElementById("defaultEvaluator").value.trim(),
    };
    // loginEmail is intentionally not persisted to localStorage (credential leak risk)
    delete updated.loginEmail;
    saveSettings(updated);
    toast(t("set.save") + " ✓", "success");
  });

  document.getElementById("changePasswordBtn")?.addEventListener("click", async () => {
    if (!user || user.isAnonymous) { toast("Not available for guest.", "warning"); return; }
    try {
      await window.auth.sendPasswordResetEmail(user.email);
      toast("Password reset email sent to " + user.email, "info");
    } catch (err) {
      toast("Error: " + err.message, "error");
    }
  });
});

// ── Agent roster ─────────────────────────────────────────────────────────────
function renderAgentRoster() {
  const roster  = getSettings().agentRoster || [];
  const listEl  = document.getElementById("agentRosterList");

  if (!roster.length) {
    listEl.innerHTML = `<p style="font-size:12px;color:var(--muted);padding:4px 0">${t("set.no_agents")}</p>`;
    return;
  }

  listEl.innerHTML = roster.map((name, idx) => `
    <div style="display:flex;align-items:center;gap:10px;padding:8px 12px;
                background:var(--bg);border:1px solid var(--border);border-radius:var(--r-md)">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--muted);flex-shrink:0">
        <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>
      </svg>
      <span style="flex:1;font-size:13.5px;font-weight:500">${escapeHtml(name)}</span>
      <button class="btn btn-ghost btn-sm" data-remove-agent="${idx}" aria-label="${t("set.remove")}">
        ${trashIcon()}
        <span style="font-size:12px">${t("set.remove")}</span>
      </button>
    </div>
  `).join("");

  listEl.querySelectorAll("[data-remove-agent]").forEach(btn => {
    btn.addEventListener("click", () => {
      const i        = parseInt(btn.dataset.removeAgent, 10);
      const settings = getSettings();
      const updated  = (settings.agentRoster || []).filter((_, j) => j !== i);
      saveSettings({ ...settings, agentRoster: updated });
      renderAgentRoster();
      toast(t("set.remove") + " ✓", "info");
    });
  });
}

function addAgentToRoster() {
  const input   = document.getElementById("newAgentName");
  const name    = input.value.trim();
  if (!name) { input.focus(); toast(t("set.agent_name_ph") + "?", "warning"); return; }

  const settings = getSettings();
  const roster   = settings.agentRoster || [];
  if (roster.some(n => n.toLowerCase() === name.toLowerCase())) {
    toast("Already in roster.", "warning"); return;
  }

  saveSettings({ ...settings, agentRoster: [...roster, name] });
  input.value = "";
  renderAgentRoster();
  toast(`"${name}" added to roster.`, "success");
}

// ── Unified criteria list (built-ins toggleable + custom removable) ───────────
function renderAllCriteriaList() {
  const hidden   = getHiddenCriteria();
  const custom   = getCustomCriteria();
  const list     = document.getElementById("allCriteriaList");

  const rows = [
    ...BUILTIN_CRITERIA.map(c => ({
      id:      c.id,
      label:   t(c.labelKey),
      hint:    t(c.hintKey),
      builtin: true,
      visible: !hidden.includes(c.id),
    })),
    ...custom.map(c => ({
      id:      c.id,
      label:   c.label,
      hint:    c.hint || "",
      builtin: false,
      visible: true,
    })),
  ];

  list.innerHTML = rows.map(r => `
    <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;
                background:var(--bg);border:1px solid var(--border);border-radius:var(--r-md);
                opacity:${r.visible ? 1 : 0.5}">
      <div style="flex:1;min-width:0">
        <div style="font-size:13.5px;font-weight:600;color:var(--text)">${escapeHtml(r.label)}</div>
        ${r.hint ? `<div style="font-size:12px;color:var(--muted)">${escapeHtml(r.hint)}</div>` : ""}
      </div>
      <span style="font-size:11px;padding:2px 8px;border-radius:var(--r-full);
                   background:${r.builtin ? "var(--primary-light)" : "var(--warning-light)"};
                   color:${r.builtin ? "var(--primary)" : "var(--warning)"};font-weight:600">
        ${r.builtin ? t("set.builtin") : t("set.custom")}
      </span>
      ${r.builtin ? `
        <button class="btn btn-ghost btn-sm" data-toggle="${r.id}" aria-label="${r.visible ? t("set.hidden") : t("set.visible")}">
          ${r.visible ? visibleIcon() : hiddenIcon()}
          <span style="font-size:12px">${r.visible ? t("set.visible") : t("set.hidden")}</span>
        </button>
      ` : `
        <button class="btn btn-ghost btn-sm" data-remove="${r.id}" aria-label="${t("set.remove")}">
          ${trashIcon()}
          <span style="font-size:12px">${t("set.remove")}</span>
        </button>
      `}
    </div>
  `).join("");

  // Toggle built-in visibility
  list.querySelectorAll("[data-toggle]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id       = btn.dataset.toggle;
      const settings = getSettings();
      let hidden     = settings.hiddenCriteria || [];
      hidden = hidden.includes(id) ? hidden.filter(x => x !== id) : [...hidden, id];
      saveSettings({ ...settings, hiddenCriteria: hidden });
      renderAllCriteriaList();
      toast(t("form.s2_title") + " — " + t("set.save") + " ✓", "success");
    });
  });

  // Remove custom criterion
  list.querySelectorAll("[data-remove]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id       = btn.dataset.remove;
      const settings = getSettings();
      saveSettings({ ...settings, customCriteria: (settings.customCriteria || []).filter(c => c.id !== id) });
      renderAllCriteriaList();
      toast(t("set.remove") + " ✓", "info");
    });
  });
}

function addCustomCriterion() {
  const labelEl = document.getElementById("newCriterionLabel");
  const hintEl  = document.getElementById("newCriterionHint");
  const label   = labelEl.value.trim();
  if (!label) { labelEl.focus(); toast(t("set.crit_name") + "?", "warning"); return; }

  const settings = getSettings();
  const criteria = settings.customCriteria || [];
  if (criteria.some(c => c.label.toLowerCase() === label.toLowerCase())) {
    toast("Already exists.", "warning"); return;
  }

  criteria.push({ id: "crit_" + Date.now(), label, hint: hintEl.value.trim() });
  saveSettings({ ...settings, customCriteria: criteria });
  labelEl.value = "";
  hintEl.value  = "";
  renderAllCriteriaList();
  toast(`"${label}" added.`, "success");
}

// ── Icon helpers ──────────────────────────────────────────────────────────────
function visibleIcon() {
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
}
function hiddenIcon() {
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24M1 1l22 22"/></svg>`;
}
function trashIcon() {
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>`;
}
