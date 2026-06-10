const STORAGE_KEY = "agentEvaluationsV2";
const SETTINGS_KEY = "agentEvaluationSettingsV1";
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

function fillScoreDropdowns() {
  scoreFields.forEach(id => {
    const select = document.getElementById(id);
    select.innerHTML = scoreOptions.map(([value, label]) => `<option value="${value}">${label}</option>`).join("");
    select.value = "3";
  });
}

function clearForm() {
  const settings = getSettings();
  document.getElementById("evaluationForm").reset();
  document.getElementById("evaluationDate").value = today();
  document.getElementById("evaluatedBy").value = settings.defaultEvaluator || "";
  fillScoreDropdowns();
}

function readForm() {
  return {
    ticketNumber: document.getElementById("ticketNumber").value.trim().toUpperCase(),
    agentName: document.getElementById("agentName").value.trim(),
    evaluationDate: document.getElementById("evaluationDate").value,
    slaBreach: document.getElementById("slaBreach").value,
    lsa: document.getElementById("lsa").value.trim(),
    assignedTo: document.getElementById("assignedTo").value.trim(),
    assetTracking: document.getElementById("assetTracking").value,
    planningCompliance: document.getElementById("planningCompliance").value,
    kbCompliance: document.getElementById("kbCompliance").value,
    teamSpirit: document.getElementById("teamSpirit").value,
    dressCode: document.getElementById("dressCode").value,
    customerOriented: document.getElementById("customerOriented").value,
    comments: document.getElementById("comments").value.trim(),
    evaluatedBy: document.getElementById("evaluatedBy").value.trim(),
    createdAt: new Date().toISOString()
  };
}

function loadIntoForm(item) {
  document.getElementById("ticketNumber").value = item.ticketNumber || "";
  document.getElementById("agentName").value = item.agentName || "";
  document.getElementById("evaluationDate").value = item.evaluationDate || today();
  document.getElementById("slaBreach").value = item.slaBreach || "No";
  document.getElementById("lsa").value = item.lsa || "";
  document.getElementById("assignedTo").value = item.assignedTo || "";
  document.getElementById("assetTracking").value = item.assetTracking || "3";
  document.getElementById("planningCompliance").value = item.planningCompliance || "3";
  document.getElementById("kbCompliance").value = item.kbCompliance || "3";
  document.getElementById("teamSpirit").value = item.teamSpirit || "3";
  document.getElementById("dressCode").value = item.dressCode || "3";
  document.getElementById("customerOriented").value = item.customerOriented || "3";
  document.getElementById("comments").value = item.comments || "";
  document.getElementById("evaluatedBy").value = item.evaluatedBy || "";
}

function renderDatabase() {
  const search = document.getElementById("searchInput").value.toLowerCase();
  const body = document.getElementById("databaseBody");

  const data = getData().filter(item =>
    item.ticketNumber.toLowerCase().includes(search) ||
    item.agentName.toLowerCase().includes(search) ||
    (item.lsa || "").toLowerCase().includes(search)
  );

  body.innerHTML = data.map(item => `
    <tr>
      <td>${item.ticketNumber}</td>
      <td>${item.agentName}</td>
      <td>${item.evaluationDate}</td>
      <td>${item.slaBreach}</td>
      <td>${item.lsa || ""}</td>
      <td>${item.assignedTo || ""}</td>
      <td>${calculateAverage(item)}</td>
      <td>${item.evaluatedBy || ""}</td>
      <td>
        <button class="secondary" onclick="editEvaluation('${item.ticketNumber}')">Edit</button>
        <button class="secondary" onclick="openServiceNow('${item.ticketNumber}')">Open</button>
        <button class="danger" onclick="deleteEvaluation('${item.ticketNumber}')">Delete</button>
      </td>
    </tr>
  `).join("");
}

