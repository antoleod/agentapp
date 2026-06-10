let allData = [];

document.addEventListener("appReady", async () => {
  setTableLoading(true);
  try {
    allData = await getData();
    renderTable(allData);
  } catch (err) {
    toast("Failed to load data: " + err.message, "error");
  } finally {
    setTableLoading(false);
  }
  bindEvents();
});

function setTableLoading(on) {
  document.getElementById("databaseBody").innerHTML = on
    ? `<tr><td colspan="9"><div class="empty-state"><div class="spinner" style="border-top-color:var(--primary)"></div></div></td></tr>`
    : "";
}

function scoreBadge(avg) {
  const cls = scoreClass(avg);
  return `<span class="score-badge ${cls}">${avg}</span>`;
}

function slaBadge(val) {
  return val === "Yes"
    ? `<span class="badge badge-danger">⚠ Yes</span>`
    : `<span class="badge badge-success">✓ No</span>`;
}

function renderTable(data) {
  const body = document.getElementById("databaseBody");
  if (!data.length) {
    body.innerHTML = `
      <tr><td colspan="9">
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>
          </svg>
          <p>No evaluations found</p>
        </div>
      </td></tr>`;
    return;
  }
  body.innerHTML = data.map(item => {
    const avg = calculateAverage(item);
    return `
      <tr>
        <td><strong>${item.ticketNumber}</strong></td>
        <td>${item.agentName}</td>
        <td>${item.evaluationDate}</td>
        <td>${slaBadge(item.slaBreach)}</td>
        <td>${item.lsa || "—"}</td>
        <td>${item.assignedTo || "—"}</td>
        <td>${scoreBadge(avg)}</td>
        <td>${item.evaluatedBy || "—"}</td>
        <td>
          <div class="td-actions">
            <a class="btn btn-secondary btn-sm"
               href="form.html?edit=${encodeURIComponent(item.ticketNumber)}">Edit</a>
            <button class="btn btn-ghost btn-sm"
                    onclick="openServiceNow('${item.ticketNumber}')">Open</button>
            <button class="btn btn-danger btn-sm"
                    onclick="confirmDelete('${item.ticketNumber}')">Delete</button>
          </div>
        </td>
      </tr>`;
  }).join("");
}

async function confirmDelete(ticketNumber) {
  if (!confirm(`Delete evaluation ${ticketNumber}? This cannot be undone.`)) return;
  try {
    await deleteEvaluation(ticketNumber);
    allData = allData.filter(x => x.ticketNumber !== ticketNumber);
    renderTable(filterData(document.getElementById("searchInput").value));
    toast(`${ticketNumber} deleted.`, "success");
  } catch (err) {
    toast("Delete failed: " + err.message, "error");
  }
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

function bindEvents() {
  let debounce;
  document.getElementById("searchInput").addEventListener("input", e => {
    clearTimeout(debounce);
    debounce = setTimeout(() => renderTable(filterData(e.target.value)), 200);
  });

  document.getElementById("exportJsonBtn").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(allData, null, 2)], { type: "application/json" });
    const a    = Object.assign(document.createElement("a"), {
      href:     URL.createObjectURL(blob),
      download: `agent-evaluations-${today()}.json`,
    });
    a.click();
    toast("Export downloaded.", "success");
  });

  document.getElementById("importJsonInput").addEventListener("change", async e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const imported = JSON.parse(reader.result);
        if (!Array.isArray(imported)) throw new Error("Expected a JSON array.");
        // Upload each to Firestore
        const batch = window.db.batch();
        imported.forEach(item => {
          const ref = window.db.collection("evaluations").doc(item.ticketNumber);
          batch.set(ref, { ...item, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
        });
        await batch.commit();
        allData = await getData();
        renderTable(allData);
        toast(`${imported.length} evaluations imported.`, "success");
      } catch (err) {
        toast("Import failed: " + err.message, "error");
      }
    };
    reader.readAsText(file);
  });

  document.getElementById("deleteAllBtn").addEventListener("click", async () => {
    if (!confirm(`Delete ALL ${allData.length} evaluations? This cannot be undone.`)) return;
    try {
      const batch = window.db.batch();
      allData.forEach(item => {
        batch.delete(window.db.collection("evaluations").doc(item.ticketNumber));
      });
      await batch.commit();
      localStorage.removeItem("agentEvaluationsV2");
      allData = [];
      renderTable([]);
      toast("All evaluations deleted.", "success");
    } catch (err) {
      toast("Delete failed: " + err.message, "error");
    }
  });
}
