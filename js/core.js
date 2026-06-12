const STORAGE_KEY        = "agentEvaluationsV2";
const SYNC_KEY           = "agentSyncMetaV1";
const SETTINGS_KEY       = "agentEvaluationSettingsV1";
const SEARCH_HISTORY_KEY = "serviceNowSearchHistoryV1";
const COLLECTION         = "evaluations";
const AUDIT_COLLECTION   = "auditLog";

// Built-in score criteria — labelKey/hintKey resolved via t() from i18n.js
const BUILTIN_CRITERIA = [
  { id: "assetTracking",      labelKey: "crit.assetTracking",           hintKey: "crit.assetTracking.hint" },
  { id: "planningCompliance", labelKey: "crit.planningCompliance",      hintKey: "crit.planningCompliance.hint" },
  { id: "kbCompliance",       labelKey: "crit.kbCompliance",            hintKey: "crit.kbCompliance.hint" },
  { id: "teamSpirit",         labelKey: "crit.teamSpirit",              hintKey: "crit.teamSpirit.hint" },
  { id: "dressCode",          labelKey: "crit.dressCode",               hintKey: "crit.dressCode.hint" },
  { id: "customerOriented",   labelKey: "crit.customerOriented",        hintKey: "crit.customerOriented.hint" },
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
};

function today() {
  return new Date().toISOString().slice(0, 10);
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

// ── Settings ──────────────────────────────────────────────────────────────────
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

// ── Criteria helpers ──────────────────────────────────────────────────────────
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

function scoreClass(avg) {
  if (avg >= 4) return "score-high";
  if (avg >= 3) return "score-mid";
  return "score-low";
}

// ── Theme ─────────────────────────────────────────────────────────────────────
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme || "light");
}

// ── Typography ────────────────────────────────────────────────────────────────
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

// Apply immediately on script load (before DOM paint)
applyTheme(getSettings().theme || "light");
applyFont(getSettings().font);
applyFontSize(getSettings().fontSize);

// ── Data layer (Firestore primary, localStorage cache) ────────────────────────
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
  } catch {
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

// ── ServiceNow ────────────────────────────────────────────────────────────────
function saveSearchHistory(ticket) {
  if (!ticket) return;
  let h = JSON.parse(localStorage.getItem(SEARCH_HISTORY_KEY) || "[]");
  h = h.filter(x => x.ticket !== ticket);
  h.unshift({ ticket, searchedAt: new Date().toISOString() });
  localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(h.slice(0, 50)));
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

// ── UI helpers ────────────────────────────────────────────────────────────────
function showLoading() {
  const el = document.getElementById("loadingOverlay");
  if (el) el.classList.remove("hidden");
}

function hideLoading() {
  const el = document.getElementById("loadingOverlay");
  if (el) el.classList.add("hidden");
}

// ── Role management (Firestore: roles/{emailKey}) ─────────────────────────────
const ROLES_COLLECTION = "roles";

function emailKey(email) {
  if (!email) return null;
  return email.toLowerCase().replace(/[@.]/g, "_");
}

async function getUserRole(email) {
  const key = emailKey(email);
  if (!key) return null;
  try {
    const doc = await window.db.collection(ROLES_COLLECTION).doc(key).get();
    return doc.exists ? (doc.data().role || null) : null;
  } catch {
    return null;
  }
}

// Role writes go through Cloud Functions — Admin SDK bypasses Firestore rules server-side,
// so no client can self-escalate or tamper with the roles collection directly.
async function setUserRole(email, displayName, role) {
  const fn = window.functions.httpsCallable("setUserRole");
  await fn({ email, displayName: displayName || null, role });
}

async function updateUserRole(docId, role) {
  const fn = window.functions.httpsCallable("updateUserRole");
  await fn({ docId, role });
}

async function removeUserRole(docId) {
  const fn = window.functions.httpsCallable("removeUserRole");
  await fn({ docId });
}

async function listAllRoles() {
  try {
    const snap = await window.db.collection(ROLES_COLLECTION).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch {
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