function renderReports() {
  const data = getData();

  document.getElementById("totalEvaluations").textContent = data.length;
  document.getElementById("totalBreaches").textContent = data.filter(x => x.slaBreach === "Yes").length;

  const allAverage = data.length
    ? (data.reduce((sum, item) => sum + calculateAverage(item), 0) / data.length).toFixed(2)
    : "0";

  document.getElementById("averageScore").textContent = allAverage;

  const byAgent = {};
  data.forEach(item => {
    if (!byAgent[item.agentName]) byAgent[item.agentName] = [];
    byAgent[item.agentName].push(calculateAverage(item));
  });

  const agentReport = document.getElementById("agentReport");

  agentReport.innerHTML = Object.entries(byAgent).map(([agent, values]) => {
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const percent = Math.min(100, (avg / 5) * 100);

    return `
      <div class="agent-row">
        <strong>${agent}</strong>
        <div class="bar"><div style="width:${percent}%"></div></div>
        <span>${avg.toFixed(2)}</span>
      </div>
    `;
  }).join("") || "<p>No data yet.</p>";
}

function getSearchHistory() {
  return JSON.parse(localStorage.getItem(SEARCH_HISTORY_KEY) || "[]");
}

function saveSearchHistory(ticket) {
  if (!ticket) return;

  let history = getSearchHistory();

  history = history.filter(item => item.ticket !== ticket);

  history.unshift({
    ticket: ticket,
    searchedAt: new Date().toISOString()
  });

  history = history.slice(0, 50);

  localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(history));
}

async function pasteServiceNowInfo() {
  let text = "";

  try {
    if (navigator.clipboard && navigator.clipboard.readText) {
      text = await navigator.clipboard.readText();
    }
  } catch (e) {
    console.warn("Clipboard read failed, using manual paste fallback.", e);
  }

  if (!text) {
    text = prompt("Paste the ServiceNow JSON here:");
  }

  if (!text) return;

  try {
    const data = JSON.parse(text);

    document.getElementById("ticketNumber").value = data.number || data.ticketNumber || "";
    document.getElementById("assignedTo").value = data.assignedTo || "";
    document.getElementById("lsa").value = data.assignmentGroup || data.lsa || "";
    document.getElementById("comments").value = data.shortDescription || data.comments || "";

    if (data.state) {
      const currentComments = document.getElementById("comments").value || "";

      document.getElementById("comments").value = currentComments
        ? `${currentComments}\n\nState: ${data.state}`
        : `State: ${data.state}`;
    }

    alert("ServiceNow data imported.");
  } catch (e) {
    console.error(e);
    alert("Invalid ServiceNow JSON. Please copy the ticket JSON again.");
  }
}

function openServiceNow(ticket) {
  if (!ticket) {
    ticket = document.getElementById("ticketNumber").value.trim().toUpperCase();
  }

  if (!ticket) {
    alert("Enter a ticket number first.");
    return;
  }

  const instance = "europarl.service-now.com";

  let table = "task";

  if (ticket.startsWith("INC")) table = "incident";
  if (ticket.startsWith("RITM")) table = "sc_req_item";
  if (ticket.startsWith("REQ")) table = "sc_request";
  if (ticket.startsWith("SCTASK")) table = "sc_task";

  const query = `${table}.do?sysparm_query=number=${encodeURIComponent(ticket)}`;
  const url = `https://${instance}/nav_to.do?uri=${encodeURIComponent(query)}`;

  saveSearchHistory(ticket);
  window.open(url, "_blank");
}

function editEvaluation(ticketNumber) {
  const item = getData().find(x => x.ticketNumber === ticketNumber);
  if (!item) return;

  loadIntoForm(item);
  showScreen("formScreen");
}

function deleteEvaluation(ticketNumber) {
  if (!confirm(`Delete evaluation ${ticketNumber}?`)) return;

  const data = getData().filter(x => x.ticketNumber !== ticketNumber);

  saveData(data);
  renderDatabase();
  renderReports();
}

