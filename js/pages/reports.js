document.addEventListener("appReady", async () => {
  try {
    const data = await getData();
    renderReports(data);
  } catch (err) {
    toast("Failed to load reports: " + err.message, "error");
  }
  document.getElementById("refreshBtn").addEventListener("click", async () => {
    document.getElementById("refreshBtn").textContent = "Refreshing…";
    const data = await getData();
    renderReports(data);
    document.getElementById("refreshBtn").textContent = "Refresh";
    toast("Reports updated.", "info");
  });
});

function renderReports(data) {
  const total   = data.length;
  const breaches = data.filter(x => x.slaBreach === "Yes").length;
  const avgScore = total
    ? (data.reduce((s, i) => s + calculateAverage(i), 0) / total).toFixed(2)
    : "—";

  document.getElementById("statTotal").textContent   = total;
  document.getElementById("statBreaches").textContent = breaches;
  document.getElementById("statAvg").textContent      = avgScore;
  document.getElementById("statBreach%").textContent  = total
    ? `${((breaches / total) * 100).toFixed(0)}% breach rate`
    : "No data";

  renderAgentChart(data);
}

function renderAgentChart(data) {
  const byAgent = {};
  data.forEach(item => {
    (byAgent[item.agentName] ??= []).push(calculateAverage(item));
  });

  const container = document.getElementById("agentReport");

  if (!Object.keys(byAgent).length) {
    container.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M18 20V10M12 20V4M6 20v-6"/>
        </svg>
        <p>No evaluation data yet</p>
      </div>`;
    return;
  }

  const rows = Object.entries(byAgent)
    .map(([agent, vals]) => ({
      agent,
      avg:   vals.reduce((s, v) => s + v, 0) / vals.length,
      count: vals.length,
    }))
    .sort((a, b) => b.avg - a.avg);

  container.innerHTML = `<div class="agent-list">${rows.map(({ agent, avg, count }) => {
    const pct    = Math.min(100, (avg / 5) * 100);
    const cls    = avg >= 4 ? "high" : avg >= 3 ? "mid" : "low";
    const color  = avg >= 4 ? "var(--success)" : avg >= 3 ? "var(--warning)" : "var(--danger)";
    return `
      <div class="agent-row">
        <div>
          <div class="agent-name">${agent}</div>
          <div style="font-size:11px;color:var(--muted)">${count} eval${count !== 1 ? "s" : ""}</div>
        </div>
        <div class="bar-track">
          <div class="bar-fill ${cls}" style="width:${pct}%"></div>
        </div>
        <div class="agent-score" style="color:${color}">${avg.toFixed(2)}</div>
      </div>`;
  }).join("")}</div>`;
}
