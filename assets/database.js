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

// Central error logger. Keeps the last 50 errors in memory and mirrors to the
// console, so failures that were previously swallowed in catch {} are visible.
// Load early (after firebase.js, before the data modules).

const _errorLog = [];

function logError(context, err) {
  const entry = {
    context,
    message: (err && err.message) ? err.message : String(err),
    code: err && err.code ? err.code : null,
    at: new Date().toISOString(),
  };
  _errorLog.push(entry);
  if (_errorLog.length > 50) _errorLog.shift();
  // eslint-disable-next-line no-console
  console.error(`[${context}]`, err);
  return entry;
}

function getErrorLog() {
  return _errorLog.slice();
}

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

// ServiceNow integration helpers
// Depends on: appSettings.js (getSettings, SEARCH_HISTORY_KEY globals)

function saveSearchHistory(ticket) {
  if (!ticket) return;
  let h = JSON.parse(localStorage.getItem(SEARCH_HISTORY_KEY) || "[]");
  h = h.filter(x => x.ticket !== ticket);
  h.unshift({ ticket, searchedAt: new Date().toISOString() });
  localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(h.slice(0, 50)));
}

function getSafeInstance() {
  const raw = getSettings().serviceNowInstance || "europarl.service-now.com";
  return /^[a-zA-Z0-9.-]+$/.test(raw.trim()) ? raw.trim() : "europarl.service-now.com";
}