function showScreen(screenId) {
  document.querySelectorAll(".nav").forEach(x => x.classList.remove("active"));
  document.querySelectorAll(".screen").forEach(x => x.classList.remove("active"));

  document.querySelector(`[data-screen="${screenId}"]`).classList.add("active");
  document.getElementById(screenId).classList.add("active");

  renderDatabase();
  renderReports();
}

document.querySelectorAll(".nav").forEach(button => {
  button.addEventListener("click", () => showScreen(button.dataset.screen));
});

document.getElementById("evaluationForm").addEventListener("submit", event => {
  event.preventDefault();

  const item = readForm();

  if (!item.ticketNumber || !item.agentName || !item.evaluationDate) {
    alert("Ticket Number, Agent Name and Evaluation Date are required.");
    return;
  }

  const data = getData();
  const existingIndex = data.findIndex(x => x.ticketNumber === item.ticketNumber);

  if (existingIndex >= 0) {
    if (!confirm("This ticket already exists. Replace it?")) return;
    data[existingIndex] = item;
  } else {
    data.push(item);
  }

  saveData(data);
  alert("Evaluation saved.");

  clearForm();
  renderDatabase();
  renderReports();
});

document.getElementById("searchLocalBtn").addEventListener("click", () => {
  const ticket = document.getElementById("ticketNumber").value.trim().toUpperCase();
  const item = getData().find(x => x.ticketNumber === ticket);

  if (!item) {
    alert("No saved evaluation found for this ticket.");
    return;
  }

  loadIntoForm(item);
});

document.getElementById("clearBtn").addEventListener("click", clearForm);
document.getElementById("openSnowBtn").addEventListener("click", () => openServiceNow());

const pasteSnowBtn = document.getElementById("pasteSnowBtn");
if (pasteSnowBtn) {
  pasteSnowBtn.addEventListener("click", pasteServiceNowInfo);
}

document.getElementById("ticketNumber").addEventListener("keydown", event => {
  if (event.key === "Enter") {
    event.preventDefault();
    openServiceNow();
  }
});

document.getElementById("searchInput").addEventListener("input", renderDatabase);
document.getElementById("refreshReportsBtn").addEventListener("click", renderReports);

document.getElementById("deleteAllBtn").addEventListener("click", () => {
  if (!confirm("Delete all evaluations?")) return;

  saveData([]);
  renderDatabase();
  renderReports();
});

document.getElementById("exportJsonBtn").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(getData(), null, 2)], { type: "application/json" });
  const link = document.createElement("a");

  link.href = URL.createObjectURL(blob);
  link.download = `agent-evaluations-${today()}.json`;
  link.click();
});

document.getElementById("importJsonInput").addEventListener("change", event => {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();

  reader.onload = () => {
    try {
      const imported = JSON.parse(reader.result);

      if (!Array.isArray(imported)) throw new Error("Invalid JSON format.");

      saveData(imported);
      renderDatabase();
      renderReports();

      alert("JSON imported.");
    } catch (error) {
      alert("Import failed: " + error.message);
    }
  };

  reader.readAsText(file);
});

document.getElementById("saveSettingsBtn").addEventListener("click", () => {
  const settings = {
    serviceNowInstance: document.getElementById("serviceNowInstance").value.trim(),
    defaultEvaluator: document.getElementById("defaultEvaluator").value.trim(),
    loginUsername: document.getElementById("loginUsername").value.trim(),
    loginPassword: document.getElementById("loginPassword").value
  };

  saveSettings(settings);
  alert("Settings saved.");
});

document.getElementById("logoutBtn").addEventListener("click", () => {
  sessionStorage.removeItem("aeSession");
  window.location.href = "login.html";
});

function loadSettingsUI() {
  const settings = getSettings();

  document.getElementById("serviceNowInstance").value = settings.serviceNowInstance || "";
  document.getElementById("defaultEvaluator").value = settings.defaultEvaluator || "";
  document.getElementById("loginUsername").value = settings.loginUsername || "";
  document.getElementById("loginPassword").value = settings.loginPassword || "";
}

fillScoreDropdowns();
loadSettingsUI();
clearForm();
renderDatabase();
renderReports();