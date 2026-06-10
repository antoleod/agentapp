const STORAGE_KEY        = "agentEvaluationsV2";
const SETTINGS_KEY       = "agentEvaluationSettingsV1";
const SEARCH_HISTORY_KEY = "serviceNowSearchHistoryV1";

const scoreFields = [
  "assetTracking",
  "planningCompliance",
  "kbCompliance",
  "teamSpirit",
  "dressCode",
  "customerOriented"
];

const scoreOptions = [
  ["1", "1 - Poor"],
  ["2", "2 - Needs Improvement"],
  ["3", "3 - Good"],
  ["4", "4 - Very Good"],
  ["5", "5 - Excellent"]
];

function today() {
  return new Date().toISOString().slice(0, 10);
}

function getData() {
  return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
}

function saveData(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function getSettings() {
  return JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
}

function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function calculateAverage(item) {
  const total = scoreFields.reduce((sum, field) => sum + Number(item[field] || 0), 0);
  return Number((total / scoreFields.length).toFixed(2));
}

function requireSession() {
  if (!sessionStorage.getItem("aeSession")) {
    window.location.href = "../login.html";
  }
}

function getSearchHistory() {
  return JSON.parse(localStorage.getItem(SEARCH_HISTORY_KEY) || "[]");
}

function saveSearchHistory(ticket) {
  if (!ticket) return;
  let history = getSearchHistory();
  history = history.filter(item => item.ticket !== ticket);
  history.unshift({ ticket, searchedAt: new Date().toISOString() });
  localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(history.slice(0, 50)));
}

function openServiceNow(ticket) {
  if (!ticket) return;
  const instance = getSettings().serviceNowInstance || "europarl.service-now.com";
  let table = "task";
  if (ticket.startsWith("INC"))    table = "incident";
  if (ticket.startsWith("RITM"))   table = "sc_req_item";
  if (ticket.startsWith("REQ"))    table = "sc_request";
  if (ticket.startsWith("SCTASK")) table = "sc_task";
  const query = `${table}.do?sysparm_query=number=${encodeURIComponent(ticket)}`;
  saveSearchHistory(ticket);
  window.open(`https://${instance}/nav_to.do?uri=${encodeURIComponent(query)}`, "_blank");
}