function openServiceNow(ticket) {
  if (!ticket) return;
  const instance = getSafeInstance();

  const tableMap  = { INC: "incident", RITM: "sc_req_item", REQ: "sc_request", SCTASK: "sc_task" };
  const table     = Object.entries(tableMap).find(([k]) => ticket.startsWith(k))?.[1] ?? "task";
  const query     = `${table}.do?sysparm_query=number=${encodeURIComponent(ticket)}`;
  saveSearchHistory(ticket);
  window.open(`https://${instance}/nav_to.do?uri=${encodeURIComponent(query)}`, "_blank");
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

// ── Generic Modal Utility ─────────────────────────────────────────────────────
// Provides reusable modal creation functions. Loaded on all pages.
// No import/export — all functions are plain globals.

/**
 * showModal({ title, body, actions })
 * Creates and appends a modal overlay to document.body.
 *
 * @param {object} opts
 * @param {string} opts.title   - Modal header title text
 * @param {string|Node} opts.body    - HTML string or DOM node for modal body
 * @param {Array<{label:string, class:string, onClick:function}>} opts.actions
 *   - Array of button definitions for the modal footer
 * @returns {HTMLElement} The created modal overlay element
 */
function showModal({ title, body, actions = [] }) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");

  const bodyHtml = typeof body === "string"
    ? body
    : "";

  const actionsHtml = actions.map((a, i) =>
    `<button class="btn ${a.class || "btn-secondary"}" data-modal-action="${i}">${escapeHtml(a.label)}</button>`
  ).join("");

  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h3>${escapeHtml(title)}</h3>
        <button class="btn btn-ghost btn-icon" data-modal-close aria-label="Close">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      </div>
      <div class="modal-body"></div>
      ${actionsHtml.length ? `<div class="modal-footer">${actionsHtml}</div>` : ""}
    </div>
  `;

  // Inject body node or HTML
  const modalBody = overlay.querySelector(".modal-body");
  if (typeof body === "string") {
    modalBody.innerHTML = body;
  } else if (body instanceof Node) {
    modalBody.appendChild(body);
  }

  // Wire close button
  overlay.querySelector("[data-modal-close]").addEventListener("click", () => closeModal(overlay));

  // Wire action buttons
  actions.forEach((a, i) => {
    const btn = overlay.querySelector(`[data-modal-action="${i}"]`);
    if (btn && typeof a.onClick === "function") {
      btn.addEventListener("click", () => a.onClick(overlay));
    }
  });

  // Click outside to close
  overlay.addEventListener("click", e => {
    if (e.target === overlay) closeModal(overlay);
  });

  // Escape key to close
  const onKeydown = e => {
    if (e.key === "Escape") {
      closeModal(overlay);
      document.removeEventListener("keydown", onKeydown);
    }
  };
  document.addEventListener("keydown", onKeydown);

  document.body.style.overflow = "hidden";
  document.body.appendChild(overlay);

  return overlay;
}

/**
 * closeModal(modalEl)
 * Removes a modal overlay from the DOM and restores scroll.
 *
 * @param {HTMLElement} modalEl - The modal overlay element to remove
 */
function closeModal(modalEl) {
  if (modalEl && modalEl.parentNode) {
    modalEl.parentNode.removeChild(modalEl);
  }
  // Only restore scroll if no other modals are open
  if (!document.querySelector(".modal-overlay")) {
    document.body.style.overflow = "";
  }
}

/**
 * showConfirmModal({ title, message, confirmLabel, cancelLabel, onConfirm, onCancel })
 * Convenience wrapper for a two-button confirm/cancel modal.
 *
 * @param {object} opts
 * @param {string} opts.title          - Modal header title
 * @param {string} opts.message        - Body message text (HTML allowed)
 * @param {string} [opts.confirmLabel] - Label for the confirm button (default: "Confirm")
 * @param {string} [opts.cancelLabel]  - Label for the cancel button (default: "Cancel")
 * @param {function} [opts.onConfirm]  - Called when confirm is clicked
 * @param {function} [opts.onCancel]   - Called when cancel is clicked
 * @returns {HTMLElement} The created modal overlay element
 */
function showConfirmModal({ title, message, confirmLabel = "Confirm", cancelLabel = "Cancel", onConfirm, onCancel }) {
  return showModal({
    title,
    body: `<p style="font-size:14px;color:var(--text);line-height:1.6">${message}</p>`,
    actions: [
      {
        label: cancelLabel,
        class: "btn-secondary",
        onClick: modal => {
          closeModal(modal);
          if (typeof onCancel === "function") onCancel();
        },
      },
      {
        label: confirmLabel,
        class: "btn-primary",
        onClick: modal => {
          closeModal(modal);
          if (typeof onConfirm === "function") onConfirm();
        },
      },
    ],
  });
}

// ── Lock Screen Component ─────────────────────────────────────────────────────
// Shows a full-screen lock overlay with password re-authentication.
// Called by sidebar.js via Ctrl+Shift+L keyboard shortcut.
// Depends on globals: userDisplayName, userInitials, escapeHtml,
//                     STORAGE_KEY, SEARCH_HISTORY_KEY, window.auth

function lockSession(user) {
  if (document.getElementById("lockOverlay")) return; // already locked

  const name   = userDisplayName(user);
  const initials = userInitials(user);
  const email  = user.email || "";

  const overlay = document.createElement("div");
  overlay.id    = "lockOverlay";
  overlay.innerHTML = `
    <div class="lock-card">
      <div class="lock-icon-wrap">
        <div class="lock-avatar">${escapeHtml(initials)}</div>
        <div class="lock-badge">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0110 0v4"/>
          </svg>
        </div>
      </div>
      <div class="lock-name">${escapeHtml(name)}</div>
      <div class="lock-email">${escapeHtml(email)}</div>

      <div id="lockError" class="lock-error" hidden></div>

      <div class="lock-input-wrap">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
          <path d="M7 11V7a5 5 0 0110 0v4"/>
        </svg>
        <input id="lockPass" type="password" placeholder="Enter your password" autocomplete="current-password" />
        <button type="button" id="lockPassToggle" aria-label="Show">
          <svg id="lockEyeIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
        </button>
      </div>

      <button type="button" id="lockUnlockBtn" class="lock-unlock-btn">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
          <path d="M7 11V7a5 5 0 0110 0v4"/>
        </svg>
        Unlock
      </button>

      <button type="button" id="lockSignOutBtn" class="lock-signout-btn">Sign out instead</button>
    </div>
  `;

  // Inject CSS once
  if (!document.getElementById("lockOverlayStyles")) {
    const style = document.createElement("style");
    style.id = "lockOverlayStyles";
    style.textContent = `
      #lockOverlay {
        position: fixed; inset: 0; z-index: 9999;
        background: rgba(15,23,42,.75);
        backdrop-filter: blur(8px);
        display: flex; align-items: center; justify-content: center;
        animation: lockFadeIn .2s ease;
      }
      @keyframes lockFadeIn { from { opacity:0 } to { opacity:1 } }

      .lock-card {
        background: var(--panel); border: 1px solid var(--border);
        border-radius: 20px; padding: 36px 32px 28px;
        width: 100%; max-width: 340px; text-align: center;
        box-shadow: 0 24px 64px rgba(0,0,0,.25);
        animation: lockSlide .22s cubic-bezier(.34,1.56,.64,1);
      }
      @keyframes lockSlide { from { transform:translateY(24px);opacity:0 } to { transform:translateY(0);opacity:1 } }

      .lock-icon-wrap { position:relative; display:inline-block; margin-bottom:14px; }

      .lock-avatar {
        width:60px; height:60px; border-radius:50%;
        background:var(--primary-light); color:var(--primary);
        border:2px solid var(--primary-border);
        font-size:20px; font-weight:700;
        display:grid; place-items:center;
      }

      .lock-badge {
        position:absolute; bottom:-4px; right:-4px;
        width:22px; height:22px; border-radius:50%;
        background:var(--panel); border:2px solid var(--border);
        display:grid; place-items:center;
      }
      .lock-badge svg { width:11px; height:11px; color:var(--muted); }

      .lock-name { font-size:16px; font-weight:700; color:var(--text); }
      .lock-email { font-size:12.5px; color:var(--muted); margin-top:3px; margin-bottom:20px; }

      .lock-error {
        font-size:13px; color:var(--danger); background:var(--danger-light);
        border:1px solid var(--danger-border); border-radius:8px;
        padding:9px 14px; margin-bottom:14px; text-align:left;
        animation: lockShake .3s cubic-bezier(.4,0,.2,1);
      }
      @keyframes lockShake { 0%,100%{transform:translateX(0)} 25%{transform:translateX(-4px)} 75%{transform:translateX(4px)} }

      .lock-input-wrap {
        position:relative; display:flex; align-items:center;
        border:1.5px solid var(--border); border-radius:10px;
        background:var(--bg); margin-bottom:12px;
        transition:border-color .15s, box-shadow .15s;
      }
      .lock-input-wrap:focus-within {
        border-color:var(--primary);
        box-shadow:0 0 0 3px var(--primary-border);
      }
      .lock-input-wrap > svg { width:15px;height:15px;color:var(--muted);flex-shrink:0;margin-left:12px; }
      .lock-input-wrap input {
        flex:1; border:none; background:transparent; color:var(--text);
        font:14px var(--font-family); padding:11px 8px; outline:none;
      }
      .lock-input-wrap button {
        background:none; border:none; cursor:pointer; color:var(--muted);
        padding:8px 10px; display:grid; place-items:center; border-radius:8px;
      }
      .lock-input-wrap button svg { width:15px;height:15px; }

      .lock-unlock-btn {
        width:100%; padding:12px; border-radius:10px;
        background:var(--primary); color:#fff; border:none;
        font:600 14px var(--font-family); cursor:pointer;
        display:flex; align-items:center; justify-content:center; gap:7px;
        transition:background .15s, box-shadow .15s, transform .1s;
        margin-bottom:10px;
      }
      .lock-unlock-btn:hover:not(:disabled) {
        background:var(--primary-hover);
        box-shadow:0 4px 14px rgba(37,99,235,.3);
        transform:translateY(-1px);
      }
      .lock-unlock-btn:disabled { opacity:.6; cursor:not-allowed; }

      .lock-signout-btn {
        background:none; border:none; cursor:pointer;
        font-size:13px; color:var(--muted); text-decoration:underline;
        transition:color .15s;
      }
      .lock-signout-btn:hover { color:var(--danger); }

      .lock-shortcut-hint {
        margin-top:16px; font-size:11.5px; color:var(--muted);
        display:flex; align-items:center; justify-content:center; gap:5px;
      }
      .lock-shortcut-hint kbd {
        background:var(--bg); border:1px solid var(--border);
        border-radius:4px; padding:1px 5px; font-size:11px;
        font-family:monospace;
      }
    `;
    document.head.appendChild(style);
  }

  document.body.appendChild(overlay);

  const passInput    = overlay.querySelector("#lockPass");
  const unlockBtn    = overlay.querySelector("#lockUnlockBtn");
  const signOutBtn   = overlay.querySelector("#lockSignOutBtn");
  const errorEl      = overlay.querySelector("#lockError");
  const passToggle   = overlay.querySelector("#lockPassToggle");
  const eyeIcon      = overlay.querySelector("#lockEyeIcon");

  passInput.focus();

  passToggle.addEventListener("click", () => {
    const show = passInput.type === "password";
    passInput.type = show ? "text" : "password";
    eyeIcon.innerHTML = show
      ? `<path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>`
      : `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>`;
  });

  async function tryUnlock() {
    const pass = passInput.value;
    if (!pass) { passInput.focus(); return; }

    unlockBtn.disabled = true;
    unlockBtn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin .7s linear infinite"><path d="M21 12a9 9 0 11-6.219-8.56"/></svg> Verifying…`;

    try {
      await window.auth.signInWithEmailAndPassword(email, pass);
      overlay.style.animation = "lockFadeIn .15s ease reverse";
      setTimeout(() => overlay.remove(), 140);
    } catch (err) {
      const msgs = {
        "auth/wrong-password":     "Incorrect password.",
        "auth/invalid-credential": "Incorrect password.",
        "auth/too-many-requests":  "Too many attempts. Try again later.",
      };
      errorEl.textContent = msgs[err.code] || "Incorrect password.";
      errorEl.hidden = false;
      passInput.value = "";
      passInput.focus();
    } finally {
      unlockBtn.disabled = false;
      unlockBtn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg> Unlock`;
    }
  }

  unlockBtn.addEventListener("click", tryUnlock);
  passInput.addEventListener("keydown", e => { if (e.key === "Enter") tryUnlock(); });

  signOutBtn.addEventListener("click", () => {
    overlay.remove();
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(SEARCH_HISTORY_KEY);
    localStorage.removeItem("sessionExpiresAt");
    window.auth.signOut().finally(() => { window.location.href = "../login.html"; });
  });
}

const NAV_ITEMS = [
  {
    label: "Form",
    href:  "form.html",
    icon:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg>`,
  },
  {
    label: "Database",
    href:  "database.html",
    icon:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>`,
  },
  {
    label: "Reports",
    href:  "reports.html",
    icon:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 20V10M12 20V4M6 20v-6"/></svg>`,
  },
  {
    label: "Bookmarklet",
    href:  "bookmarklet.html",
    icon:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/></svg>`,
  },
  {
    label: "Settings",
    href:  "settings.html",
    icon:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>`,
  },
];

