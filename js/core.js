const STORAGE_KEY        = "agentEvaluationsV2";
const SETTINGS_KEY       = "agentEvaluationSettingsV1";
const SEARCH_HISTORY_KEY = "serviceNowSearchHistoryV1";
const COLLECTION         = "evaluations";

const scoreFields = [
  "assetTracking",
  "planningCompliance",
  "kbCompliance",
  "teamSpirit",
  "dressCode",
  "customerOriented",
];

const scoreOptions = [
  ["1", "1 — Poor"],
  ["2", "2 — Needs Improvement"],
  ["3", "3 — Good"],
  ["4", "4 — Very Good"],
  ["5", "5 — Excellent"],
];

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

function calculateAverage(item) {
  const total = scoreFields.reduce((s, f) => s + Number(item[f] || 0), 0);
  return Number((total / scoreFields.length).toFixed(2));
}

function scoreClass(avg) {
  if (avg >= 4) return "score-high";
  if (avg >= 3) return "score-mid";
  return "score-low";
}

// ── Settings (always localStorage) ──────────────────────────────────────────
function getSettings() {
  return JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
}

function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

// ── Data layer (Firestore primary, localStorage cache) ───────────────────────
async function getData() {
  try {
    const snap = await window.db.collection(COLLECTION)
      .orderBy("createdAt", "desc")
      .get();
    const data = snap.docs.map(d => d.data());
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); // update cache
    return data;
  } catch {
    // Fall back to localStorage cache
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  }
}

async function saveEvaluation(item) {
  await window.db.collection(COLLECTION).doc(item.ticketNumber).set({
    ...item,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
  // Update cache
  const cached = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  const idx = cached.findIndex(x => x.ticketNumber === item.ticketNumber);
  if (idx >= 0) cached[idx] = item; else cached.unshift(item);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cached));
}

async function deleteEvaluation(ticketNumber) {
  await window.db.collection(COLLECTION).doc(ticketNumber).delete();
  const cached = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  localStorage.setItem(STORAGE_KEY,
    JSON.stringify(cached.filter(x => x.ticketNumber !== ticketNumber))
  );
}

// ── ServiceNow ───────────────────────────────────────────────────────────────
function saveSearchHistory(ticket) {
  if (!ticket) return;
  let h = JSON.parse(localStorage.getItem(SEARCH_HISTORY_KEY) || "[]");
  h = h.filter(x => x.ticket !== ticket);
  h.unshift({ ticket, searchedAt: new Date().toISOString() });
  localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(h.slice(0, 50)));
}

function openServiceNow(ticket) {
  if (!ticket) return;
  const instance = getSettings().serviceNowInstance || "europarl.service-now.com";
  const tableMap  = { INC: "incident", RITM: "sc_req_item", REQ: "sc_request", SCTASK: "sc_task" };
  const table     = Object.entries(tableMap).find(([k]) => ticket.startsWith(k))?.[1] ?? "task";
  const query     = `${table}.do?sysparm_query=number=${encodeURIComponent(ticket)}`;
  saveSearchHistory(ticket);
  window.open(`https://${instance}/nav_to.do?uri=${encodeURIComponent(query)}`, "_blank");
}

// ── UI helpers ───────────────────────────────────────────────────────────────
function showLoading() {
  const el = document.getElementById("loadingOverlay");
  if (el) el.classList.remove("hidden");
}

function hideLoading() {
  const el = document.getElementById("loadingOverlay");
  if (el) el.classList.add("hidden");
}
