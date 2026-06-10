document.addEventListener("appReady", () => {
  const s = getSettings();
  document.getElementById("serviceNowInstance").value = s.serviceNowInstance || "europarl.service-now.com";
  document.getElementById("defaultEvaluator").value   = s.defaultEvaluator   || "";
  document.getElementById("loginEmail").value         = s.loginEmail         || "";

  // User info
  const user = window.currentUser;
  if (user && !user.isAnonymous) {
    document.getElementById("currentUserEmail").value = user.email || "—";
    document.getElementById("currentUid").value       = user.uid;
  } else {
    document.getElementById("userInfoSection").style.display = "none";
  }

  // ── Appearance: theme ─────────────────────────────────────────────────────
  const currentTheme = s.theme || "light";
  document.querySelectorAll("#themeToggle [data-theme]").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.theme === currentTheme);
  });
  document.querySelectorAll("#themeToggle [data-theme]").forEach(btn => {
    btn.addEventListener("click", () => {
      const theme = btn.dataset.theme;
      document.querySelectorAll("#themeToggle [data-theme]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      applyTheme(theme);
      saveSettings({ ...getSettings(), theme });
    });
  });

  // ── Appearance: language ──────────────────────────────────────────────────
  const langSelect = document.getElementById("languageSelect");
  langSelect.value = s.language || "en";
  langSelect.addEventListener("change", () => {
    saveSettings({ ...getSettings(), language: langSelect.value });
    applyI18n();
    renderAllCriteriaList(); // re-render with new language
  });

  // ── Criteria list ─────────────────────────────────────────────────────────
  renderAllCriteriaList();

  document.getElementById("addCriterionBtn").addEventListener("click", addCustomCriterion);
  document.getElementById("newCriterionLabel").addEventListener("keydown", e => {
    if (e.key === "Enter") addCustomCriterion();
  });

  // ── Save settings ─────────────────────────────────────────────────────────
  document.getElementById("saveSettingsBtn").addEventListener("click", () => {
    saveSettings({
      ...getSettings(),
      serviceNowInstance: document.getElementById("serviceNowInstance").value.trim(),
      defaultEvaluator:   document.getElementById("defaultEvaluator").value.trim(),
      loginEmail:         document.getElementById("loginEmail").value.trim(),
    });
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