const SIDEBAR_COLLAPSED_KEY = "sidebarCollapsed";

function userInitials(user) {
  if (user.isAnonymous) return "G";
  const name = userDisplayName(user);
  return name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
}

function formatEmailName(email) {
  const local = email.split("@")[0] || "User";
  return local
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, c => c.toUpperCase());
}

function userDisplayName(user) {
  if (user.isAnonymous) return "Guest";
  if (user.displayName)  return user.displayName;
  if (user.email)        return formatEmailName(user.email);
  return "User";
}

function buildSidebar(user) {
  const current  = window.location.pathname.split("/").pop();

  const navLinks = NAV_ITEMS.map(({ label, href, icon }) => `
    <a class="nav ${current === href ? "active" : ""}" href="${href}" data-tooltip="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">
      <span class="nav-icon">${icon}</span>
      <span class="nav-text">${escapeHtml(label)}</span>
    </a>
  `).join("");

  const initials = userInitials(user);
  const name     = userDisplayName(user);
  const role     = user.isAnonymous ? "Guest access" : (user.email || "Authenticated");

  const logoutSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/></svg>`;

  const sidebar = document.createElement("aside");
  sidebar.className = "sidebar";
  sidebar.setAttribute("aria-label", "Main navigation");
  sidebar.innerHTML = `
    <div class="sidebar-brand">
      <img class="sidebar-logo-img" src="assets/logo.svg" alt="Agent Evaluation" width="36" height="36" />
      <div class="sidebar-brand-text">
        <h1>Agent Eval</h1>
        <p>ServiceNow Helper</p>
      </div>
      <button class="sidebar-toggle" id="sidebarToggle" type="button" aria-label="Collapse sidebar" aria-expanded="true" data-tooltip="Expand sidebar">
        <svg class="toggle-collapse-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M15 18l-6-6 6-6"/></svg>
        <svg class="toggle-expand-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M9 18l6-6-6-6"/></svg>
      </button>
    </div>

    <nav class="sidebar-nav" aria-label="Pages">
      <span class="nav-label">Navigation</span>
      ${navLinks}
    </nav>

    <div class="sidebar-footer">
      <div class="user-card">
        <div class="user-avatar" title="${escapeHtml(name)}">${initials}</div>
        <div class="user-info">
          <div class="user-name">${escapeHtml(name)}</div>
          <div class="user-role">${escapeHtml(role)}</div>
        </div>
      </div>
      <button class="logout-btn" id="logoutBtn" aria-label="Sign out" data-tooltip="Sign out">
        ${logoutSvg} <span class="logout-text">Sign out</span>
      </button>
    </div>

    <button class="logout-btn mobile-logout-btn" id="mobileLogoutBtn" aria-label="Sign out">
      ${logoutSvg} <span class="logout-text">Sign out</span>
    </button>
  `;

  const shell = document.querySelector(".shell");
  const savedCollapsed = localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
  const shouldCollapse = savedCollapsed === null
    ? window.matchMedia("(max-width: 900px)").matches
    : savedCollapsed === "true";
  shell.classList.toggle("sidebar-collapsed", shouldCollapse);
  shell.insertBefore(sidebar, shell.firstChild);

  const toggle = sidebar.querySelector("#sidebarToggle");
  const syncToggle = () => {
    const collapsed = shell.classList.contains("sidebar-collapsed");
    const label = collapsed ? "Expand sidebar" : "Collapse sidebar";
    toggle.setAttribute("aria-label", label);
    toggle.dataset.tooltip = label;
    toggle.setAttribute("aria-expanded", String(!collapsed));
  };
  syncToggle();
  toggle.addEventListener("click", () => {
    const collapsed = !shell.classList.contains("sidebar-collapsed");
    shell.classList.toggle("sidebar-collapsed", collapsed);
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed));
    syncToggle();
  });

  // Async admin nav injection — only for authenticated (non-guest) users with an email
  if (!user.isAnonymous && user.email) {
    isAdmin(user.email).then(ok => {
      if (!ok) return;
      const nav = sidebar.querySelector(".sidebar-nav");
      if (!nav || nav.querySelector('a[href="admin.html"]')) return;
      const adminLink = document.createElement("a");
      adminLink.className = "nav" + (current === "admin.html" ? " active" : "");
      adminLink.href = "admin.html";
      adminLink.dataset.tooltip = "Admin";
      adminLink.setAttribute("aria-label", "Admin");
      adminLink.innerHTML = `
        <span class="nav-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg></span>
        <span class="nav-text">Admin</span>
      `;
      nav.appendChild(adminLink);
    }).catch(() => {});
  }

  function doSignOut() {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(SEARCH_HISTORY_KEY);
    localStorage.removeItem("sessionExpiresAt");
    window.auth.signOut().catch(() => {}).finally(() => {
      window.location.href = "../login.html";
    });
  }

  document.getElementById("logoutBtn").addEventListener("click", doSignOut);
  document.getElementById("mobileLogoutBtn").addEventListener("click", doSignOut);

  // ── Session lock (Ctrl+Shift+L) ────────────────────────────────────────────
  if (!user.isAnonymous && user.email) {
    document.addEventListener("keydown", e => {
      if (e.ctrlKey && e.shiftKey && e.key === "L") {
        e.preventDefault();
        lockSession(user);
      }
    });
  }
}

// Auth guard — supports Firebase Auth and sessionStorage guest session
// lockSession() is defined in src/components/lockScreen.js (loaded before sidebar.js)
let _sidebarBuilt = false;
if (sessionStorage.getItem("guestSession")) {
  _sidebarBuilt = true;
  window.currentUser = { isAnonymous: true, email: null, displayName: "Guest" };
  buildSidebar(window.currentUser);
  hideLoading();
  setTimeout(() => document.dispatchEvent(new Event("appReady")), 0);
} else {
  let _authResolved = false;
  const _authTimeout = setTimeout(() => {
    if (!_authResolved) window.location.href = "../login.html";
  }, 10000);

  window.auth.onAuthStateChanged(user => {
    _authResolved = true;
    clearTimeout(_authTimeout);
    if (_sidebarBuilt) return;
    if (!user) {
      window.location.href = "../login.html";
      return;
    }

    // Session expiry check
    const expiry = parseInt(localStorage.getItem("sessionExpiresAt") || "0", 10);
    if (expiry && Date.now() > expiry) {
      localStorage.removeItem("sessionExpiresAt");
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(SEARCH_HISTORY_KEY);
      window.auth.signOut().finally(() => {
        window.location.href = "../login.html";
      });
      return;
    }

    _sidebarBuilt = true;
    window.currentUser = user;
    buildSidebar(user);
    hideLoading();
    document.dispatchEvent(new Event("appReady"));
  });
}

// Legacy shim — most logic moved to src/core/* and src/utils/*
// What remains here: today() utility
// formatDisplayDate is in src/utils/strings.js
// All other functions are in their respective modules.

function today() {
  return new Date().toISOString().slice(0, 10);
}

// ── Database filters ──────────────────────────────────────────────────────────

// Dynamic — rebuilt on every renderTable() call so new custom criteria appear immediately
function getKpiFields() {
  return getActiveCriteria().map(c => ({
    id:    c.id,
    label: c.builtin ? (scoreLabels[c.id] || c.id) : (c.label || c.id),
    abbr:  c.builtin ? (scoreLabels[c.id] || c.id).replace(/\s+/g, "").slice(0, 3).toUpperCase()
                     : (c.label || c.id).replace(/\s+/g, "").slice(0, 3).toUpperCase(),
  }));
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
    setStateKey("auditAllEntries", await getAuditLog(300));
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
    return getStateKey("auditAllEntries").filter(e => {
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

// ── CSV / PDF export ──────────────────────────────────────────────────────────

function exportCsv(data) {
  const criteria = getActiveCriteria();
  const headers = [
    "Ticket Number", "Agent Name", "Evaluation Date", "SLA Breach",
    "LSA", "Evaluated By",
    ...criteria.map(c => c.builtin ? (scoreLabels[c.id] || c.id) : (c.label || c.id)),
    "Average Score", "Comments", "Created At",
  ];
  const rows = data.map(item => {
    const avg = getAvg(item);
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
  const avg      = getAvg(item);
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
    const avg      = getAvg(item);
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
    const toImport = selectedIdxs.map(i => getStateKey("importParsed")[i]).filter(Boolean);
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

      setStateKey("allData", await getData({ forceFullSync: true }));
      renderTable(getStateKey("allData"));
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
    setStateKey("importParsed", parsed);
    const existingTickets = new Set(getStateKey("allData").map(x => x.ticketNumber));

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

// ── Table rendering helpers ───────────────────────────────────────────────────

function slaBadge(val) {
  return val === "Yes"
    ? `<span class="badge badge-danger">⚠ Yes</span>`
    : `<span class="badge badge-success">✓ No</span>`;
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

function getSelectedTickets() {
  return [...document.querySelectorAll(".row-select:checked")].map(cb => cb.dataset.ticket);
}

function updatePdfLabel() {
  const sel = getSelectedTickets();
  const label = document.getElementById("exportPdfLabel");
  if (label) label.textContent = sel.length ? `Export PDF (${sel.length})` : "Export PDF";
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

let _mathAnswer = 0;  // correct answer for Delete All math check — private UI state

document.addEventListener("appReady", async () => {
  if (getSettings().compactTable) document.querySelector(".table-wrap table")?.setAttribute("data-compact", "");

  // Show cached data instantly — guests never see another user's cache
  const isGuest = sessionStorage.getItem("guestSession") === "1";
  const cached  = isGuest ? [] : JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  if (cached.length) {
    setStateKey("allData", cached);
    renderTable(getStateKey("allData"));
  } else {
    setTableLoading(true);
  }

  bindEvents();
  bindImportPreview();
  bindAuditModal();

  // First load (no cache): full sync from Firestore
  if (!cached.length) {
    try {
      setStateKey("allData", await getData());
      renderTable(getStateKey("allData"));
    } catch (err) {
      toast("Failed to load data: " + err.message, "error");
    } finally {
      setTableLoading(false);
    }
  }

  // Real-time listener: syncs any changes since last session
  subscribeData(data => {
    setStateKey("allData", data);
    renderTable(filterData(document.getElementById("searchInput").value));
  });
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") unsubscribeData();
  else subscribeData(data => {
    setStateKey("allData", data);
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

async function confirmDelete(ticketNumber) {
  if (getSettings().confirmDeleteSingle !== false) {
    if (!confirm(`Delete evaluation ${ticketNumber}? This cannot be undone.`)) return;
  }
  const snapshot = getStateKey("allData").find(x => x.ticketNumber === ticketNumber) || null;
  try {
    await deleteEvaluation(ticketNumber, snapshot);
    setStateKey("allData", getStateKey("allData").filter(x => x.ticketNumber !== ticketNumber));
    renderTable(filterData(document.getElementById("searchInput").value));
    toast(`${ticketNumber} deleted.`, "success");
  } catch (err) {
    toast("Delete failed: " + err.message, "error");
  }
}

function bindEvents() {
  bindSearchEvents();
  bindSelectionEvents();
  bindExportEvents();
  bindDeleteEvents();
}

function bindSearchEvents() {
  let debounce;
  document.getElementById("searchInput").addEventListener("input", e => {
    clearTimeout(debounce);
    debounce = setTimeout(() => renderTable(filterData(e.target.value)), 200);
  });
}

function bindSelectionEvents() {
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
      const item = getStateKey("allData").find(x => x.ticketNumber === ticket);
      if (item) exportTicketReport(item);
    }
  });
}

function bindExportEvents() {
  // PDF export — selected rows, or all if none selected
  document.getElementById("exportPdfBtn")?.addEventListener("click", () => {
    const selected = getSelectedTickets();
    const items    = selected.length
      ? getStateKey("allData").filter(x => selected.includes(x.ticketNumber))
      : getStateKey("allData");
    if (!items.length) { toast("No data to export.", "warning"); return; }
    exportMultiTicketReport(items);
  });

  document.getElementById("exportJsonBtn").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(getStateKey("allData"), null, 2)], { type: "application/json" });
    const a    = Object.assign(document.createElement("a"), {
      href:     URL.createObjectURL(blob),
      download: `agent-evaluations-${today()}.json`,
    });
    a.click();
    toast("JSON export downloaded.", "success");
  });

  document.getElementById("exportCsvBtn")?.addEventListener("click", () => {
    const blob = new Blob([exportCsv(getStateKey("allData"))], { type: "text/csv;charset=utf-8;" });
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
}

function bindDeleteEvents() {
  // Delete All — open math confirm modal
  document.getElementById("deleteAllBtn").addEventListener("click", () => {
    if (!getStateKey("allData").length) { toast("Nothing to delete.", "warning"); return; }
    const a = Math.floor(Math.random() * 20) + 5;
    const b = Math.floor(Math.random() * 30) + 10;
    _mathAnswer = a + b;
    document.getElementById("mathQuestion").textContent  = `${a} + ${b} = ?`;
    document.getElementById("mathAnswer").value          = "";
    document.getElementById("mathError").textContent     = "";
    document.getElementById("mathConfirmCount").textContent = `all ${getStateKey("allData").length}`;
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
      getStateKey("allData").forEach(item => {
        batch.delete(window.db.collection(COLLECTION).doc(item.ticketNumber));
      });
      await batch.commit();
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(SYNC_KEY);
      setStateKey("allData", []);
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
