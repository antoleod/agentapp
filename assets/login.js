// ─────────────────────────────────────────────────────────────────────────────
// Firebase Configuration
// Get apiKey and appId from: Firebase Console → Project Settings → Your apps
// ─────────────────────────────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey:            "AIzaSyAGGYZZu6MSehZVPl1OBfZhFJZnd1phF-c",          // ← paste from Firebase Console
  authDomain:        "agentapp-8ea1c.firebaseapp.com",
  projectId:         "agentapp-8ea1c",
  storageBucket:     "agentapp-8ea1c.firebasestorage.app",
  messagingSenderId: "1042238748559",
  appId:             "1:1042238748559:web:772ec4d883fa6864927dfa",           // ← paste from Firebase Console
};

firebase.initializeApp(firebaseConfig);

window.auth      = firebase.auth();
window.db = firebase.firestore();
window.functions = typeof firebase.functions === "function" ? firebase.functions() : null;
window.firebaseConfig = firebaseConfig;

// Offline persistence — works across page reloads
window.db.enablePersistence({ synchronizeTabs: true }).catch(() => {});

// src/core/state.js
// Centralized state store for shared data-layer variables.
// Private UI state (e.g. _mathAnswer) stays local in each feature file.

const _state = {
  allData:          [],   // database.js — full evaluation list
  reportData:       [],   // reports.js  — evaluation list for reports page
  importParsed:     null, // database.js — parsed JSON from import preview
  auditAllEntries:  [],   // database/audit.js — cached audit log entries
};

function getState()              { return _state; }
function setState(patch)         { Object.assign(_state, patch); }
function getStateKey(key)        { return _state[key]; }
function setStateKey(key, value) { _state[key] = value; }

// Shared string utilities — source of truth for emailKey, escapeHtml, etc.

function emailKey(email) {
  if (!email) return null;
  return email.toLowerCase().replace(/[@.]/g, "_");
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDisplayDate(isoDate) {
  if (!isoDate) return "—";
  const fmt = getSettings().dateFormat || "iso";
  const parts = isoDate.split("-");
  if (parts.length !== 3) return isoDate;
  const [y, m, d] = parts;
  if (fmt === "dmy") return `${d}/${m}/${y}`;
  if (fmt === "mdy") return `${m}/${d}/${y}`;
  return isoDate;
}

function formatEmailName(email) {
  const local = email.split("@")[0] || "User";
  return local
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, c => c.toUpperCase());
}

// DOM utility helpers
// Depends on: nothing

function showLoading() {
  const el = document.getElementById("loadingOverlay");
  if (el) el.classList.remove("hidden");
}

function hideLoading() {
  const el = document.getElementById("loadingOverlay");
  if (el) el.classList.add("hidden");
}

// App-level settings — persisted in localStorage under SETTINGS_KEY
// Depends on: nothing (self-contained)

const SETTINGS_KEY       = "agentEvaluationSettingsV1";
const SEARCH_HISTORY_KEY = "serviceNowSearchHistoryV1";

function getSettings() {
  return JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
}

function saveSettings(settings) {
  delete settings.loginEmail;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

// Clean up any previously stored loginEmail credential
(function () {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    if ("loginEmail" in s) {
      delete s.loginEmail;
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
    }
  } catch (_) {}
})();

// Data layer — Firestore primary, localStorage cache
// Depends on: firebase.js (window.db), appSettings.js (none direct — uses constants below)

const STORAGE_KEY    = "agentEvaluationsV2";
const SYNC_KEY       = "agentSyncMetaV1";
const COLLECTION     = "evaluations";
const AUDIT_COLLECTION = "auditLog";

async function getData(opts = {}) {
  if (sessionStorage.getItem("guestSession") === "1") return [];

  const { forceFullSync = false } = opts;
  const cached   = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  const syncMeta = JSON.parse(localStorage.getItem(SYNC_KEY)    || "{}");

  try {
    if (!forceFullSync && cached.length && syncMeta.lastSyncedAt) {
      // Incremental: only fetch records modified after the last successful sync
      const since = firebase.firestore.Timestamp.fromDate(new Date(syncMeta.lastSyncedAt));
      const snap  = await window.db.collection(COLLECTION)
        .where("updatedAt", ">", since)
        .orderBy("updatedAt", "desc")
        .get();

      localStorage.setItem(SYNC_KEY, JSON.stringify({ lastSyncedAt: new Date().toISOString() }));

      if (snap.empty) return cached;

      const map = new Map(cached.map(x => [x.ticketNumber, x]));
      snap.docs.forEach(d => map.set(d.id, d.data()));
      const merged = [...map.values()].sort(
        (a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0)
      );
      localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
      return merged;
    }

    // Full sync — capped at 1000 most recent records
    const snap = await window.db.collection(COLLECTION)
      .orderBy("createdAt", "desc")
      .limit(1000)
      .get();
    const data = snap.docs.map(d => d.data());
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    localStorage.setItem(SYNC_KEY, JSON.stringify({ lastSyncedAt: new Date().toISOString() }));
    return data;
  } catch (e) {
    logError("getData", e);
    return cached;
  }
}

// Real-time listener — fires callback with merged cache on any remote change
let _unsubscribeSnapshot = null;

function subscribeData(callback) {
  if (_unsubscribeSnapshot) _unsubscribeSnapshot();
  if (sessionStorage.getItem("guestSession") === "1") return;

  _unsubscribeSnapshot = window.db.collection(COLLECTION)
    .orderBy("updatedAt", "desc")
    .limit(50)
    .onSnapshot({ includeMetadataChanges: false }, snap => {

      const cached = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      let changed = false;

      snap.docChanges().forEach(change => {
        const key = change.doc.id;
        const doc = change.doc.data();
        if (change.type === "added" || change.type === "modified") {
          const idx = cached.findIndex(x => x.ticketNumber === key);
          if (idx >= 0) {
            if (JSON.stringify(cached[idx]) !== JSON.stringify(doc)) {
              cached[idx] = doc;
              changed = true;
            }
          } else {
            cached.unshift(doc);
            changed = true;
          }
        } else if (change.type === "removed") {
          const idx = cached.findIndex(x => x.ticketNumber === key);
          if (idx >= 0) { cached.splice(idx, 1); changed = true; }
        }
      });

      if (changed) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(cached));
        callback(cached);
      }
    }, () => {});
}

function unsubscribeData() {
  if (_unsubscribeSnapshot) { _unsubscribeSnapshot(); _unsubscribeSnapshot = null; }
}

// Normalize a Firestore updatedAt (Timestamp | {seconds} | ISO string | ms) to millis.
function tsToMillis(x) {
  if (x == null) return null;
  if (typeof x.toMillis === "function") return x.toMillis();
  if (typeof x.seconds === "number") return x.seconds * 1000;
  if (typeof x === "number") return x;
  const p = Date.parse(x);
  return isNaN(p) ? null : p;
}

// Current server-side updatedAt (millis) for a ticket, or null. Used for conflict detection.
async function getEvaluationUpdatedAt(ticketNumber) {
  try {
    const doc = await window.db.collection(COLLECTION).doc(ticketNumber).get();
    return doc.exists ? tsToMillis(doc.data().updatedAt) : null;
  } catch {
    return null;
  }
}

// True if an evaluation already exists for this ticket (cache first, then Firestore).
async function evaluationExists(ticketNumber) {
  if (!ticketNumber) return false;
  const cached = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  if (cached.some(x => x.ticketNumber === ticketNumber)) return true;
  try {
    const doc = await window.db.collection(COLLECTION).doc(ticketNumber).get();
    return doc.exists;
  } catch {
    return false;
  }
}

async function saveEvaluation(item, auditCtx = {}) {
  await window.db.collection(COLLECTION).doc(item.ticketNumber).set({
    ...item,
    ownerUid: (firebase.auth().currentUser?.uid) || item.ownerUid || 'guest',
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
  const cached = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  const idx = cached.findIndex(x => x.ticketNumber === item.ticketNumber);
  if (idx >= 0) cached[idx] = item; else cached.unshift(item);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cached));

  const { action = "create", prevData = null } = auditCtx;
  let changes = null;
  if (action === "update" && prevData) {
    changes = {};
    const keys = new Set([...Object.keys(prevData), ...Object.keys(item)]);
    keys.forEach(k => {
      if (k === "updatedAt" || k === "createdAt") return;
      if (String(prevData[k] ?? "") !== String(item[k] ?? "")) {
        changes[k] = { before: prevData[k] ?? null, after: item[k] ?? null };
      }
    });
    if (!Object.keys(changes).length) changes = null;
  }
  logAudit({
    action,
    ticketNumber:   item.ticketNumber,
    agentName:      item.agentName      || "",
    evaluationDate: item.evaluationDate || "",
    changes,
    snapshot: action === "create" ? item : null,
  });
}

async function deleteEvaluation(ticketNumber, snapshot = null) {
  await window.db.collection(COLLECTION).doc(ticketNumber).delete();
  const cached = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  localStorage.setItem(STORAGE_KEY,
    JSON.stringify(cached.filter(x => x.ticketNumber !== ticketNumber))
  );
  logAudit({
    action:         "delete",
    ticketNumber,
    agentName:      snapshot?.agentName      || "",
    evaluationDate: snapshot?.evaluationDate || "",
    snapshot,
  });
}

function logAudit(entry) {
  const user = window.currentUser;
  window.db.collection(AUDIT_COLLECTION).add({
    ...entry,
    performedBy: user ? (user.email || user.uid || "unknown") : "anonymous",
    timestamp:   firebase.firestore.FieldValue.serverTimestamp(),
  }).catch(() => {});
}

