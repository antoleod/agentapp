requireSession();

function renderDatabase() {
  const search = document.getElementById("searchInput").value.toLowerCase();
  const body = document.getElementById("databaseBody");

  const data = getData().filter(item =>
    item.ticketNumber.toLowerCase().includes(search) ||
    item.agentName.toLowerCase().includes(search) ||
    (item.lsa || "").toLowerCase().includes(search)
  );

  body.innerHTML = data.length ? data.map(item => `
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
        <a class="btn-secondary" href="form.html?edit=${encodeURIComponent(item.ticketNumber)}">Edit</a>
        <button class="secondary" onclick="openServiceNow('${item.ticketNumber}')">Open</button>
        <button class="danger" onclick="deleteEvaluation('${item.ticketNumber}')">Delete</button>
      </td>
    </tr>
  `).join("") : `<tr><td colspan="9" style="text-align:center;color:#667085;">No evaluations found.</td></tr>`;
}

function deleteEvaluation(ticketNumber) {
  if (!confirm(`Delete evaluation ${ticketNumber}?`)) return;
  saveData(getData().filter(x => x.ticketNumber !== ticketNumber));
  renderDatabase();
}

document.addEventListener("DOMContentLoaded", () => {
  renderDatabase();

  document.getElementById("searchInput").addEventListener("input", renderDatabase);

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
        alert("JSON imported.");
      } catch (error) {
        alert("Import failed: " + error.message);
      }
    };
    reader.readAsText(file);
  });

  document.getElementById("deleteAllBtn").addEventListener("click", () => {
    if (!confirm("Delete all evaluations?")) return;
    saveData([]);
    renderDatabase();
  });
});
