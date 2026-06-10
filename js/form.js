requireSession();

function fillScoreDropdowns() {
  scoreFields.forEach(id => {
    const select = document.getElementById(id);
    select.innerHTML = scoreOptions.map(([value, label]) =>
      `<option value="${value}">${label}</option>`
    ).join("");
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

async function pasteServiceNowInfo() {
  let text = "";
  try {
    if (navigator.clipboard && navigator.clipboard.readText) {
      text = await navigator.clipboard.readText();
    }
  } catch (e) {
    console.warn("Clipboard read failed.", e);
  }

  if (!text) text = prompt("Paste the ServiceNow JSON here:");
  if (!text) return;

  try {
    const data = JSON.parse(text);
    document.getElementById("ticketNumber").value = data.number || data.ticketNumber || "";
    document.getElementById("assignedTo").value = data.assignedTo || "";
    document.getElementById("lsa").value = data.assignmentGroup || data.lsa || "";
    document.getElementById("comments").value = data.shortDescription || data.comments || "";
    if (data.state) {
      const curr = document.getElementById("comments").value || "";
      document.getElementById("comments").value = curr ? `${curr}\n\nState: ${data.state}` : `State: ${data.state}`;
    }
    alert("ServiceNow data imported.");
  } catch (e) {
    alert("Invalid ServiceNow JSON.");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  fillScoreDropdowns();
  clearForm();

  const params = new URLSearchParams(window.location.search);
  const editTicket = params.get("edit");
  if (editTicket) {
    const item = getData().find(x => x.ticketNumber === editTicket);
    if (item) loadIntoForm(item);
  }

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
  });

  document.getElementById("searchLocalBtn").addEventListener("click", () => {
    const ticket = document.getElementById("ticketNumber").value.trim().toUpperCase();
    const item = getData().find(x => x.ticketNumber === ticket);
    if (!item) { alert("No saved evaluation found for this ticket."); return; }
    loadIntoForm(item);
  });

  document.getElementById("clearBtn").addEventListener("click", clearForm);

  document.getElementById("openSnowBtn").addEventListener("click", () => {
    const ticket = document.getElementById("ticketNumber").value.trim().toUpperCase();
    if (!ticket) { alert("Enter a ticket number first."); return; }
    openServiceNow(ticket);
  });

  document.getElementById("pasteSnowBtn").addEventListener("click", pasteServiceNowInfo);

  document.getElementById("ticketNumber").addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      const ticket = document.getElementById("ticketNumber").value.trim().toUpperCase();
      if (ticket) openServiceNow(ticket);
    }
  });
});
