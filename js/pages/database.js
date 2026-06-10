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
    const avg    = calculateAverage(item);
    const ticket = escapeHtml(item.ticketNumber);
    return `
      <tr>
        <td><strong>${ticket}</strong></td>
        <td>${escapeHtml(item.agentName)}</td>
        <td>${escapeHtml(item.evaluationDate)}</td>
        <td>${slaBadge(item.slaBreach)}</td>
        <td>${escapeHtml(item.lsa || "—")}</td>
        <td>${escapeHtml(item.assignedTo || "—")}</td>
        <td>${scoreBadge(avg)}</td>
        <td>${escapeHtml(item.evaluatedBy || "—")}</td>
        <td>
          <div class="td-actions">
            <a class="btn btn-secondary btn-sm"
               href="form.html?edit=${encodeURIComponent(item.ticketNumber)}">${t("db.edit")}</a>
            <button class="btn btn-ghost btn-sm" data-action="open" data-ticket="${ticket}">${t("db.open")}</button>
            <button class="btn btn-danger btn-sm" data-action="delete" data-ticket="${ticket}">${t("db.delete")}</button>
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

function exportCsv(data) {
  const scoreKeys = Object.keys(scoreLabels);
  const headers = [
    "Ticket Number", "Agent Name", "Evaluation Date", "SLA Breach",
    "LSA", "Assigned To", "Evaluated By",
    ...scoreKeys.map(k => scoreLabels[k]),
    "Average Score", "Comments", "Created At",
  ];
  const rows = data.map(item => {
    const avg = calculateAverage(item);
    const esc = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
    return [
      esc(item.ticketNumber), esc(item.agentName), esc(item.evaluationDate),
      esc(item.slaBreach), esc(item.lsa), esc(item.assignedTo), esc(item.evaluatedBy),
      ...scoreKeys.map(k => esc(item[k] ?? "")),
      esc(avg), esc(item.comments), esc(item.createdAt),
    ].join(",");
  });
  return [headers.join(","), ...rows].join("\r\n");
}

function bindEvents() {
  let debounce;
  document.getElementById("searchInput").addEventListener("input", e => {
    clearTimeout(debounce);
    debounce = setTimeout(() => renderTable(filterData(e.target.value)), 200);
  });

  // Delegated click handler for action buttons (replaces inline onclick — prevents XSS)
  document.getElementById("databaseBody").addEventListener("click", e => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const ticket = btn.dataset.ticket;
    if (btn.dataset.action === "open")   openServiceNow(ticket);
    if (btn.dataset.action === "delete") confirmDelete(ticket);
  });

  document.getElementById("exportJsonBtn").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(allData, null, 2)], { type: "application/json" });
    const a    = Object.assign(document.createElement("a"), {
      href:     URL.createObjectURL(blob),
      download: `agent-evaluations-${today()}.json`,
    });
    a.click();
    toast("JSON export downloaded.", "success");
  });

  document.getElementById("exportCsvBtn")?.addEventListener("click", () => {
    const blob = new Blob([exportCsv(allData)], { type: "text/csv;charset=utf-8;" });
    const a    = Object.assign(document.createElement("a"), {
      href:     URL.createObjectURL(blob),
      download: `agent-evaluations-${today()}.csv`,
    });
    a.click();
    toast("CSV export downloaded.", "success");
  });

  document.getElementById("importJsonInput").addEventListener("change", async e => {
    const file = e.target.files[0];
    if (!file) return;
    const importBtn = document.getElementById("importJsonBtn");
    if (importBtn) { importBtn.disabled = true; importBtn.textContent = "Importing…"; }
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const imported = JSON.parse(reader.result);
        if (!Array.isArray(imported)) throw new Error("Expected a JSON array.");

        const valid = imported.filter(item => item && typeof item.ticketNumber === "string" && item.ticketNumber.trim());
        const skipped = imported.length - valid.length;
        if (!valid.length) throw new Error("No valid records found (all missing ticketNumber).");

        const batch = window.db.batch();
        valid.forEach(item => {
          const ref = window.db.collection(COLLECTION).doc(item.ticketNumber.trim());
          batch.set(ref, { ...item, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
        });
        await batch.commit();
        allData = await getData();
        renderTable(allData);
        const msg = skipped
          ? `${valid.length} imported, ${skipped} skipped (missing ticket number).`
          : `${valid.length} evaluations imported.`;
        toast(msg, "success");
      } catch (err) {
        toast("Import failed: " + err.message, "error");
      } finally {
        e.target.value = "";
        if (importBtn) { importBtn.disabled = false; importBtn.textContent = "Import JSON"; }
      }
    };
    reader.readAsText(file);
  });

  document.getElementById("deleteAllBtn").addEventListener("click", async () => {
    if (!confirm(`Delete ALL ${allData.length} evaluations? This cannot be undone.`)) return;
    const btn = document.getElementById("deleteAllBtn");
    btn.disabled    = true;
    btn.textContent = "Deleting…";
    try {
      const batch = window.db.batch();
      allData.forEach(item => {
        batch.delete(window.db.collection(COLLECTION).doc(item.ticketNumber));
      });
      await batch.commit();
      localStorage.removeItem(STORAGE_KEY);
      allData = [];
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
