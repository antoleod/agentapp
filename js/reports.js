requireSession();

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

  document.getElementById("agentReport").innerHTML = Object.entries(byAgent).map(([agent, values]) => {
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const percent = Math.min(100, (avg / 5) * 100);
    return `
      <div class="agent-row">
        <strong>${agent}</strong>
        <div class="bar"><div style="width:${percent}%"></div></div>
        <span>${avg.toFixed(2)}</span>
      </div>
    `;
  }).join("") || "<p style='color:#667085'>No data yet.</p>";
}

document.addEventListener("DOMContentLoaded", () => {
  renderReports();
  document.getElementById("refreshReportsBtn").addEventListener("click", renderReports);
});