async function getAuditLog(limit = 300) {
  try {
    const snap = await window.db.collection(AUDIT_COLLECTION)
      .orderBy("timestamp", "desc")
      .limit(limit)
      .get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch {
    return [];
  }
}

// Role management — Firestore: roles/{emailKey}
// Depends on: firebase.js (window.db), strings.js (emailKey global)

const ROLES_COLLECTION = "roles";

async function getUserRole(email) {
  const key = emailKey(email);
  if (!key) return null;
  try {
    const doc = await window.db.collection(ROLES_COLLECTION).doc(key).get();
    return doc.exists ? (doc.data().role || null) : null;
  } catch (e) {
    logError("getUserRole", e);
    return null;
  }
}

async function setUserRole(email, displayName, role) {
  const key  = emailKey(email);
  if (!key) throw new Error("Invalid email");
  const user = window.currentUser;
  await window.db.collection(ROLES_COLLECTION).doc(key).set({
    email,
    displayName: displayName || email.split("@")[0],
    role,
    addedAt:         new Date().toISOString(),
    addedBy:         user ? (user.email || user.uid || "unknown") : "unknown",
    mustSetPassword: true,
  });
}

// Updates only the role field — does NOT reset mustSetPassword
async function updateUserRole(docId, role) {
  const user = window.currentUser;
  await window.db.collection(ROLES_COLLECTION).doc(docId).update({
    role,
    updatedAt: new Date().toISOString(),
    updatedBy: user ? (user.email || user.uid || "unknown") : "unknown",
  });
}

async function removeUserRole(docId) {
  await window.db.collection(ROLES_COLLECTION).doc(docId).delete();
}

async function listAllRoles() {
  try {
    const snap = await window.db.collection(ROLES_COLLECTION).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    logError("listAllRoles", e);
    return [];
  }
}

async function isAdmin(email) {
  if (!email) return false;
  try {
    const role = await getUserRole(email);
    return role === "admin";
  } catch {
    return false;
  }
}

// Score criteria — built-in definitions, helpers, and score utilities
// Depends on: appSettings.js (getSettings via getHiddenCriteria/getCustomCriteria)

const BUILTIN_CRITERIA = [
  { id: "assetTracking",      labelKey: "crit.assetTracking",           hintKey: "crit.assetTracking.hint" },
  { id: "planningCompliance", labelKey: "crit.planningCompliance",      hintKey: "crit.planningCompliance.hint" },
  { id: "kbCompliance",       labelKey: "crit.kbCompliance",            hintKey: "crit.kbCompliance.hint" },
  { id: "teamSpirit",         labelKey: "crit.teamSpirit",              hintKey: "crit.teamSpirit.hint" },
  { id: "dressCode",          labelKey: "crit.dressCode",               hintKey: "crit.dressCode.hint" },
  { id: "customerOriented",   labelKey: "crit.customerOriented",        hintKey: "crit.customerOriented.hint" },
  { id: "backlogManagement",  labelKey: "crit.backlogManagement",       hintKey: "crit.backlogManagement.hint" },
  { id: "ticketQualityDoc",   labelKey: "crit.ticketQualityDoc",        hintKey: "crit.ticketQualityDoc.hint" },
];

// Keep for backward compat (CSV export, calculateAverage legacy paths)
const scoreFields = BUILTIN_CRITERIA.map(c => c.id);

const scoreLabels = {
  assetTracking:      "Asset Tracking",
  planningCompliance: "Planning Compliance",
  kbCompliance:       "KB Compliance",
  teamSpirit:         "Team Spirit",
  dressCode:          "Dress Code",
  customerOriented:   "Customer Oriented",
  backlogManagement:  "Backlog Management",
  ticketQualityDoc:   "Ticket Quality Documentation",
};

function getHiddenCriteria() {
  return getSettings().hiddenCriteria || [];
}

function getCustomCriteria() {
  return getSettings().customCriteria || [];
}

function getActiveCriteria() {
  const hidden = getHiddenCriteria();
  const builtins = BUILTIN_CRITERIA
    .filter(c => !hidden.includes(c.id))
    .map(c => ({ ...c, builtin: true }));
  const custom = getCustomCriteria().map(c => ({ ...c, builtin: false }));
  return [...builtins, ...custom];
}

function getAllScoreFields() {
  return getActiveCriteria().map(c => c.id);
}

function calculateAverage(item) {
  const fields = getAllScoreFields().filter(f => item[f] !== undefined && item[f] !== "");
  if (!fields.length) return 0;
  const total = fields.reduce((s, f) => s + Number(item[f] || 0), 0);
  return Number((total / fields.length).toFixed(2));
}

// Prefer the avgScore stored at save time (stable, independent of the viewer's
// active criteria); fall back to recomputing for older records that lack it.
function getAvg(item) {
  return typeof item.avgScore === "number" ? item.avgScore : calculateAverage(item);
}

function scoreClass(avg) {
  if (avg >= 4) return "score-high";
  if (avg >= 3) return "score-mid";
  return "score-low";
}

// Theme and typography — applies visual preferences immediately on load
// Depends on: appSettings.js (getSettings global)

const FONTS = [
  { id: "inter",     name: "Inter",          stack: "'Inter', system-ui, sans-serif",      gf: "Inter:wght@400;500;600;700" },
  { id: "dmsans",    name: "DM Sans",        stack: "'DM Sans', system-ui, sans-serif",    gf: "DM+Sans:wght@400;500;600;700" },
  { id: "outfit",    name: "Outfit",         stack: "'Outfit', system-ui, sans-serif",     gf: "Outfit:wght@400;500;600;700" },
  { id: "jetbrains", name: "JetBrains Mono", stack: "'JetBrains Mono', monospace",         gf: "JetBrains+Mono:wght@400;500;600;700" },
];

function loadGoogleFont(fontDef) {
  const id = "gfont-" + fontDef.id;
  if (document.getElementById(id)) return;
  const link = document.createElement("link");
  link.id   = id;
  link.rel  = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${fontDef.gf}&display=swap`;
  document.head.appendChild(link);
}

function applyFont(fontId) {
  const font = FONTS.find(f => f.id === fontId) || FONTS[0];
  if (fontId && fontId !== "inter") loadGoogleFont(font);
  document.documentElement.style.setProperty("--font-family", font.stack);
}

function applyFontSize(size) {
  const map = { sm: "13px", md: "14px", lg: "15px" };
  document.documentElement.style.setProperty("--font-size-base", map[size] || "14px");
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme || "light");
}

// Apply immediately on script load (before DOM paint)
applyTheme(getSettings().theme || "light");
applyFont(getSettings().font);
applyFontSize(getSettings().fontSize);

// src/core/i18n.js
// Translations organized by language. Synchronous — no fetch risk.
// To add a language: add a LANG_XX object and register it in TRANSLATIONS_MAP.

const LANG_EN = {
  // Navigation
  "nav.form":     "Form",
  "nav.database": "Database",
  "nav.reports":  "Reports",
  "nav.settings": "Settings",
  "nav.signout":  "Sign out",
  "nav.guest":    "Guest access",

  // Login
  "login.title":       "Welcome back",
  "login.subtitle":    "Sign in to your account to continue",
  "login.email":       "Email address",
  "login.password":    "Password",
  "login.signin":      "Sign In",
  "login.guest":       "Continue as Guest",
  "login.secured":     "Secured by Firebase Authentication",

  // Form page
  "form.title":        "Evaluation Form",
  "form.subtitle":     "Create or update an agent evaluation",
  "form.paste":        "Paste ServiceNow",
  "form.open_sn":      "Open in ServiceNow",
  "form.clear":        "Clear",
  "form.save":         "Save Evaluation",
  "form.saving":       "Saving…",
  "form.load":         "Load Saved Ticket",
  "form.s1_title":     "Ticket Information",
  "form.s1_sub":       "Main ticket and agent details",
  "form.s2_title":     "Evaluation Scores",
  "form.s2_sub":       "Click a number to score each criterion (1 = Poor, 5 = Excellent)",
  "form.s3_title":     "Notes",
  "form.s3_sub":       "Additional context and evaluator",
  "form.ticket":       "Ticket Number",
  "form.ticket_ph":    "INC0123456",
  "form.ticket_hint":  "Press Enter or click the icon to open in ServiceNow",
  "form.agent":        "Agent Name",
  "form.date":         "Evaluation Date",
  "form.sla":          "SLA Breach",
  "form.sla_ok":       "✓ Within SLA",
  "form.sla_breach":   "⚠ Breached",
  "form.lsa":          "LSA / Support Area",
  "form.evaluated_by": "Evaluated By",
  "form.comments":     "Comments",
  "form.req_missing":  "required field missing",
  "form.req_missing_pl": "required fields missing",
  "form.all_complete": "All fields complete — ready to save",
  "form.draft_restored": "Draft restored",
  "form.dup_confirm": "An evaluation for this ticket already exists. Overwrite it?",
  "form.conflict_confirm": "This evaluation was changed elsewhere since you opened it. Overwrite those changes?",
  "form.of_fields":    "of",
  "form.fields_filled":"fields filled",

  // Criteria
  "crit.assetTracking":           "Asset Tracking",
  "crit.assetTracking.hint":      "Asset registration & tracking",
  "crit.planningCompliance":      "Planning Compliance",
  "crit.planningCompliance.hint": "Adherence to schedule",
  "crit.kbCompliance":            "KB Compliance",
  "crit.kbCompliance.hint":       "Knowledge base usage",
  "crit.teamSpirit":              "Team Spirit",
  "crit.teamSpirit.hint":         "Collaboration & attitude",
  "crit.dressCode":               "Dress Code",
  "crit.dressCode.hint":          "Professional appearance",
  "crit.customerOriented":        "Customer Oriented",
  "crit.customerOriented.hint":   "Quality of customer interaction",
  "crit.backlogManagement":       "Backlog Management",
  "crit.backlogManagement.hint":  "Timely handling of pending tickets",
  "crit.ticketQualityDoc":        "Ticket Quality Documentation",
  "crit.ticketQualityDoc.hint":   "Clarity & completeness of ticket notes",
  "sla.pick":           "Select the LSA / SLA:",
  "sla.blocked_tag":    "blocked",
  "sla.highest":        "highest %",
  "sla.reqlevel_note":  "ℹ️ RITM/REQ tickets have no SLA of their own. To evaluate the SLA, open and evaluate the related SCTASK.",
  "sla.blocked_toast":  "SLA blocked by the team",
  "sla.selected":       "LSA selected",
  "sla.mgmt_title":     "SLA Management",
  "sla.mgmt_sub":       "Auto-collected from ServiceNow imports. Block the SLAs the team doesn't evaluate (admins only). Blocked SLAs stay visible in the picker but can't be selected.",
  "sla.loading":        "Loading…",
  "sla.empty":          "No SLAs yet — they appear here automatically after you import tickets from ServiceNow.",
  "sla.active":         "Active",
  "sla.blocked":        "Blocked",
  "sla.block":          "Block",
  "sla.unblock":        "Unblock",
  "sla.blocked_done":   "SLA blocked.",
  "sla.unblocked_done": "SLA unblocked.",
  "sla.update_fail":    "Failed to update SLA.",
  "sla.manage_hint":    "Manage which SLAs appear in Settings.",
  "sla.search_ph":      "Search SLA…",
  "sla.no_match":       "No SLAs match your search.",
  "crit.custom_hint":             "Custom criterion",

  // Database page
  "db.title":         "Database",
  "db.subtitle":      "All saved evaluations",
  "db.search_ph":     "Search ticket, agent, LSA…",
  "db.export_json":   "Export JSON",
  "db.export_csv":    "Export CSV",
  "db.import_json":   "Import JSON",
  "db.delete_all":    "Delete All",
  "db.col_ticket":    "Ticket",
  "db.col_agent":     "Agent",
  "db.col_date":      "Date",
  "db.col_sla":       "SLA",
  "db.col_lsa":       "LSA",
  "db.col_score":     "Score",
  "db.col_evaluated": "Evaluated By",
  "db.col_actions":   "Actions",
  "db.edit":          "Edit",
  "db.open":          "Open",
  "db.delete":        "Delete",

  // Reports page
  "rep.title":        "Reports",
  "rep.subtitle":     "Performance overview",
  "rep.refresh":      "Refresh",
  "rep.total":        "Total Evaluations",
  "rep.breaches":     "SLA Breaches",
  "rep.avg":          "Average Score",
  "rep.all_time":     "All time",
  "rep.out_of_5":     "Out of 5.00",
  "rep.agent_perf":       "Agent Performance",
  "rep.trend_title":      "Monthly average trend",
  "rep.sorted_by":        "Sorted by average score",
  "rep.export":           "Export",
  "rep.export_title":     "Export Report",
  "rep.export_format":    "Format",
  "rep.export_sections":  "Sections",
  "rep.section_summary":  "Summary stats",
  "rep.section_agents":   "Agent performance",
  "rep.section_records":  "Full evaluations",
  "rep.export_columns":   "Columns",
  "rep.export_download":  "Download",
  "rep.filter_title":     "Filters",
  "rep.filter_optional":  "optional",
  "rep.filter_from":      "From date",
  "rep.filter_to":        "To date",
  "rep.filter_sla":       "SLA",
  "rep.filter_all":       "All",
  "rep.filter_breached":  "Breached only",
  "rep.filter_within":    "Within SLA",
  "rep.filter_agent":     "Agent",
  "rep.filter_agent_ph":  "All agents",
  "rep.filter_score":     "Score filter",
  "rep.filter_any_crit":  "Any criterion",

  // Settings page
  "set.title":        "Settings",
  "set.subtitle":     "Configure application preferences",
  "set.app":          "Application",
  "set.sn_url":       "ServiceNow Instance URL",
  "set.default_eval": "Default Evaluated By",
  "set.appearance":   "Appearance",
  "set.theme":        "Theme",
  "set.theme_light":  "Light",
  "set.theme_dark":   "Dark",
  "set.language":     "Language",
  "set.account":      "Account",
  "set.email":        "Email",
  "set.uid":          "User ID",
  "set.login_email":  "Default Login Email",
  "set.reset_pwd":    "Send Password Reset Email",
  "set.save":         "Save Settings",
  "set.criteria":     "Score Criteria",
  "set.criteria_sub": "Show or hide criteria on the evaluation form",
  "set.add_criterion":"Add",
  "set.crit_name":    "Criterion name",
  "set.crit_hint":    "Short description (optional)",
  "set.no_custom":    "No custom criteria yet. Add one below.",
  "set.builtin":      "Built-in",
  "set.custom":       "Custom",
  "set.remove":       "Remove",
  "set.visible":      "Visible",
  "set.hidden":            "Hidden",
  "set.font":              "Font",
  "set.font_size":         "Font Size",
  "set.font_sm":           "S — Small",
  "set.font_md":           "M — Medium",
  "set.font_lg":           "L — Large",
  "set.eval_defaults":     "Evaluation Defaults",
  "set.eval_defaults_sub": "Pre-filled values when you open a new evaluation",
  "set.default_sla":       "Default SLA Breach",
  "set.default_score":     "Default Score",
  "set.no_prefill":        "No pre-fill",
  "set.require_scores":    "Require all scores before saving",
  "set.agents":            "Agent Roster",
  "set.agents_sub":        "Names available as autocomplete suggestions in the form",
  "set.agent_name_ph":     "Full agent name",
  "set.add_agent":         "Add",
  "set.no_agents":         "No agents added yet.",
  "set.date_format":       "Date Format",
  "set.date_iso":          "ISO (YYYY-MM-DD)",
  "set.date_dmy":          "European (DD/MM/YYYY)",
  "set.date_mdy":          "US (MM/DD/YYYY)",
  "set.compact_table":     "Compact table rows",
  "set.data_behavior":     "Data Behavior",
  "set.confirm_delete":    "Ask for confirmation before deleting a record",

  // Common
  "common.loading":    "Loading…",
  "common.eval_label": "evals",
  "common.eval_label1":"eval",
  "common.cancel":     "Cancel",
};

const LANG_ES = {
  "nav.form":     "Formulario",
  "nav.database": "Base de datos",
  "nav.reports":  "Informes",
  "nav.settings": "Configuración",
  "nav.signout":  "Cerrar sesión",
  "nav.guest":    "Acceso de invitado",

  "login.title":       "Bienvenido",
  "login.subtitle":    "Inicia sesión para continuar",
  "login.email":       "Correo electrónico",
  "login.password":    "Contraseña",
  "login.signin":      "Iniciar sesión",
  "login.guest":       "Continuar como invitado",
  "login.secured":     "Protegido por Firebase Authentication",

  "form.title":        "Formulario de evaluación",
  "form.subtitle":     "Crear o actualizar una evaluación de agente",
  "form.paste":        "Pegar ServiceNow",
  "form.open_sn":      "Abrir en ServiceNow",
  "form.clear":        "Limpiar",
  "form.save":         "Guardar evaluación",
  "form.saving":       "Guardando…",
  "form.load":         "Cargar ticket guardado",
  "form.s1_title":     "Información del ticket",
  "form.s1_sub":       "Datos principales del ticket y agente",
  "form.s2_title":     "Puntuaciones de evaluación",
  "form.s2_sub":       "Haz clic en un número para puntuar cada criterio (1 = Malo, 5 = Excelente)",
  "form.s3_title":     "Notas",
  "form.s3_sub":       "Contexto adicional y evaluador",
  "form.ticket":       "Número de ticket",
  "form.ticket_ph":    "INC0123456",
  "form.ticket_hint":  "Pulsa Intro o el icono para abrir en ServiceNow",
  "form.agent":        "Nombre del agente",
  "form.date":         "Fecha de evaluación",
  "form.sla":          "Incumplimiento SLA",
  "form.sla_ok":       "✓ Dentro de SLA",
  "form.sla_breach":   "⚠ Incumplido",
  "form.lsa":          "LSA / Área de soporte",
  "form.assigned":     "Técnico asignado",
  "form.evaluated_by": "Evaluado por",
  "form.comments":     "Comentarios",
  "form.req_missing":  "campo obligatorio pendiente",
  "form.req_missing_pl":"campos obligatorios pendientes",
  "form.all_complete": "Todos los campos completos — listo para guardar",
  "form.draft_restored": "Borrador restaurado",
  "form.dup_confirm": "Ya existe una evaluación para este ticket. ¿Sobrescribir?",
  "form.conflict_confirm": "Esta evaluación fue modificada en otro lugar desde que la abriste. ¿Sobrescribir esos cambios?",
  "form.of_fields":    "de",
  "form.fields_filled":"campos completados",

  "crit.assetTracking":           "Control de activos",
  "crit.assetTracking.hint":      "Registro y seguimiento de activos",
  "crit.planningCompliance":      "Cumplimiento de planificación",
  "crit.planningCompliance.hint": "Adherencia al horario",
  "crit.kbCompliance":            "Cumplimiento de KB",
  "crit.kbCompliance.hint":       "Uso de la base de conocimientos",
  "crit.teamSpirit":              "Espíritu de equipo",
  "crit.teamSpirit.hint":         "Colaboración y actitud",
  "crit.dressCode":               "Código de vestimenta",
  "crit.dressCode.hint":          "Apariencia profesional",
  "crit.customerOriented":        "Orientación al cliente",
  "crit.customerOriented.hint":   "Calidad de la atención al cliente",
  "crit.backlogManagement":       "Gestión del backlog",
  "crit.backlogManagement.hint":  "Atención oportuna de tickets pendientes",
  "crit.ticketQualityDoc":        "Documentación y calidad del ticket",
  "crit.ticketQualityDoc.hint":   "Claridad y detalle de las notas del ticket",
  "sla.pick":           "Selecciona el LSA / SLA:",
  "sla.blocked_tag":    "bloqueado",
  "sla.highest":        "mayor %",
  "sla.reqlevel_note":  "ℹ️ Los RITM/REQ no tienen SLA propio. Para evaluar el SLA, abre y evalúa el SCTASK asociado.",
  "sla.blocked_toast":  "SLA bloqueado por el equipo",
  "sla.selected":       "LSA seleccionado",
  "sla.mgmt_title":     "Gestión de SLA",
  "sla.mgmt_sub":       "Se recolectan automáticamente de los imports de ServiceNow. Bloquea los SLAs que el equipo no evalúa (solo admins). Los bloqueados siguen visibles en el selector pero no se pueden elegir.",
  "sla.loading":        "Cargando…",
  "sla.empty":          "Aún no hay SLAs — aparecen aquí automáticamente cuando importas tickets de ServiceNow.",
  "sla.active":         "Activo",
  "sla.blocked":        "Bloqueado",
  "sla.block":          "Bloquear",
  "sla.unblock":        "Desbloquear",
  "sla.blocked_done":   "SLA bloqueado.",
  "sla.unblocked_done": "SLA desbloqueado.",
  "sla.update_fail":    "No se pudo actualizar el SLA.",
  "sla.manage_hint":    "Gestiona qué SLAs aparecen en Settings.",
  "sla.search_ph":      "Buscar SLA…",
  "sla.no_match":       "Ningún SLA coincide con la búsqueda.",
  "crit.custom_hint":             "Criterio personalizado",

  "db.title":         "Base de datos",
  "db.subtitle":      "Todas las evaluaciones guardadas",
  "db.search_ph":     "Buscar ticket, agente, LSA…",
  "db.export_json":   "Exportar JSON",
  "db.export_csv":    "Exportar CSV",
  "db.import_json":   "Importar JSON",
  "db.delete_all":    "Eliminar todo",
  "db.col_ticket":    "Ticket",
  "db.col_agent":     "Agente",
  "db.col_date":      "Fecha",
  "db.col_sla":       "SLA",
  "db.col_lsa":       "LSA",
  "db.col_score":     "Puntuación",
  "db.col_evaluated": "Evaluado por",
  "db.col_actions":   "Acciones",
  "db.edit":          "Editar",
  "db.open":          "Abrir",
  "db.delete":        "Eliminar",

  "rep.title":        "Informes",
  "rep.subtitle":     "Resumen de rendimiento",
  "rep.refresh":      "Actualizar",
  "rep.total":        "Total de evaluaciones",
  "rep.breaches":     "Incumplimientos SLA",
  "rep.avg":          "Puntuación media",
  "rep.all_time":     "Histórico",
  "rep.out_of_5":     "Sobre 5.00",
  "rep.agent_perf":       "Rendimiento por agente",
  "rep.trend_title":      "Tendencia del promedio mensual",
  "rep.sorted_by":        "Ordenado por puntuación media",
  "rep.export":           "Exportar",
  "rep.export_title":     "Exportar informe",
  "rep.export_format":    "Formato",
  "rep.export_sections":  "Secciones",
  "rep.section_summary":  "Resumen estadístico",
  "rep.section_agents":   "Rendimiento por agente",
  "rep.section_records":  "Evaluaciones completas",
  "rep.export_columns":   "Columnas",
  "rep.export_download":  "Descargar",
  "rep.filter_title":     "Filtros",
  "rep.filter_optional":  "opcional",
  "rep.filter_from":      "Desde",
  "rep.filter_to":        "Hasta",
  "rep.filter_sla":       "SLA",
  "rep.filter_all":       "Todos",
  "rep.filter_breached":  "Solo incumplidos",
  "rep.filter_within":    "Dentro del SLA",
  "rep.filter_agent":     "Agente",
  "rep.filter_agent_ph":  "Todos los agentes",
  "rep.filter_score":     "Filtro de puntuación",
  "rep.filter_any_crit":  "Cualquier criterio",

  "set.title":        "Configuración",
  "set.subtitle":     "Preferencias de la aplicación",
  "set.app":          "Aplicación",
  "set.sn_url":       "URL de instancia ServiceNow",
  "set.default_eval": "Evaluado por defecto",
  "set.appearance":   "Apariencia",
  "set.theme":        "Tema",
  "set.theme_light":  "Claro",
  "set.theme_dark":   "Oscuro",
  "set.language":     "Idioma",
  "set.account":      "Cuenta",
  "set.email":        "Correo",
  "set.uid":          "ID de usuario",
  "set.login_email":  "Correo de inicio de sesión por defecto",
  "set.reset_pwd":    "Enviar correo de restablecimiento",
  "set.save":         "Guardar configuración",
  "set.criteria":     "Criterios de puntuación",
  "set.criteria_sub": "Mostrar u ocultar criterios en el formulario",
  "set.add_criterion":"Agregar",
  "set.crit_name":    "Nombre del criterio",
  "set.crit_hint":    "Descripción corta (opcional)",
  "set.no_custom":    "Sin criterios personalizados. Agrega uno abajo.",
  "set.builtin":      "Predeterminado",
  "set.custom":       "Personalizado",
  "set.remove":       "Eliminar",
  "set.visible":      "Visible",
  "set.hidden":            "Oculto",
  "set.font":              "Fuente",
  "set.font_size":         "Tamaño de fuente",
  "set.font_sm":           "S — Pequeño",
  "set.font_md":           "M — Mediano",
  "set.font_lg":           "L — Grande",
  "set.eval_defaults":     "Valores por defecto",
  "set.eval_defaults_sub": "Valores pre-rellenados al abrir una nueva evaluación",
  "set.default_sla":       "Incumplimiento SLA por defecto",
  "set.default_score":     "Puntuación por defecto",
  "set.no_prefill":        "Sin valor",
  "set.require_scores":    "Requerir todas las puntuaciones al guardar",
  "set.agents":            "Lista de agentes",
  "set.agents_sub":        "Nombres para autocompletar en el formulario",
  "set.agent_name_ph":     "Nombre completo del agente",
  "set.add_agent":         "Agregar",
  "set.no_agents":         "Sin agentes agregados.",
  "set.date_format":       "Formato de fecha",
  "set.date_iso":          "ISO (AAAA-MM-DD)",
  "set.date_dmy":          "Europeo (DD/MM/AAAA)",
  "set.date_mdy":          "EE.UU. (MM/DD/AAAA)",
  "set.compact_table":     "Filas de tabla compactas",
  "set.data_behavior":     "Comportamiento de datos",
  "set.confirm_delete":    "Pedir confirmación antes de eliminar un registro",

  "common.loading":    "Cargando…",
  "common.eval_label": "evaluaciones",
  "common.eval_label1":"evaluación",
  "common.cancel":     "Cancelar",
};

const LANG_FR = {
  // Navigation
  "nav.form":     "Formulaire",
  "nav.database": "Base de données",
  "nav.reports":  "Rapports",
  "nav.settings": "Paramètres",
  "nav.signout":  "Se déconnecter",
  "nav.guest":    "Accès invité",

  // Login
  "login.title":       "Bon retour",
  "login.subtitle":    "Connectez-vous pour continuer",
  "login.email":       "Adresse e-mail",
  "login.password":    "Mot de passe",
  "login.signin":      "Se connecter",
  "login.guest":       "Continuer en tant qu'invité",
  "login.secured":     "Sécurisé par Firebase Authentication",

  // Form page
  "form.title":        "Formulaire d'évaluation",
  "form.subtitle":     "Créer ou mettre à jour une évaluation d'agent",
  "form.paste":        "Coller ServiceNow",
  "form.open_sn":      "Ouvrir dans ServiceNow",
  "form.clear":        "Effacer",
  "form.save":         "Enregistrer l'évaluation",
  "form.saving":       "Enregistrement…",
  "form.load":         "Charger le ticket enregistré",
  "form.s1_title":     "Informations sur le ticket",
  "form.s1_sub":       "Détails principaux du ticket et de l'agent",
  "form.s2_title":     "Notes d'évaluation",
  "form.s2_sub":       "Cliquez sur un chiffre pour noter chaque critère (1 = Mauvais, 5 = Excellent)",
  "form.s3_title":     "Notes",
  "form.s3_sub":       "Contexte supplémentaire et évaluateur",
  "form.ticket":       "Numéro de ticket",
  "form.ticket_ph":    "INC0123456",
  "form.ticket_hint":  "Appuyez sur Entrée ou cliquez sur l'icône pour ouvrir dans ServiceNow",
  "form.agent":        "Nom de l'agent",
  "form.date":         "Date d'évaluation",
  "form.sla":          "Violation SLA",
  "form.sla_ok":       "✓ Dans les délais",
  "form.sla_breach":   "⚠ Dépassé",
  "form.lsa":          "LSA / Zone de support",
  "form.assigned":     "Technicien assigné",
  "form.evaluated_by": "Évalué par",
  "form.comments":     "Commentaires",
  "form.req_missing":  "champ obligatoire manquant",
  "form.req_missing_pl":"champs obligatoires manquants",
  "form.all_complete": "Tous les champs sont complets — prêt à enregistrer",
  "form.draft_restored": "Brouillon restauré",
  "form.dup_confirm": "Une évaluation existe déjà pour ce ticket. La remplacer ?",
  "form.conflict_confirm": "Cette évaluation a été modifiée ailleurs depuis son ouverture. Écraser ces changements ?",
  "form.of_fields":    "sur",
  "form.fields_filled":"champs remplis",

  // Criteria
  "crit.assetTracking":           "Suivi des actifs",
  "crit.assetTracking.hint":      "Enregistrement et suivi des actifs",
  "crit.planningCompliance":      "Conformité de la planification",
  "crit.planningCompliance.hint": "Respect du planning",
  "crit.kbCompliance":            "Conformité KB",
  "crit.kbCompliance.hint":       "Utilisation de la base de connaissances",
  "crit.teamSpirit":              "Esprit d'équipe",
  "crit.teamSpirit.hint":         "Collaboration et attitude",
  "crit.dressCode":               "Code vestimentaire",
  "crit.dressCode.hint":          "Apparence professionnelle",
  "crit.customerOriented":        "Orienté client",
  "crit.customerOriented.hint":   "Qualité de l'interaction avec le client",
  "crit.backlogManagement":       "Gestion du backlog",
  "crit.backlogManagement.hint":  "Traitement en temps voulu des tickets en attente",
  "crit.ticketQualityDoc":        "Documentation de la qualité du ticket",
  "crit.ticketQualityDoc.hint":   "Clarté et exhaustivité des notes du ticket",
  "sla.pick":           "Sélectionnez le LSA / SLA :",
  "sla.blocked_tag":    "bloqué",
  "sla.highest":        "% le plus élevé",
  "sla.reqlevel_note":  "ℹ️ Les RITM/REQ n'ont pas de SLA propre. Pour évaluer le SLA, ouvrez et évaluez le SCTASK associé.",
  "sla.blocked_toast":  "SLA bloqué par l'équipe",
  "sla.selected":       "LSA sélectionné",
  "sla.mgmt_title":     "Gestion des SLA",
  "sla.mgmt_sub":       "Collectés automatiquement lors des imports ServiceNow. Bloquez les SLA que l'équipe n'évalue pas (admins uniquement). Les SLA bloqués restent visibles mais ne peuvent pas être sélectionnés.",
  "sla.loading":        "Chargement…",
  "sla.empty":          "Aucun SLA pour l'instant — ils apparaissent ici automatiquement après l'import de tickets ServiceNow.",
  "sla.active":         "Actif",
  "sla.blocked":        "Bloqué",
  "sla.block":          "Bloquer",
  "sla.unblock":        "Débloquer",
  "sla.blocked_done":   "SLA bloqué.",
  "sla.unblocked_done": "SLA débloqué.",
  "sla.update_fail":    "Échec de la mise à jour du SLA.",
  "sla.manage_hint":    "Gérez les SLA affichés dans les Paramètres.",
  "sla.search_ph":      "Rechercher un SLA…",
  "sla.no_match":       "Aucun SLA ne correspond à la recherche.",
  "crit.custom_hint":             "Critère personnalisé",

  // Database page
  "db.title":         "Base de données",
  "db.subtitle":      "Toutes les évaluations enregistrées",
  "db.search_ph":     "Rechercher ticket, agent, LSA…",
  "db.export_json":   "Exporter JSON",
  "db.export_csv":    "Exporter CSV",
  "db.import_json":   "Importer JSON",
  "db.delete_all":    "Tout supprimer",
  "db.col_ticket":    "Ticket",
  "db.col_agent":     "Agent",
  "db.col_date":      "Date",
  "db.col_sla":       "SLA",
  "db.col_lsa":       "LSA",
  "db.col_score":     "Score",
  "db.col_evaluated": "Évalué par",
  "db.col_actions":   "Actions",
  "db.edit":          "Modifier",
  "db.open":          "Ouvrir",
  "db.delete":        "Supprimer",

  // Reports page
  "rep.title":        "Rapports",
  "rep.subtitle":     "Vue d'ensemble des performances",
  "rep.refresh":      "Actualiser",
  "rep.total":        "Total des évaluations",
  "rep.breaches":     "Violations SLA",
  "rep.avg":          "Score moyen",
  "rep.all_time":     "Historique",
  "rep.out_of_5":     "Sur 5.00",
  "rep.agent_perf":       "Performance par agent",
  "rep.trend_title":      "Tendance de la moyenne mensuelle",
  "rep.sorted_by":        "Trié par score moyen",
  "rep.export":           "Exporter",
  "rep.export_title":     "Exporter le rapport",
  "rep.export_format":    "Format",
  "rep.export_sections":  "Sections",
  "rep.section_summary":  "Statistiques résumées",
  "rep.section_agents":   "Performance par agent",
  "rep.section_records":  "Évaluations complètes",
  "rep.export_columns":   "Colonnes",
  "rep.export_download":  "Télécharger",
  "rep.filter_title":     "Filtres",
  "rep.filter_optional":  "optionnel",
  "rep.filter_from":      "Du",
  "rep.filter_to":        "Au",
  "rep.filter_sla":       "SLA",
  "rep.filter_all":       "Tous",
  "rep.filter_breached":  "Dépassements seulement",
  "rep.filter_within":    "Dans les délais",
  "rep.filter_agent":     "Agent",
  "rep.filter_agent_ph":  "Tous les agents",
  "rep.filter_score":     "Filtre de score",
  "rep.filter_any_crit":  "Tout critère",

  // Settings page
  "set.title":        "Paramètres",
  "set.subtitle":     "Préférences de l'application",
  "set.app":          "Application",
  "set.sn_url":       "URL de l'instance ServiceNow",
  "set.default_eval": "Évalué par défaut",
  "set.appearance":   "Apparence",
  "set.theme":        "Thème",
  "set.theme_light":  "Clair",
  "set.theme_dark":   "Sombre",
  "set.language":     "Langue",
  "set.account":      "Compte",
  "set.email":        "E-mail",
  "set.uid":          "Identifiant utilisateur",
  "set.login_email":  "E-mail de connexion par défaut",
  "set.reset_pwd":    "Envoyer un e-mail de réinitialisation",
  "set.save":         "Enregistrer les paramètres",
  "set.criteria":     "Critères de score",
  "set.criteria_sub": "Afficher ou masquer les critères dans le formulaire",
  "set.add_criterion":"Ajouter",
  "set.crit_name":    "Nom du critère",
  "set.crit_hint":    "Description courte (optionnel)",
  "set.no_custom":    "Aucun critère personnalisé. Ajoutez-en un ci-dessous.",
  "set.builtin":      "Prédéfini",
  "set.custom":       "Personnalisé",
  "set.remove":       "Supprimer",
  "set.visible":      "Visible",
  "set.hidden":            "Masqué",
  "set.font":              "Police",
  "set.font_size":         "Taille de police",
  "set.font_sm":           "S — Petite",
  "set.font_md":           "M — Moyenne",
  "set.font_lg":           "L — Grande",
  "set.eval_defaults":     "Valeurs par défaut",
  "set.eval_defaults_sub": "Valeurs pré-remplies à l'ouverture d'une évaluation",
  "set.default_sla":       "Violation SLA par défaut",
  "set.default_score":     "Note par défaut",
  "set.no_prefill":        "Pas de valeur",
  "set.require_scores":    "Exiger tous les scores avant d'enregistrer",
  "set.agents":            "Liste des agents",
  "set.agents_sub":        "Noms disponibles pour l'autocomplétion dans le formulaire",
  "set.agent_name_ph":     "Nom complet de l'agent",
  "set.add_agent":         "Ajouter",
  "set.no_agents":         "Aucun agent ajouté.",
  "set.date_format":       "Format de date",
  "set.date_iso":          "ISO (AAAA-MM-JJ)",
  "set.date_dmy":          "Européen (JJ/MM/AAAA)",
  "set.date_mdy":          "US (MM/JJ/AAAA)",
  "set.compact_table":     "Lignes de tableau compactes",
  "set.data_behavior":     "Comportement des données",
  "set.confirm_delete":    "Demander confirmation avant de supprimer un enregistrement",

  // Common
  "common.loading":    "Chargement…",
  "common.eval_label": "évaluations",
  "common.eval_label1":"évaluation",
  "common.cancel":     "Annuler",
};

const LANG_RO = {
  // Navigation
  "nav.form":     "Formular",
  "nav.database": "Bază de date",
  "nav.reports":  "Rapoarte",
  "nav.settings": "Setări",
  "nav.signout":  "Deconectare",
  "nav.guest":    "Acces invitat",

  // Login
  "login.title":       "Bun venit înapoi",
  "login.subtitle":    "Conectează-te la contul tău pentru a continua",
  "login.email":       "Adresă de e-mail",
  "login.password":    "Parolă",
  "login.signin":      "Conectare",
  "login.guest":       "Continuă ca invitat",
  "login.secured":     "Securizat de Firebase Authentication",

  // Form page
  "form.title":        "Formular de evaluare",
  "form.subtitle":     "Creați sau actualizați o evaluare de agent",
  "form.paste":        "Lipire ServiceNow",
  "form.open_sn":      "Deschide în ServiceNow",
  "form.clear":        "Șterge",
  "form.save":         "Salvează evaluarea",
  "form.saving":       "Se salvează…",
  "form.load":         "Încarcă ticket salvat",
  "form.s1_title":     "Informații despre ticket",
  "form.s1_sub":       "Detalii principale despre ticket și agent",
  "form.s2_title":     "Scoruri de evaluare",
  "form.s2_sub":       "Faceți clic pe un număr pentru a puncta fiecare criteriu (1 = Slab, 5 = Excelent)",
  "form.s3_title":     "Note",
  "form.s3_sub":       "Context suplimentar și evaluator",
  "form.ticket":       "Număr de ticket",
  "form.ticket_ph":    "INC0123456",
  "form.ticket_hint":  "Apăsați Enter sau faceți clic pe iconiță pentru a deschide în ServiceNow",
  "form.agent":        "Numele agentului",
  "form.date":         "Data evaluării",
  "form.sla":          "Breșă SLA",
  "form.sla_ok":       "✓ În termen",
  "form.sla_breach":   "⚠ Depășit",
  "form.lsa":          "LSA / Zona de suport",
  "form.assigned":     "Tehnician alocat",
  "form.evaluated_by": "Evaluat de",
  "form.comments":     "Comentarii",
  "form.req_missing":  "câmp obligatoriu lipsă",
  "form.req_missing_pl":"câmpuri obligatorii lipsă",
  "form.all_complete": "Toate câmpurile sunt completate — gata de salvare",
  "form.draft_restored": "Schiță restaurată",
  "form.dup_confirm": "Există deja o evaluare pentru acest tichet. Suprascrii?",
  "form.conflict_confirm": "Această evaluare a fost modificată în altă parte de când ai deschis-o. Suprascrii acele modificări?",
  "form.of_fields":    "din",
  "form.fields_filled":"câmpuri completate",

  // Criteria
  "crit.assetTracking":           "Urmărire active",
  "crit.assetTracking.hint":      "Înregistrarea și urmărirea activelor",
  "crit.planningCompliance":      "Conformitate planificare",
  "crit.planningCompliance.hint": "Respectarea programului",
  "crit.kbCompliance":            "Conformitate KB",
  "crit.kbCompliance.hint":       "Utilizarea bazei de cunoștințe",
  "crit.teamSpirit":              "Spirit de echipă",
  "crit.teamSpirit.hint":         "Colaborare și atitudine",
  "crit.dressCode":               "Cod vestimentar",
  "crit.dressCode.hint":          "Aspect profesional",
  "crit.customerOriented":        "Orientat spre client",
  "crit.customerOriented.hint":   "Calitatea interacțiunii cu clientul",
  "crit.backlogManagement":       "Gestionarea backlogului",
  "crit.backlogManagement.hint":  "Tratarea la timp a tichetelor în așteptare",
  "crit.ticketQualityDoc":        "Documentarea calității tichetului",
  "crit.ticketQualityDoc.hint":   "Claritatea și completitudinea notelor tichetului",
  "sla.pick":           "Selectează LSA / SLA:",
  "sla.blocked_tag":    "blocat",
  "sla.highest":        "% maxim",
  "sla.reqlevel_note":  "ℹ️ Tichetele RITM/REQ nu au SLA propriu. Pentru a evalua SLA, deschide și evaluează SCTASK-ul asociat.",
  "sla.blocked_toast":  "SLA blocat de echipă",
  "sla.selected":       "LSA selectat",
  "sla.mgmt_title":     "Gestionare SLA",
  "sla.mgmt_sub":       "Colectate automat din importurile ServiceNow. Blochează SLA-urile pe care echipa nu le evaluează (doar administratori). Cele blocate rămân vizibile dar nu pot fi selectate.",
  "sla.loading":        "Se încarcă…",
  "sla.empty":          "Încă nu există SLA-uri — apar aici automat după ce imporți tichete din ServiceNow.",
  "sla.active":         "Activ",
  "sla.blocked":        "Blocat",
  "sla.block":          "Blochează",
  "sla.unblock":        "Deblochează",
  "sla.blocked_done":   "SLA blocat.",
  "sla.unblocked_done": "SLA deblocat.",
  "sla.update_fail":    "Actualizarea SLA a eșuat.",
  "sla.manage_hint":    "Gestionează ce SLA-uri apar în Setări.",
  "sla.search_ph":      "Caută SLA…",
  "sla.no_match":       "Niciun SLA nu corespunde căutării.",
  "crit.custom_hint":             "Criteriu personalizat",

  // Database page
  "db.title":         "Bază de date",
  "db.subtitle":      "Toate evaluările salvate",
  "db.search_ph":     "Caută ticket, agent, LSA…",
  "db.export_json":   "Exportă JSON",
  "db.export_csv":    "Exportă CSV",
  "db.import_json":   "Importă JSON",
  "db.delete_all":    "Șterge tot",
  "db.col_ticket":    "Ticket",
  "db.col_agent":     "Agent",
  "db.col_date":      "Dată",
  "db.col_sla":       "SLA",
  "db.col_lsa":       "LSA",
  "db.col_score":     "Scor",
  "db.col_evaluated": "Evaluat de",
  "db.col_actions":   "Acțiuni",
  "db.edit":          "Editează",
  "db.open":          "Deschide",
  "db.delete":        "Șterge",

  // Reports page
  "rep.title":        "Rapoarte",
  "rep.subtitle":     "Prezentare generală a performanței",
  "rep.refresh":      "Actualizează",
  "rep.total":        "Total evaluări",
  "rep.breaches":     "Breșe SLA",
  "rep.avg":          "Scor mediu",
  "rep.all_time":     "Toate timpurile",
  "rep.out_of_5":     "Din 5.00",
  "rep.agent_perf":       "Performanță agenți",
  "rep.trend_title":      "Tendința mediei lunare",
  "rep.sorted_by":        "Sortat după scor mediu",
  "rep.export":           "Exportă",
  "rep.export_title":     "Exportă raport",
  "rep.export_format":    "Format",
  "rep.export_sections":  "Secțiuni",
  "rep.section_summary":  "Statistici sumar",
  "rep.section_agents":   "Performanță agenți",
  "rep.section_records":  "Evaluări complete",
  "rep.export_columns":   "Coloane",
  "rep.export_download":  "Descarcă",
  "rep.filter_title":     "Filtre",
  "rep.filter_optional":  "opțional",
  "rep.filter_from":      "De la",
  "rep.filter_to":        "Până la",
  "rep.filter_sla":       "SLA",
  "rep.filter_all":       "Toate",
  "rep.filter_breached":  "Numai depășite",
  "rep.filter_within":    "În termen",
  "rep.filter_agent":     "Agent",
  "rep.filter_agent_ph":  "Toți agenții",
  "rep.filter_score":     "Filtru scor",
  "rep.filter_any_crit":  "Orice criteriu",

  // Settings page
  "set.title":        "Setări",
  "set.subtitle":     "Preferințe aplicație",
  "set.app":          "Aplicație",
  "set.sn_url":       "URL instanță ServiceNow",
  "set.default_eval": "Evaluat implicit de",
  "set.appearance":   "Aspect",
  "set.theme":        "Temă",
  "set.theme_light":  "Deschis",
  "set.theme_dark":   "Întunecat",
  "set.language":     "Limbă",
  "set.account":      "Cont",
  "set.email":        "E-mail",
  "set.uid":          "ID utilizator",
  "set.login_email":  "E-mail de conectare implicit",
  "set.reset_pwd":    "Trimite e-mail de resetare",
  "set.save":         "Salvează setările",
  "set.criteria":     "Criterii de scor",
  "set.criteria_sub": "Afișează sau ascunde criterii în formular",
  "set.add_criterion":"Adaugă",
  "set.crit_name":    "Numele criteriului",
  "set.crit_hint":    "Descriere scurtă (opțional)",
  "set.no_custom":    "Niciun criteriu personalizat. Adăugați unul mai jos.",
  "set.builtin":      "Predefinit",
  "set.custom":       "Personalizat",
  "set.remove":       "Elimină",
  "set.visible":      "Vizibil",
  "set.hidden":            "Ascuns",
  "set.font":              "Font",
  "set.font_size":         "Dimensiune font",
  "set.font_sm":           "S — Mic",
  "set.font_md":           "M — Mediu",
  "set.font_lg":           "L — Mare",
  "set.eval_defaults":     "Valori implicite",
  "set.eval_defaults_sub": "Valori pre-completate la deschiderea unei evaluări",
  "set.default_sla":       "Breșă SLA implicită",
  "set.default_score":     "Scor implicit",
  "set.no_prefill":        "Fără valoare",
  "set.require_scores":    "Solicită toate scorurile înainte de salvare",
  "set.agents":            "Lista agenților",
  "set.agents_sub":        "Nume disponibile pentru completare automată",
  "set.agent_name_ph":     "Numele complet al agentului",
  "set.add_agent":         "Adăugați",
  "set.no_agents":         "Niciun agent adăugat.",
  "set.date_format":       "Format dată",
  "set.date_iso":          "ISO (AAAA-LL-ZZ)",
  "set.date_dmy":          "European (ZZ/LL/AAAA)",
  "set.date_mdy":          "SUA (LL/ZZ/AAAA)",
  "set.compact_table":     "Rânduri de tabel compacte",
  "set.data_behavior":     "Comportament date",
  "set.confirm_delete":    "Cereți confirmare înainte de ștergerea unui înregistrări",

  // Common
  "common.loading":    "Se încarcă…",
  "common.eval_label": "evaluări",
  "common.eval_label1":"evaluare",
  "common.cancel":     "Anulează",
};

const LANG_NL = {
  // Navigation
  "nav.form":     "Formulier",
  "nav.database": "Database",
  "nav.reports":  "Rapporten",
  "nav.settings": "Instellingen",
  "nav.signout":  "Uitloggen",
  "nav.guest":    "Gasttoegang",

  // Login
  "login.title":       "Welkom terug",
  "login.subtitle":    "Meld je aan om door te gaan",
  "login.email":       "E-mailadres",
  "login.password":    "Wachtwoord",
  "login.signin":      "Aanmelden",
  "login.guest":       "Doorgaan als gast",
  "login.secured":     "Beveiligd door Firebase Authentication",

  // Form page
  "form.title":        "Evaluatieformulier",
  "form.subtitle":     "Maak of update een agentbeoordeling",
  "form.paste":        "Plak ServiceNow",
  "form.open_sn":      "Openen in ServiceNow",
  "form.clear":        "Wissen",
  "form.save":         "Evaluatie opslaan",
  "form.saving":       "Opslaan…",
  "form.load":         "Opgeslagen ticket laden",
  "form.s1_title":     "Ticketinformatie",
  "form.s1_sub":       "Hoofdgegevens van het ticket en de agent",
  "form.s2_title":     "Evaluatiescores",
  "form.s2_sub":       "Klik op een cijfer om elk criterium te scoren (1 = Slecht, 5 = Uitstekend)",
  "form.s3_title":     "Notities",
  "form.s3_sub":       "Extra context en beoordelaar",
  "form.ticket":       "Ticketnummer",
  "form.ticket_ph":    "INC0123456",
  "form.ticket_hint":  "Druk op Enter of klik het icoon om in ServiceNow te openen",
  "form.agent":        "Naam agent",
  "form.date":         "Evaluatiedatum",
  "form.sla":          "SLA-overtreding",
  "form.sla_ok":       "✓ Binnen SLA",
  "form.sla_breach":   "⚠ Overschreden",
  "form.lsa":          "LSA / Supportgebied",
  "form.assigned":     "Toegewezen technicus",
  "form.evaluated_by": "Beoordeeld door",
  "form.comments":     "Opmerkingen",
  "form.req_missing":  "verplicht veld ontbreekt",
  "form.req_missing_pl":"verplichte velden ontbreken",
  "form.all_complete": "Alle velden ingevuld — klaar om op te slaan",
  "form.draft_restored": "Concept hersteld",
  "form.dup_confirm": "Er bestaat al een evaluatie voor dit ticket. Overschrijven?",
  "form.conflict_confirm": "Deze evaluatie is elders gewijzigd sinds je hem opende. Die wijzigingen overschrijven?",
  "form.of_fields":    "van",
  "form.fields_filled":"velden ingevuld",

  // Criteria
  "crit.assetTracking":           "Activabeheer",
  "crit.assetTracking.hint":      "Registratie en tracking van activa",
  "crit.planningCompliance":      "Planning naleving",
  "crit.planningCompliance.hint": "Naleving van het schema",
  "crit.kbCompliance":            "KB-naleving",
  "crit.kbCompliance.hint":       "Gebruik van kennisbank",
  "crit.teamSpirit":              "Teamgeest",
  "crit.teamSpirit.hint":         "Samenwerking en houding",
  "crit.dressCode":               "Kledingcode",
  "crit.dressCode.hint":          "Professioneel uiterlijk",
  "crit.customerOriented":        "Klantgericht",
  "crit.customerOriented.hint":   "Kwaliteit van klantinteractie",
  "crit.backlogManagement":       "Backlogbeheer",
  "crit.backlogManagement.hint":  "Tijdige afhandeling van openstaande tickets",
  "crit.ticketQualityDoc":        "Documentatie ticketkwaliteit",
  "crit.ticketQualityDoc.hint":   "Duidelijkheid en volledigheid van ticketnotities",
  "sla.pick":           "Selecteer de LSA / SLA:",
  "sla.blocked_tag":    "geblokkeerd",
  "sla.highest":        "hoogste %",
  "sla.reqlevel_note":  "ℹ️ RITM/REQ-tickets hebben geen eigen SLA. Open en evalueer de bijbehorende SCTASK om de SLA te beoordelen.",
  "sla.blocked_toast":  "SLA geblokkeerd door het team",
  "sla.selected":       "LSA geselecteerd",
  "sla.mgmt_title":     "SLA-beheer",
  "sla.mgmt_sub":       "Automatisch verzameld uit ServiceNow-imports. Blokkeer de SLA's die het team niet evalueert (alleen beheerders). Geblokkeerde SLA's blijven zichtbaar maar kunnen niet worden geselecteerd.",
  "sla.loading":        "Laden…",
  "sla.empty":          "Nog geen SLA's — ze verschijnen hier automatisch nadat je tickets uit ServiceNow importeert.",
  "sla.active":         "Actief",
  "sla.blocked":        "Geblokkeerd",
  "sla.block":          "Blokkeren",
  "sla.unblock":        "Deblokkeren",
  "sla.blocked_done":   "SLA geblokkeerd.",
  "sla.unblocked_done": "SLA gedeblokkeerd.",
  "sla.update_fail":    "Kon SLA niet bijwerken.",
  "sla.manage_hint":    "Beheer welke SLA's verschijnen in Instellingen.",
  "sla.search_ph":      "SLA zoeken…",
  "sla.no_match":       "Geen SLA's komen overeen met je zoekopdracht.",
  "crit.custom_hint":             "Aangepast criterium",

  // Database page
  "db.title":         "Database",
  "db.subtitle":      "Alle opgeslagen evaluaties",
  "db.search_ph":     "Zoek ticket, agent, LSA…",
  "db.export_json":   "Exporteer JSON",
  "db.export_csv":    "Exporteer CSV",
  "db.import_json":   "Importeer JSON",
  "db.delete_all":    "Alles verwijderen",
  "db.col_ticket":    "Ticket",
  "db.col_agent":     "Agent",
  "db.col_date":      "Datum",
  "db.col_sla":       "SLA",
  "db.col_lsa":       "LSA",
  "db.col_score":     "Score",
  "db.col_evaluated": "Beoordeeld door",
  "db.col_actions":   "Acties",
  "db.edit":          "Bewerken",
  "db.open":          "Openen",
  "db.delete":        "Verwijderen",

  // Reports page
  "rep.title":        "Rapporten",
  "rep.subtitle":     "Prestatie-overzicht",
  "rep.refresh":      "Vernieuwen",
  "rep.total":        "Totaal evaluaties",
  "rep.breaches":     "SLA-overtredingen",
  "rep.avg":          "Gemiddelde score",
  "rep.all_time":     "Altijd",
  "rep.out_of_5":     "Van 5.00",
  "rep.agent_perf":       "Agentprestaties",
  "rep.trend_title":      "Maandelijkse gemiddelde trend",
  "rep.sorted_by":        "Gesorteerd op gemiddelde score",
  "rep.export":           "Exporteren",
  "rep.export_title":     "Rapport exporteren",
  "rep.export_format":    "Formaat",
  "rep.export_sections":  "Secties",
  "rep.section_summary":  "Samenvattende statistieken",
  "rep.section_agents":   "Agentprestaties",
  "rep.section_records":  "Volledige evaluaties",
  "rep.export_columns":   "Kolommen",
  "rep.export_download":  "Downloaden",
  "rep.filter_title":     "Filters",
  "rep.filter_optional":  "optioneel",
  "rep.filter_from":      "Van datum",
  "rep.filter_to":        "Tot datum",
  "rep.filter_sla":       "SLA",
  "rep.filter_all":       "Alle",
  "rep.filter_breached":  "Alleen overtredingen",
  "rep.filter_within":    "Binnen SLA",
  "rep.filter_agent":     "Agent",
  "rep.filter_agent_ph":  "Alle agenten",
  "rep.filter_score":     "Scorefilter",
  "rep.filter_any_crit":  "Elk criterium",

  // Settings page
  "set.title":        "Instellingen",
  "set.subtitle":     "Toepassingsvoorkeuren",
  "set.app":          "Applicatie",
  "set.sn_url":       "ServiceNow instantie-URL",
  "set.default_eval": "Standaard beoordeeld door",
  "set.appearance":   "Uiterlijk",
  "set.theme":        "Thema",
  "set.theme_light":  "Licht",
  "set.theme_dark":   "Donker",
  "set.language":     "Taal",
  "set.account":      "Account",
  "set.email":        "E-mail",
  "set.uid":          "Gebruikers-ID",
  "set.login_email":  "Standaard inlog-e-mail",
  "set.reset_pwd":    "Stuur wachtwoord reset e-mail",
  "set.save":         "Instellingen opslaan",
  "set.criteria":     "Scorecriteria",
  "set.criteria_sub": "Criteria in het formulier tonen of verbergen",
  "set.add_criterion":"Toevoegen",
  "set.crit_name":    "Criteriumnaam",
  "set.crit_hint":    "Korte beschrijving (optioneel)",
  "set.no_custom":    "Geen aangepaste criteria. Voeg er hieronder een toe.",
  "set.builtin":      "Ingebouwd",
  "set.custom":       "Aangepast",
  "set.remove":       "Verwijderen",
  "set.visible":      "Zichtbaar",
  "set.hidden":            "Verborgen",
  "set.font":              "Lettertype",
  "set.font_size":         "Lettergrootte",
  "set.font_sm":           "S — Klein",
  "set.font_md":           "M — Middel",
  "set.font_lg":           "L — Groot",
  "set.eval_defaults":     "Standaardwaarden",
  "set.eval_defaults_sub": "Vooraf ingevulde waarden bij een nieuwe evaluatie",
  "set.default_sla":       "Standaard SLA-overtreding",
  "set.default_score":     "Standaardscore",
  "set.no_prefill":        "Geen waarde",
  "set.require_scores":    "Alle scores vereist bij opslaan",
  "set.agents":            "Agentenlijst",
  "set.agents_sub":        "Namen beschikbaar voor automatisch aanvullen in het formulier",
  "set.agent_name_ph":     "Volledige naam agent",
  "set.add_agent":         "Toevoegen",
  "set.no_agents":         "Nog geen agenten toegevoegd.",
  "set.date_format":       "Datumnotatie",
  "set.date_iso":          "ISO (JJJJ-MM-DD)",
  "set.date_dmy":          "Europees (DD/MM/JJJJ)",
  "set.date_mdy":          "VS (MM/DD/JJJJ)",
  "set.compact_table":     "Compacte tabelrijen",
  "set.data_behavior":     "Gegevensgedrag",
  "set.confirm_delete":    "Bevestiging vragen voor het verwijderen van een record",

  // Common
  "common.loading":    "Laden…",
  "common.eval_label": "evaluaties",
  "common.eval_label1":"evaluatie",
  "common.cancel":     "Annuleren",
};

// Language registry — add new language objects here
const TRANSLATIONS_MAP = {
  en: LANG_EN,
  es: LANG_ES,
  fr: LANG_FR,
  ro: LANG_RO,
  nl: LANG_NL,
};

function getLang() {
  try {
    return JSON.parse(localStorage.getItem("agentEvaluationSettingsV1") || "{}").language || "en";
  } catch { return "en"; }
}

function t(key) {
  const lang = getLang();
  const dict = TRANSLATIONS_MAP[lang] || TRANSLATIONS_MAP.en;
  return dict[key] ?? TRANSLATIONS_MAP.en[key] ?? key;
}

function applyI18n() {
  document.querySelectorAll("[data-i18n]").forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-ph]").forEach(el => {
    el.placeholder = t(el.dataset.i18nPh);
  });
  document.querySelectorAll("[data-i18n-aria]").forEach(el => {
    el.setAttribute("aria-label", t(el.dataset.i18nAria));
  });
  // Update html lang attribute
  document.documentElement.lang = getLang();
}

// Apply on DOM ready (runs before appReady)
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", applyI18n);
} else {
  applyI18n();
}

const ICONS = {
  success: "✅",
  error:   "❌",
  warning: "⚠️",
  info:    "ℹ️",
};

function getToastContainer() {
  let c = document.getElementById("toastContainer");
  if (!c) {
    c = document.createElement("div");
    c.id = "toastContainer";
    document.body.appendChild(c);
  }
  return c;
}

function _esc(s) {
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function toast(message, type = "success", duration = 3500) {
  const container = getToastContainer();

  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.innerHTML = `
    <span class="toast-icon">${ICONS[type] || ICONS.info}</span>
    <div class="toast-body">
      <div class="toast-title">${capitalize(type)}</div>
      <div class="toast-msg">${_esc(message)}</div>
    </div>
    <button class="toast-close" type="button" aria-label="Dismiss toast">×</button>
  `;
  el.querySelector(".toast-close").addEventListener("click", e => dismissToast(e.currentTarget));

  container.appendChild(el);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => el.classList.add("show"));
  });

  const timer = setTimeout(() => dismissToast(el.querySelector(".toast-close")), duration);
  el._timer = timer;
}

function dismissToast(closeBtn) {
  const el = closeBtn.closest(".toast");
  if (!el) return;
  clearTimeout(el._timer);
  el.classList.remove("show");
  setTimeout(() => el.remove(), 300);
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Legacy shim — most logic moved to src/core/* and src/utils/*
// What remains here: today() utility
// formatDisplayDate is in src/utils/strings.js
// All other functions are in their respective modules.

function today() {
  return new Date().toISOString().slice(0, 10);
}

// ── Email Link (invite) sign-in ───────────────────────────────────────────────
(async () => {
  if (!window.auth.isSignInWithEmailLink(window.location.href)) return;

  // Hide normal login UI — show the email-confirm panel instead
  document.getElementById("loginForm").hidden     = true;
  document.getElementById("guestBtn").hidden      = true;
  document.querySelector(".login-divider").hidden = true;
  document.getElementById("emailConfirmPanel").hidden = false;

  document.getElementById("emailConfirmBtn").addEventListener("click", async () => {
    const email = document.getElementById("confirmEmail").value.trim();
    const errEl = document.getElementById("emailConfirmError");
    errEl.hidden = true;

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errEl.textContent = "Please enter a valid email address.";
      errEl.hidden = false;
      return;
    }

    const btn = document.getElementById("emailConfirmBtn");
    btn.disabled = true;
    btn.textContent = "Verifying…";

    try {
      await window.auth.signInWithEmailLink(email, window.location.href);
      history.replaceState(null, "", window.location.pathname);
      // onAuthStateChanged fires next — set-password check happens there
    } catch (_) {
      errEl.textContent = "Invitation link is invalid or expired. Please contact an admin.";
      errEl.hidden = false;
      btn.disabled = false;
      btn.textContent = "Continue";
    }
  });
})();

// Already signed in — check session expiry first
window.auth.onAuthStateChanged(async user => {
  if (!user) return;
  const expiry = parseInt(localStorage.getItem("sessionExpiresAt") || "0", 10);
  if (expiry && Date.now() > expiry) {
    window.auth.signOut();
    return;
  }

  if (user.email) {
    try {
      const key  = user.email.toLowerCase().replace(/[@.]/g, "_");
      const snap = await window.db.collection("roles").doc(key).get();
      if (snap.exists && snap.data().mustSetPassword) {
        showSetPasswordModal(user);
        return;
      }
    } catch (_) { /* proceed normally if check fails */ }
  }

  window.location.href = "form.html";
});

function setLoading(on) {
  const btn = document.getElementById("loginBtn");
  btn.disabled = on;
  btn.innerHTML = on
    ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin .7s linear infinite"><path d="M21 12a9 9 0 11-6.219-8.56"/></svg> Signing in…`
    : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4M10 17l5-5-5-5M15 12H3"/></svg> Sign In`;
}

function showError(msg) {
  const el  = document.getElementById("loginError");
  const txt = document.getElementById("loginErrorMsg");
  txt.textContent = msg;
  el.classList.add("visible");
}

function clearError() {
  document.getElementById("loginError").classList.remove("visible");
}

function getAuthDiagnostics() {
  const cfg = window.firebaseConfig || window.auth?.app?.options || {};
  const host = window.location.hostname;
  const isGithubPages = host.endsWith(".github.io");
  const projectId = cfg.projectId || "";
  const authDomain = cfg.authDomain || "";
  return {
    host,
    projectId,
    authDomain,
    expectedProject: "agentapp-8ea1c",
    expectedAuthDomain: "agentapp-8ea1c.firebaseapp.com",
    matchesProject: projectId === "agentapp-8ea1c",
    matchesAuthDomain: authDomain === "agentapp-8ea1c.firebaseapp.com",
    githubPagesHost: isGithubPages ? host : null,
    userAgent: navigator.userAgent,
  };
}

function buildAuthError(err) {
  const code = err?.code || "";
  const message = err?.message || "";
  const diag = getAuthDiagnostics();
  const base = {
    "auth/user-not-found":        "No account found with this email.",
    "auth/wrong-password":        "Incorrect password.",
    "auth/invalid-credential":    "Incorrect email or password.",
    "auth/invalid-email":         "Invalid email address.",
    "auth/too-many-requests":     "Too many attempts. Try again later.",
    "auth/operation-not-allowed": "Email/password sign-in is disabled in Firebase Authentication.",
    "auth/unauthorized-domain":   `This domain is not authorized in Firebase Authentication: ${diag.host}.`,
    "auth/invalid-api-key":       "Firebase is not configured correctly for this site.",
    "auth/network-request-failed":"Network error while contacting Firebase.",
    "auth/internal-error":        "Firebase returned an internal error while signing in.",
    "auth/configuration-not-found":"Firebase Authentication is not configured for this project.",
  };

  if (code === "auth/invalid-credential" && (message.includes("API key") || message.includes("apiKey"))) {
    return "Firebase API key does not match the current project.";
  }
  return base[code] || `Authentication failed: ${message || code || "unknown error"}.`;
}

function showAuthDebug(err) {
  const diag = getAuthDiagnostics();
  const lines = [
    `Firebase auth error: ${err?.message || err?.code || "unknown"}`,
    `code: ${err?.code || "n/a"}`,
    `projectId: ${diag.projectId} | authDomain: ${diag.authDomain} | host: ${diag.host}`,
  ];
  console.warn(lines.join(" | "));
}

// ── Session duration (applied silently from Settings preference) ──────────────
const SESSION_OPTS = [
  { key: "1d",  ms: 1  * 24 * 60 * 60 * 1000 },
  { key: "7d",  ms: 7  * 24 * 60 * 60 * 1000 },
  { key: "30d", ms: 30 * 24 * 60 * 60 * 1000 },
];

function applySessionAndRedirect(url) {
  const saved  = JSON.parse(localStorage.getItem("agentEvaluationSettingsV1") || "{}");
  const key    = saved.sessionDuration || "7d";
  const opt    = SESSION_OPTS.find(o => o.key === key) || SESSION_OPTS[1];
  localStorage.setItem("sessionExpiresAt", String(Date.now() + opt.ms));
  window.location.href = url;
}

// ── Set-password modal (first login) ─────────────────────────────────────────

function showSetPasswordModal(user) {
  document.getElementById("loginForm").hidden        = true;
  document.getElementById("recoveryPanel").hidden    = true;
  document.getElementById("setPasswordPanel").hidden = false;
}

// Returns true when the user's role doc still has the mustSetPassword flag set.
async function mustSetPasswordFor(user) {
  if (!user || !user.email) return false;
  try {
    const key  = user.email.toLowerCase().replace(/[@.]/g, "_");
    const snap = await window.db.collection("roles").doc(key).get();
    return snap.exists && snap.data().mustSetPassword === true;
  } catch {
    return false;
  }
}

document.getElementById("setPasswordBtn")?.addEventListener("click", async () => {
  const pw1 = document.getElementById("setPass1").value;
  const pw2 = document.getElementById("setPass2").value;
  const err = document.getElementById("setPassError");

  err.hidden = true;
  if (pw1.length < 8) { err.textContent = "Password must be at least 8 characters."; err.hidden = false; return; }
  if (pw1 !== pw2)    { err.textContent = "Passwords do not match.";                 err.hidden = false; return; }

  const btn = document.getElementById("setPasswordBtn");
  btn.disabled = true;
  btn.textContent = "Saving…";

  try {
    const user = window.auth.currentUser;
    await user.updatePassword(pw1);

    // Clear the flag — Firestore rules allow only this specific field update on own doc
    const key = user.email.toLowerCase().replace(/[@.]/g, "_");
    await window.db.collection("roles").doc(key).update({ mustSetPassword: false });

    applySessionAndRedirect("form.html");
  } catch (e) {
    err.textContent = e.message || "Failed to set password.";
    err.hidden = false;
    btn.disabled = false;
    btn.textContent = "Set Password";
  }
});

document.getElementById("loginForm").addEventListener("submit", async e => {
  e.preventDefault();
  const email = document.getElementById("loginEmail").value.trim().toLowerCase();
  const pass  = document.getElementById("loginPass").value;
  if (!email || !pass) { showError("Please enter your email and password."); return; }
  clearError();
  setLoading(true);
  try {
    const cred = await window.auth.signInWithEmailAndPassword(email, pass);
    setLoading(false);
    // First sign-in with an admin-issued temp password: force a password change.
    if (await mustSetPasswordFor(cred.user)) {
      showSetPasswordModal(cred.user);
      return;
    }
    applySessionAndRedirect("form.html");
  } catch (err) {
    showAuthDebug(err);
    showError(`${buildAuthError(err)}${err?.message ? `\n${err.message}` : ""}`.trim());
    setLoading(false);
  }
});

document.getElementById("guestBtn").addEventListener("click", () => {
  sessionStorage.setItem("guestSession", "1");
  window.location.href = "form.html";
});

["loginEmail", "loginPass"].forEach(id =>
  document.getElementById(id).addEventListener("input", clearError)
);

// ── Password show/hide toggle ─────────────────────────────────────────────────
document.getElementById("passToggle").addEventListener("click", () => {
  const input = document.getElementById("loginPass");
  const icon  = document.getElementById("passEyeIcon");
  const show  = input.type === "password";
  input.type  = show ? "text" : "password";
  icon.innerHTML = show
    ? `<path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>`
    : `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>`;
});

// ── Password recovery ─────────────────────────────────────────────────────────
document.getElementById("forgotLink").addEventListener("click", e => {
  e.preventDefault();
  document.getElementById("loginForm").hidden = true;
  document.getElementById("recoveryPanel").hidden = false;
  const email = document.getElementById("loginEmail").value.trim();
  if (email) document.getElementById("recoveryEmail").value = email;
  document.getElementById("recoveryEmail").focus();
});

document.getElementById("backToLogin").addEventListener("click", e => {
  e.preventDefault();
  document.getElementById("recoveryPanel").hidden = true;
  document.getElementById("recoverySuccess").hidden = true;
  document.getElementById("loginForm").hidden = false;
});

document.getElementById("recoveryBtn").addEventListener("click", async () => {
  const email = document.getElementById("recoveryEmail").value.trim();
  if (!email) { document.getElementById("recoveryEmail").focus(); return; }

  const btn = document.getElementById("recoveryBtn");
  btn.disabled = true;
  btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin .7s linear infinite"><path d="M21 12a9 9 0 11-6.219-8.56"/></svg> Sending…`;

  try {
    await window.auth.sendPasswordResetEmail(email);
  } catch (_) {
    // Silently ignore — always show success to prevent user enumeration
  }

  btn.disabled = false;
  btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> Send reset link`;
  document.getElementById("recoveryEmail").value = "";
  document.getElementById("recoverySuccess").hidden = false;
});
